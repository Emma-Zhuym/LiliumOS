/**
 * 图片仓库：手机把外链图（表情包、头像）存进本机时，顺手在 mini 上留一份底。
 *
 * 起因 2026-10-21：表情包都挂在别人的图床上（sharkpan 两个月前整站下线、catbox 时好时坏），
 * 图床一挂就全变问号；而手机每天的自动备份只带文字，存进本机的图也跟着备份丢。
 *
 * - 只收不发：不对公网提供图片，`GET /images` 只回元数据。以后「从 mini 恢复图片」再加读取。
 * - 按内容 sha256 存，同一张图存几次都只有一份；文件名就是哈希，不带用户给的任何字符串。
 * - 还管一件事：浏览器跨域下载不了的外链图，由这里代为下载（`fetchRemoteImage`）。
 *   这是个「替手机去拿任意网址」的口子，所以只认 http(s)、解析出来是内网 / 本机地址一律拒绝
 *   （mini 上 127.0.0.1 跑着日历桥接、小红书这些服务），跳转也逐跳检查。
 */

import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';

/** 单张上限。表情包动图最大的也就几 MB，留足余量。 */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

/** 认的格式 → 扩展名。SVG 不收：里面能带脚本，而且表情包 / 头像用不到。 */
const MIME_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/heic': 'heic',
};

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export const vaultDir = config => join(config.dataDir, 'images');

/** 有些图床 Content-Type 乱给（octet-stream），按文件头认一遍。认不出来返回 null。 */
export const sniffImageMime = buf => {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
    if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
        const brand = buf.subarray(8, 12).toString('latin1');
        if (brand === 'avif' || brand === 'avis') return 'image/avif';
        if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') return 'image/heic';
    }
    return null;
};

/** 文件头说了算；认不出来再看声明的类型在不在白名单里。 */
const resolveMime = (buf, declared) => {
    const sniffed = sniffImageMime(buf);
    if (sniffed) return sniffed;
    const clean = String(declared || '').split(';')[0].trim().toLowerCase();
    return MIME_EXT[clean] ? clean : null;
};

const shortText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * 存一张图。返回 { sha256, mime, bytes, existed }。
 * source（原外链）、label（「表情包：乖乖当狗」这类）只进旁边的 .json，同一张图多次存会累加，最多各留 20 条。
 */
export const putImage = (config, { data, mime, source, label }, now = new Date()) => {
    if (!Buffer.isBuffer(data) || data.length === 0) throw fail(400, 'EMPTY_IMAGE', '图是空的');
    if (data.length > MAX_IMAGE_BYTES) throw fail(413, 'IMAGE_TOO_LARGE', '图太大了（单张上限 15 MB）');
    const finalMime = resolveMime(data, mime);
    if (!finalMime) throw fail(400, 'NOT_AN_IMAGE', '不是认得的图片格式');

    const dir = vaultDir(config);
    mkdirSync(dir, { recursive: true });
    const sha256 = createHash('sha256').update(data).digest('hex');
    const file = join(dir, `${sha256}.${MIME_EXT[finalMime]}`);
    const metaFile = join(dir, `${sha256}.json`);
    const existed = existsSync(file);
    if (!existed) {
        // 先写临时文件再改名：写到一半断电不会留下半张图冒充完整的
        const tmp = `${file}.tmp-${process.pid}`;
        writeFileSync(tmp, data);
        renameSync(tmp, file);
    }

    let meta = { sha256, mime: finalMime, bytes: data.length, sources: [], labels: [], createdAt: now.toISOString() };
    if (existsSync(metaFile)) {
        try { meta = { ...meta, ...JSON.parse(readFileSync(metaFile, 'utf8')) }; } catch { /* 坏了就重写 */ }
    }
    const addTo = (list, value) => {
        if (!value || list.includes(value)) return list;
        return [...list, value].slice(-20);
    };
    meta.sources = addTo(Array.isArray(meta.sources) ? meta.sources : [], shortText(source, 1000));
    meta.labels = addTo(Array.isArray(meta.labels) ? meta.labels : [], shortText(label, 120));
    meta.updatedAt = now.toISOString();
    writeFileSync(metaFile, JSON.stringify(meta));

    return { sha256, mime: finalMime, bytes: data.length, existed };
};

/** 仓库里有哪些图（只有元数据）。新的在前。 */
export const listImages = config => {
    const dir = vaultDir(config);
    if (!existsSync(dir)) return { count: 0, totalBytes: 0, items: [] };
    const items = [];
    for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        try {
            const meta = JSON.parse(readFileSync(join(dir, name), 'utf8'));
            if (typeof meta?.sha256 === 'string') items.push(meta);
        } catch { /* 跳过坏的 */ }
    }
    items.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return { count: items.length, totalBytes: items.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0), items };
};

// ── 代为下载 ─────────────────────────────────────────────────────

/** 内网、本机、链路本地、保留段：一律不让代为下载。 */
export const isPrivateAddress = address => {
    const family = isIP(address);
    if (family === 4) {
        const [a, b] = address.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127) // CGNAT，Tailscale 就在这段
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19));
    }
    if (family === 6) {
        const lower = address.toLowerCase();
        if (lower === '::' || lower === '::1') return true;
        const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateAddress(mapped[1]);
        return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
    }
    return true; // 不是 IP：当不安全处理
};

const assertPublicUrl = async (raw, lookup) => {
    let url;
    try { url = new URL(raw); } catch { throw fail(400, 'BAD_URL', '不是有效的网址'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw fail(400, 'BAD_URL', '只能下载 http / https 的图');
    if (url.username || url.password) throw fail(400, 'BAD_URL', '网址里不能带账号密码');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let addresses;
    if (isIP(host)) addresses = [host];
    else {
        try { addresses = (await lookup(host, { all: true })).map(entry => entry.address); } catch {
            throw fail(502, 'DNS_FAILED', '这个图床的域名解析不到');
        }
    }
    if (!addresses.length || addresses.some(isPrivateAddress)) throw fail(400, 'PRIVATE_ADDRESS', '不能下载内网地址');
    return url;
};

const readLimited = async response => {
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_IMAGE_BYTES) throw fail(413, 'IMAGE_TOO_LARGE', '图太大了（单张上限 15 MB）');
    if (!response.body) return Buffer.from(await response.arrayBuffer());
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) throw fail(413, 'IMAGE_TOO_LARGE', '图太大了（单张上限 15 MB）');
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
};

/**
 * 替手机下载一张外链图。返回 { data, mime, finalUrl }。
 * 图床挂了（连不上 / 5xx / 404）抛 status 502 的 UPSTREAM_*，手机据此判成「死链」。
 */
export const fetchRemoteImage = async (raw, { fetchImpl = fetch, lookup = dnsLookup, timeoutMs = FETCH_TIMEOUT_MS } = {}) => {
    let url = await assertPublicUrl(raw, lookup);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            let response;
            try {
                response = await fetchImpl(url.href, {
                    redirect: 'manual',
                    signal: controller.signal,
                    headers: { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0 (LiliumOS image vault)' },
                });
            } catch {
                throw fail(502, 'UPSTREAM_UNREACHABLE', controller.signal.aborted ? '图床超时没响应' : '连不上图床');
            }
            if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
                url = await assertPublicUrl(new URL(response.headers.get('location'), url).href, lookup);
                continue;
            }
            if (!response.ok) throw fail(502, 'UPSTREAM_STATUS', `图床返回 ${response.status}`);
            const data = await readLimited(response);
            const mime = resolveMime(data, response.headers.get('content-type'));
            if (!mime) throw fail(502, 'UPSTREAM_NOT_IMAGE', '图床返回的不是图片');
            return { data, mime, finalUrl: url.href };
        }
        throw fail(502, 'UPSTREAM_REDIRECTS', '图床跳转太多次');
    } finally {
        clearTimeout(timer);
    }
};
