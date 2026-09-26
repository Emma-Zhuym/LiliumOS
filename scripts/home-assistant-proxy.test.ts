// [EM-START: xhs-mini-mcp]
// 网关的 /xhs/* 路由：去掉前缀转给 xiaohongshu-mcp；只放 /xhs/mcp 和 /xhs/health；
// Authorization 原样带过去（鉴权是上游 AUTH_TOKEN 做的）；来源白名单照旧。
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./home-assistant-proxy.mjs', import.meta.url));
const seen: { path: string; auth?: string; body?: string }[] = [];
let upstream: Server;
let proxy: ChildProcess;
let base = '';

const freePort = () => new Promise<number>(resolve => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
    });
});

beforeAll(async () => {
    upstream = createServer((req, res) => {
        const parts: Buffer[] = [];
        req.on('data', part => parts.push(part));
        req.on('end', () => {
            const body = Buffer.concat(parts).toString('utf8');
            seen.push({ path: req.url || '', auth: req.headers.authorization, body });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (body.includes('"tools/list"')) {
                res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [
                    { name: 'list_feeds' }, { name: 'publish_content' }, { name: 'like_feed' }, { name: 'post_comment_to_feed' }, { name: 'delete_cookies' },
                ] } }));
                return;
            }
            res.end(JSON.stringify({ ok: true, path: req.url }));
        });
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const port = await freePort();
    proxy = spawn(process.execPath, [SCRIPT, '--port', String(port), '--xhs-mcp-target', upstreamUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
        proxy.stdout!.on('data', chunk => { if (String(chunk).includes('listening')) resolve(); });
        proxy.once('exit', code => reject(new Error(`proxy exited ${code}`)));
    });
    base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
    proxy?.kill();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
});

describe('网关 /xhs/* → xiaohongshu-mcp', () => {
    it('去掉 /xhs 前缀转发，令牌原样带过去', async () => {
        const res = await fetch(`${base}/xhs/mcp`, {
            method: 'POST',
            headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json', Origin: 'https://emma-zhuym.github.io' },
            body: '{}',
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('access-control-allow-origin')).toBe('https://emma-zhuym.github.io');
        expect(await res.json()).toEqual({ ok: true, path: '/mcp' });
        expect(seen.at(-1)).toMatchObject({ path: '/mcp', auth: 'Bearer tok' });
        expect((await fetch(`${base}/xhs/health`)).status).toBe(200);
        expect(seen.at(-1)?.path).toBe('/health');
    });

    it('上游的 REST 接口（发帖、删 cookie）不从公网开', async () => {
        const before = seen.length;
        for (const path of ['/xhs/api/v1/publish', '/xhs/api/v1/login/cookies', '/xhs', '/xhsmcp']) {
            const res = await fetch(`${base}${path}`, { method: 'POST', body: '{}' });
            expect(res.status, path).not.toBe(200);
        }
        expect(seen.length).toBe(before);
    });

    it('发帖、评论、删登录这类工具在网关就拦下，根本到不了小红书服务', async () => {
        const before = seen.length;
        for (const name of ['publish_content', 'publish_with_video', 'post_comment_to_feed', 'reply_comment_in_feed', 'reply_notification', 'delete_cookies']) {
            const res = await fetch(`${base}/xhs/mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: {} } }),
            });
            const json = await res.json();
            expect(json.id, name).toBe(7);
            expect(json.error.message, name).toContain('停用');
        }
        // 批量请求里夹一个也不行
        const batch = await fetch(`${base}/xhs/mcp`, {
            method: 'POST',
            body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'like_feed' } }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'publish_content' } }]),
        });
        expect((await batch.json()).error).toBeTruthy();
        expect(seen.length).toBe(before);
    });

    it('点赞、搜索这类照常转发，请求体原样带过去', async () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'like_feed', arguments: { feed_id: 'n1', xsec_token: 't' } } });
        const res = await fetch(`${base}/xhs/mcp`, { method: 'POST', headers: { Authorization: 'Bearer tok' }, body });
        expect(res.status).toBe(200);
        expect(seen.at(-1)).toMatchObject({ path: '/mcp', auth: 'Bearer tok', body });
    });

    it('工具列表里看不到停用的工具', async () => {
        const res = await fetch(`${base}/xhs/mcp`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
        const names = (await res.json()).result.tools.map((t: { name: string }) => t.name);
        expect(names).toEqual(['list_feeds', 'like_feed']);
    });

    it('不在白名单的来源一律 403', async () => {
        const res = await fetch(`${base}/xhs/mcp`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
        expect(res.status).toBe(403);
    });
});
// [EM-END: xhs-mini-mcp]
