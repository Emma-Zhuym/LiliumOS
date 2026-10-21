/**
 * 图片仓库（imageVault.mjs）。临时目录，不碰真库；下载用假 fetch / 假 DNS，不出网。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { fetchRemoteImage, isPrivateAddress, listImages, putImage, sniffImageMime } from './imageVault.mjs';
import { createRouter } from './server.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(16, 1)]);

const tempConfig = () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'image-vault-'));
    return { dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
};

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const imageResponse = (buf, type = 'image/png', status = 200, headers = {}) => new Response(buf, {
    status, headers: { 'content-type': type, ...headers },
});

test('认图：按文件头认，不信 Content-Type', () => {
    assert.equal(sniffImageMime(PNG), 'image/png');
    assert.equal(sniffImageMime(GIF), 'image/gif');
    assert.equal(sniffImageMime(Buffer.from('<html>not an image</html>')), null);
});

test('存图：同一张只存一份，来源和名字累加；不是图的拒收', () => {
    const config = tempConfig();
    try {
        const first = putImage(config, { data: PNG, mime: 'application/octet-stream', source: 'https://files.catbox.moe/bgid0b.jpg', label: '表情包：乖乖当狗' });
        assert.equal(first.mime, 'image/png');
        assert.equal(first.existed, false);
        const again = putImage(config, { data: PNG, mime: 'image/png', source: 'https://example.org/a.png', label: '表情包：乖乖当狗' });
        assert.equal(again.sha256, first.sha256);
        assert.equal(again.existed, true);

        const files = readdirSync(join(config.dataDir, 'images')).sort();
        assert.deepEqual(files, [`${first.sha256}.json`, `${first.sha256}.png`]);
        const listed = listImages(config);
        assert.equal(listed.count, 1);
        assert.equal(listed.totalBytes, PNG.length);
        assert.deepEqual(listed.items[0].sources, ['https://files.catbox.moe/bgid0b.jpg', 'https://example.org/a.png']);
        assert.deepEqual(listed.items[0].labels, ['表情包：乖乖当狗']);

        assert.throws(() => putImage(config, { data: Buffer.from('<svg/>'), mime: 'image/svg+xml' }), /不是认得的图片格式/);
        assert.throws(() => putImage(config, { data: Buffer.alloc(0) }), /图是空的/);
    } finally {
        config.cleanup();
    }
});

test('内网地址：本机、局域网、Tailscale 段、IPv6 本地都算', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '100.100.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
        assert.equal(isPrivateAddress(address), true, address);
    }
    for (const address of ['93.184.216.34', '108.181.20.35', '2606:4700::1']) {
        assert.equal(isPrivateAddress(address), false, address);
    }
});

test('代为下载：正常拿图；跳转逐跳检查；拒绝内网和非 http', async () => {
    const got = await fetchRemoteImage('https://files.catbox.moe/x.png', {
        lookup: publicLookup,
        fetchImpl: async () => imageResponse(PNG, 'application/octet-stream'),
    });
    assert.equal(got.mime, 'image/png');
    assert.equal(got.data.length, PNG.length);

    const hops = [];
    const redirected = await fetchRemoteImage('http://img.example/a', {
        lookup: async host => [{ address: host === 'cdn.example' ? '93.184.216.35' : '93.184.216.34', family: 4 }],
        fetchImpl: async href => {
            hops.push(href);
            return hops.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.example/b.gif' } }) : imageResponse(GIF, 'image/gif');
        },
    });
    assert.equal(redirected.finalUrl, 'https://cdn.example/b.gif');
    assert.equal(redirected.mime, 'image/gif');

    await assert.rejects(fetchRemoteImage('http://evil.example/a', {
        lookup: async host => [{ address: host === 'evil.example' ? '93.184.216.34' : '127.0.0.1', family: 4 }],
        fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://localhost:8765/mcp' } }),
    }), /内网/);
    await assert.rejects(fetchRemoteImage('http://127.0.0.1:8790/agent/v1/status', { lookup: publicLookup, fetchImpl: async () => imageResponse(PNG) }), /内网/);
    await assert.rejects(fetchRemoteImage('file:///etc/passwd', { lookup: publicLookup }), /http/);
});

test('代为下载：图床挂了 / 返回网页都算上游失败（502）', async () => {
    await assert.rejects(fetchRemoteImage('https://sharkpan.xyz/f/a.png', {
        lookup: publicLookup, fetchImpl: async () => new Response('error code: 522', { status: 522 }),
    }), err => err.status === 502 && err.code === 'UPSTREAM_STATUS');
    await assert.rejects(fetchRemoteImage('https://files.catbox.moe/a.png', {
        lookup: publicLookup, fetchImpl: async () => { throw new TypeError('fetch failed'); },
    }), err => err.status === 502 && err.code === 'UPSTREAM_UNREACHABLE');
    await assert.rejects(fetchRemoteImage('https://files.catbox.moe/a.png', {
        lookup: publicLookup, fetchImpl: async () => new Response('<html>404</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    }), err => err.code === 'UPSTREAM_NOT_IMAGE');
});

test('路由：/images/fetch 存一份并把图交回；/images/put 收 base64；GET /images 只回数量', async () => {
    const config = tempConfig();
    try {
        const routes = createRouter({
            db: null,
            config,
            imageFetchOptions: { lookup: publicLookup, fetchImpl: async () => imageResponse(GIF, 'image/gif') },
        });
        const fetched = await routes['POST /images/fetch'].handle({ body: { url: 'https://files.catbox.moe/mrzvy0.gif', label: '表情包：大脑CPU烧了' } });
        assert.equal(fetched.mime, 'image/gif');
        assert.equal(Buffer.from(fetched.dataBase64, 'base64').equals(GIF), true);

        const put = routes['POST /images/put'].handle({ body: { dataBase64: PNG.toString('base64'), mime: 'image/png', label: '角色头像：狐狐' } });
        assert.equal(put.mime, 'image/png');
        assert.ok(routes['POST /images/put'].maxBodyBytes > 20 * 1024 * 1024);

        assert.deepEqual(routes['GET /images'].handle({}), { count: 2, totalBytes: GIF.length + PNG.length });
        assert.throws(() => routes['POST /images/put'].handle({ body: {} }), /没有图片内容/);
    } finally {
        config.cleanup();
    }
});
