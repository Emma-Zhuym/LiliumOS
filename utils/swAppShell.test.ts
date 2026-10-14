import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ASSET_CACHE_PREFIX,
    SHELL_CACHE_PREFIX,
    classifyRequest,
    createAppShell,
    extractManifestUrls,
    extractShellResources,
    isUsableShellResponse,
    PRECACHE_MANIFEST_FILE,
    type CacheLike,
    type CacheStorageLike,
} from './swAppShell';

const SCOPE = 'https://emma-zhuym.github.io/LiliumOS/';
const SHELL_HTML = `<!doctype html><html><head>
<link rel="manifest" href="./manifest.webmanifest?v=liliumos-1" />
<link rel="stylesheet" href="https://unpkg.com/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@300&amp;display=swap" rel="stylesheet">
<script type="module" crossorigin src="./assets/index-abc123.js"></script>
<link rel="modulepreload" crossorigin href="./assets/vendor-react-def456.js">
<link rel="stylesheet" href="./assets/index-xyz.css">
<script src="https://esm.sh/jszip@3.10.1"></script>
</head><body></body></html>`;

const FRESH_HTML = SHELL_HTML.replace('<body>', '<body>FRESH');

interface FakeInit {
    type?: string;
    status?: number;
    url?: string;
    redirected?: boolean;
    contentType?: string;
    body?: string;
}

/** 测试环境里 new Response() 的 type/url 改不了，这里用结构相同的假对象。 */
function fakeResponse(init: FakeInit = {}): Response {
    const status = init.status ?? 200;
    const res = {
        type: init.type ?? 'basic',
        status,
        ok: status >= 200 && status < 300,
        url: init.url ?? SCOPE,
        redirected: init.redirected ?? false,
        headers: new Headers(init.contentType === undefined ? { 'content-type': 'text/html; charset=utf-8' } : { 'content-type': init.contentType }),
        body: init.body ?? SHELL_HTML,
        clone: () => fakeResponse(init),
        text: async () => init.body ?? SHELL_HTML,
        json: async () => JSON.parse(init.body ?? 'null'),
    };
    return res as unknown as Response;
}

class FakeCache implements CacheLike {
    store = new Map<string, Response>();
    async match(request: string) { return this.store.get(request); }
    async put(request: string, response: Response) { this.store.set(request, response); }
    async keys() { return [...this.store.keys()].map(url => ({ url })); }
    async delete(request: string) { return this.store.delete(request); }
}

class FakeCacheStorage implements CacheStorageLike {
    caches = new Map<string, FakeCache>();
    async open(name: string) {
        if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
        return this.caches.get(name)!;
    }
    async keys() { return [...this.caches.keys()]; }
    async delete(name: string) { return this.caches.delete(name); }
}

type FetchImpl = (input: any, init?: RequestInit) => Promise<Response>;

function setup(fetchImpl: FetchImpl, opts: { timeoutMs?: number; maxAssetEntries?: number } = {}) {
    const storage = new FakeCacheStorage();
    const pending: Promise<unknown>[] = [];
    const fetch = vi.fn(fetchImpl);
    const shell = createAppShell({
        scope: SCOPE,
        version: 'test',
        fetch,
        caches: storage,
        timeoutMs: opts.timeoutMs ?? 3000,
        maxAssetEntries: opts.maxAssetEntries,
    });
    const waitUntil = (p: Promise<unknown>) => { pending.push(p); };
    const settle = async () => { while (pending.length) await pending.shift(); };
    const navigate = (url = SCOPE) => shell.handle({ url, method: 'GET', mode: 'navigate' }, 'shell', waitUntil);
    return { storage, shell, fetch, waitUntil, settle, navigate };
}

const seedShell = async (storage: FakeCacheStorage, body = 'CACHED SHELL') => {
    const cache = await storage.open(`${SHELL_CACHE_PREFIX}test`);
    await cache.put(SCOPE, fakeResponse({ body }));
};

const bodyOf = (res: Response) => (res as unknown as { body: string }).body;

describe('isUsableShellResponse', () => {
    it('只认同源 basic、200、未跳转、在 scope 内、text/html', () => {
        expect(isUsableShellResponse(fakeResponse(), SCOPE)).toBe(true);
        expect(isUsableShellResponse(fakeResponse({ type: 'opaqueredirect', status: 0, url: '' }), SCOPE)).toBe(false);
        expect(isUsableShellResponse(fakeResponse({ type: 'cors' }), SCOPE)).toBe(false);
        expect(isUsableShellResponse(fakeResponse({ redirected: true }), SCOPE)).toBe(false);
        expect(isUsableShellResponse(fakeResponse({ url: 'https://emma-zhuym.github.io/other/' }), SCOPE)).toBe(false);
        expect(isUsableShellResponse(fakeResponse({ status: 302 }), SCOPE)).toBe(false);
        expect(isUsableShellResponse(fakeResponse({ status: 503 }), SCOPE)).toBe(false);
        expect(isUsableShellResponse(fakeResponse({ contentType: 'application/json' }), SCOPE)).toBe(false);
        expect(isUsableShellResponse(fakeResponse({ contentType: '' }), SCOPE)).toBe(false);
    });
});

describe('classifyRequest', () => {
    it('只拦 shell 导航、本站静态资源和开机 CDN', () => {
        const get = (url: string, mode = 'no-cors') => classifyRequest({ url, method: 'GET', mode }, SCOPE);
        expect(get(SCOPE, 'navigate')).toBe('shell');
        expect(get(`${SCOPE}?openApp=chat&activeMsgCharId=x`, 'navigate')).toBe('shell');
        expect(get(`${SCOPE}index.html`, 'navigate')).toBe('shell');
        expect(get(`${SCOPE}like520/page.html`, 'navigate')).toBeNull();
        expect(get(`${SCOPE}assets/index-abc.js`, 'cors')).toBe('static');
        expect(get(`${SCOPE}icons/icon-192.png?v=liliumos-1`)).toBe('static');
        expect(get(`${SCOPE}manifest.webmanifest?v=liliumos-1`)).toBe('static');
        expect(get(`${SCOPE}sw-keep-alive.js`)).toBeNull();
        expect(get(`${SCOPE}amsg-worker.bundle.js`)).toBeNull();
        expect(get('https://cdn.tailwindcss.com/')).toBe('boot-cdn');
        expect(get('https://api.openai.com/v1/chat/completions', 'cors')).toBeNull();
        expect(get('https://esm.sh/jszip@3.10.1', 'cors')).toBeNull();
        expect(get('https://some-worker.workers.dev/instant-chat', 'cors')).toBeNull();
        expect(classifyRequest({ url: `${SCOPE}assets/x.js`, method: 'POST' }, SCOPE)).toBeNull();
    });
});

describe('extractShellResources', () => {
    it('挑出本站资源和开机 CDN，记下 crossorigin，别的 CDN 不要', () => {
        const res = extractShellResources(SHELL_HTML, SCOPE);
        const byUrl = Object.fromEntries(res.map(r => [r.url, r]));
        expect(Object.keys(byUrl).sort()).toEqual([
            'https://cdn.tailwindcss.com/',
            'https://emma-zhuym.github.io/LiliumOS/assets/index-abc123.js',
            'https://emma-zhuym.github.io/LiliumOS/assets/index-xyz.css',
            'https://emma-zhuym.github.io/LiliumOS/assets/vendor-react-def456.js',
            'https://emma-zhuym.github.io/LiliumOS/manifest.webmanifest?v=liliumos-1',
            'https://fonts.googleapis.com/css2?family=Quicksand:wght@300&display=swap',
            'https://unpkg.com/katex@0.16.9/dist/katex.min.css',
        ]);
        expect(byUrl['https://unpkg.com/katex@0.16.9/dist/katex.min.css'].cors).toBe(true);
        expect(byUrl['https://cdn.tailwindcss.com/'].cors).toBe(false);
        expect(byUrl['https://emma-zhuym.github.io/LiliumOS/assets/index-xyz.css'].route).toBe('static');
    });
});

describe('打开 App（shell 导航）', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('正常响应：直接用网络的，并写进缓存、补齐资源', async () => {
        const { storage, navigate, settle, fetch } = setup(async (input) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url === SCOPE) return fakeResponse({ body: FRESH_HTML });
            if (url.startsWith(SCOPE)) return fakeResponse({ url, contentType: 'text/javascript', body: url });
            return fakeResponse({ type: 'opaque', status: 0, url: '' });
        });
        const res = await navigate(`${SCOPE}?openApp=chat`);
        expect(bodyOf(res)).toBe(FRESH_HTML);
        await settle();
        expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-cache', redirect: 'follow' });
        const shellCache = storage.caches.get(`${SHELL_CACHE_PREFIX}test`)!;
        expect(bodyOf((await shellCache.match(SCOPE))!)).toBe(FRESH_HTML);
        const assets = storage.caches.get(`${ASSET_CACHE_PREFIX}test`)!;
        expect(assets.store.has(`${SCOPE}assets/index-abc123.js`)).toBe(true);
        expect(assets.store.has('https://cdn.tailwindcss.com/')).toBe(true);
        expect(assets.store.has('https://esm.sh/jszip@3.10.1')).toBe(false);
    });

    it('断网：用缓存的 shell', async () => {
        const { storage, navigate } = setup(async () => { throw new TypeError('Load failed'); });
        await seedShell(storage);
        expect(bodyOf(await navigate())).toBe('CACHED SHELL');
    });

    it('断网且从没缓存过：给离线提示页，不报网络错误', async () => {
        const { navigate } = setup(async () => { throw new TypeError('Load failed'); });
        const res = await navigate();
        expect(res.status).toBe(503);
        expect(await res.text()).toContain('连不上网络');
    });

    it('超时：3 秒后用缓存，网络晚到了照样更新缓存', async () => {
        let resolveNetwork!: (r: Response) => void;
        const { storage, navigate, settle } = setup((input) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url === SCOPE) return new Promise<Response>(r => { resolveNetwork = r; });
            return Promise.reject(new TypeError('offline'));
        });
        await seedShell(storage);
        const pending = navigate();
        await vi.advanceTimersByTimeAsync(3000);
        expect(bodyOf(await pending)).toBe('CACHED SHELL');

        resolveNetwork(fakeResponse({ body: 'LATE SHELL' }));
        await settle();
        const cached = await storage.caches.get(`${SHELL_CACHE_PREFIX}test`)!.match(SCOPE);
        expect(bodyOf(cached!)).toBe('LATE SHELL');
    });

    it('跨域重定向（Wi-Fi 登录页）：用缓存，且不把登录页存进去', async () => {
        const { storage, navigate, settle } = setup(async () => fakeResponse({
            type: 'basic', redirected: true, url: 'https://www.southwestwifi.com/login', body: 'PORTAL',
        }));
        await seedShell(storage);
        expect(bodyOf(await navigate())).toBe('CACHED SHELL');
        await settle();
        expect(bodyOf((await storage.caches.get(`${SHELL_CACHE_PREFIX}test`)!.match(SCOPE))!)).toBe('CACHED SHELL');
    });

    it('opaqueredirect 也算失败', async () => {
        const { storage, navigate } = setup(async () => fakeResponse({ type: 'opaqueredirect', status: 0, url: '' }));
        await seedShell(storage);
        expect(bodyOf(await navigate())).toBe('CACHED SHELL');
    });

    it('非 200 响应：用缓存', async () => {
        const { storage, navigate, settle } = setup(async () => fakeResponse({ status: 511, body: 'NETWORK AUTH REQUIRED' }));
        await seedShell(storage);
        expect(bodyOf(await navigate())).toBe('CACHED SHELL');
        await settle();
        expect(bodyOf((await storage.caches.get(`${SHELL_CACHE_PREFIX}test`)!.match(SCOPE))!)).toBe('CACHED SHELL');
    });

    it('非 html 响应：用缓存', async () => {
        const { storage, navigate } = setup(async () => fakeResponse({ contentType: 'application/octet-stream', body: 'BINARY' }));
        await seedShell(storage);
        expect(bodyOf(await navigate())).toBe('CACHED SHELL');
    });

    it('登录页网络下第一次打开、没有缓存：给离线页，不显示登录页', async () => {
        const { navigate } = setup(async () => fakeResponse({ redirected: true, url: 'https://portal.example/', body: 'PORTAL' }));
        const res = await navigate();
        expect(res.status).toBe(503);
    });
});

describe('静态资源与 CDN', () => {
    it('assets 缓存优先：命中就不走网络', async () => {
        const { storage, shell, fetch } = setup(async () => { throw new Error('should not fetch'); });
        const cache = await storage.open(`${ASSET_CACHE_PREFIX}test`);
        const url = `${SCOPE}assets/index-abc.js`;
        await cache.put(url, fakeResponse({ url, body: 'JS' }));
        const res = await shell.handle({ url, method: 'GET', mode: 'cors' }, 'static');
        expect(bodyOf(res)).toBe('JS');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('assets 未命中：走网络，只存 200 的同源响应', async () => {
        const url = `${SCOPE}assets/chunk-1.js`;
        const { storage, shell, waitUntil, settle } = setup(async () => fakeResponse({ url, body: 'CHUNK' }));
        await shell.handle({ url, method: 'GET', mode: 'cors' }, 'static', waitUntil);
        await settle();
        expect(storage.caches.get(`${ASSET_CACHE_PREFIX}test`)!.store.has(url)).toBe(true);

        const missing = `${SCOPE}assets/gone.js`;
        const second = setup(async () => fakeResponse({ url: missing, status: 404 }));
        await second.shell.handle({ url: missing, method: 'GET', mode: 'cors' }, 'static', second.waitUntil);
        await second.settle();
        expect(second.storage.caches.get(`${ASSET_CACHE_PREFIX}test`)?.store.has(missing) ?? false).toBe(false);
    });

    it('超过上限按写入顺序淘汰最早的', async () => {
        let n = 0;
        const { storage, shell, waitUntil, settle } = setup(
            async (input) => fakeResponse({ url: input.url, body: String(n++) }),
            { maxAssetEntries: 2 },
        );
        for (const name of ['a', 'b', 'c']) {
            await shell.handle({ url: `${SCOPE}assets/${name}.js`, method: 'GET' }, 'static', waitUntil);
            await settle();
        }
        expect([...storage.caches.get(`${ASSET_CACHE_PREFIX}test`)!.store.keys()]).toEqual([
            `${SCOPE}assets/b.js`, `${SCOPE}assets/c.js`,
        ]);
    });

    it('淘汰旧文件时不动开机 CDN', async () => {
        const tw = 'https://cdn.tailwindcss.com/3.4.17';
        const { storage, shell, waitUntil, settle } = setup(
            async (input) => fakeResponse({ url: input.url, type: input.url === tw ? 'opaque' : 'basic' }),
            { maxAssetEntries: 1 },
        );
        await shell.handle({ url: tw, method: 'GET', mode: 'no-cors' }, 'boot-cdn', waitUntil);
        await settle();
        for (const name of ['a', 'b']) {
            await shell.handle({ url: `${SCOPE}assets/${name}.js`, method: 'GET' }, 'static', waitUntil);
            await settle();
        }
        expect([...storage.caches.get(`${ASSET_CACHE_PREFIX}test`)!.store.keys()]).toEqual([tw, `${SCOPE}assets/b.js`]);
    });

    it('CDN 有缓存先用缓存，后台重新取一份换掉存坏的', async () => {
        const tw = 'https://cdn.tailwindcss.com/3.4.17';
        const { storage, shell, waitUntil, settle } = setup(async () => fakeResponse({ type: 'opaque', status: 0, url: '', body: 'FRESH' }));
        const cache = await storage.open(`${ASSET_CACHE_PREFIX}test`);
        await cache.put(tw, fakeResponse({ type: 'opaque', status: 0, url: '', body: 'BROKEN' }));
        const served = await shell.handle({ url: tw, method: 'GET', mode: 'no-cors' }, 'boot-cdn', waitUntil);
        expect(bodyOf(served)).toBe('BROKEN');
        await settle();
        expect(bodyOf((await cache.match(tw))!)).toBe('FRESH');
    });

    it('CDN 收 opaque、拒 cors 的错误响应', async () => {
        const tw = 'https://cdn.tailwindcss.com/';
        const ok = setup(async () => fakeResponse({ type: 'opaque', status: 0, url: '' }));
        await ok.shell.handle({ url: tw, method: 'GET', mode: 'no-cors' }, 'boot-cdn', ok.waitUntil);
        await ok.settle();
        expect(ok.storage.caches.get(`${ASSET_CACHE_PREFIX}test`)!.store.has(tw)).toBe(true);

        const katex = 'https://unpkg.com/katex@0.16.9/dist/katex.min.css';
        const bad = setup(async () => fakeResponse({ type: 'cors', status: 500, url: katex }));
        await bad.shell.handle({ url: katex, method: 'GET', mode: 'cors' }, 'boot-cdn', bad.waitUntil);
        await bad.settle();
        expect(bad.storage.caches.get(`${ASSET_CACHE_PREFIX}test`)?.store.has(katex) ?? false).toBe(false);
    });
});

describe('install / activate', () => {
    it('precache：登录页网络下不写缓存也不抛错', async () => {
        const { storage, shell } = setup(async () => fakeResponse({ redirected: true, url: 'https://portal.example/' }));
        await expect(shell.precache()).resolves.toBeUndefined();
        expect(storage.caches.get(`${SHELL_CACHE_PREFIX}test`)?.store.size ?? 0).toBe(0);
    });

    it('precache：断网也不让安装失败', async () => {
        const { shell } = setup(async () => { throw new TypeError('offline'); });
        await expect(shell.precache()).resolves.toBeUndefined();
    });

    it('precache：正常时存 shell 和入口资源，katex 用 cors 取', async () => {
        const { storage, shell, fetch } = setup(async (input) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url === SCOPE) return fakeResponse();
            if (url.startsWith(SCOPE)) return fakeResponse({ url, contentType: 'text/javascript' });
            return fakeResponse({ type: url.includes('katex') ? 'cors' : 'opaque', status: url.includes('katex') ? 200 : 0, url });
        });
        await shell.precache();
        expect(storage.caches.get(`${SHELL_CACHE_PREFIX}test`)!.store.has(SCOPE)).toBe(true);
        const katexCall = fetch.mock.calls.find(([u]) => String(u).includes('katex'));
        expect(katexCall?.[1]).toMatchObject({ mode: 'cors' });
        const twCall = fetch.mock.calls.find(([u]) => String(u).includes('tailwind'));
        expect(twCall?.[1]).toMatchObject({ mode: 'no-cors' });
        expect(storage.caches.get(`${ASSET_CACHE_PREFIX}test`)!.store.size).toBe(7);
    });

    it('cleanup 只删自己前缀的旧版本缓存', async () => {
        const { storage, shell } = setup(async () => fakeResponse());
        for (const name of [`${SHELL_CACHE_PREFIX}old`, `${ASSET_CACHE_PREFIX}old`, `${SHELL_CACHE_PREFIX}test`, `${ASSET_CACHE_PREFIX}test`, 'someone-else']) {
            await storage.open(name);
        }
        await shell.cleanup();
        expect((await storage.keys()).sort()).toEqual([`${ASSET_CACHE_PREFIX}test`, `${SHELL_CACHE_PREFIX}test`, 'someone-else'].sort());
    });
});

describe('按构建清单预缓存全部代码块', () => {
    const MANIFEST = {
        files: [
            'assets/index-abc123.js', 'assets/index-xyz.css', 'assets/Chat-111.js', 'assets/Chat-222.css',
            'assets/Settings-333.js', 'assets/pdf.worker.min-444.js', 'assets/vectorSearchWorker-555.js',
            42, '', '../escape.js',
        ],
    };

    it('extractManifestUrls 取出全部产物（含 Web Worker），坏条目和 scope 外的不要', () => {
        expect(extractManifestUrls(MANIFEST, SCOPE).sort()).toEqual([
            `${SCOPE}assets/Chat-111.js`,
            `${SCOPE}assets/Chat-222.css`,
            `${SCOPE}assets/Settings-333.js`,
            `${SCOPE}assets/index-abc123.js`,
            `${SCOPE}assets/index-xyz.css`,
            `${SCOPE}assets/pdf.worker.min-444.js`,
            `${SCOPE}assets/vectorSearchWorker-555.js`,
        ]);
        expect(extractManifestUrls(null, SCOPE)).toEqual([]);
        expect(extractManifestUrls({ files: 'nope' }, SCOPE)).toEqual([]);
    });

    const networkWithManifest = (manifest: unknown, onFetch?: (url: string) => void) => async (input: any) => {
        const url = typeof input === 'string' ? input : input.url;
        onFetch?.(url);
        if (url === SCOPE) return fakeResponse();
        if (url === `${SCOPE}${PRECACHE_MANIFEST_FILE}`) {
            return manifest === undefined
                ? fakeResponse({ url, status: 404, body: 'not found' })
                : fakeResponse({ url, contentType: 'application/json', body: JSON.stringify(manifest) });
        }
        if (url.startsWith(SCOPE)) return fakeResponse({ url, contentType: 'text/javascript', body: url });
        return fakeResponse({ type: 'opaque', status: 0, url: '' });
    };

    it('precache 后没打开过的 App 代码块也在缓存里', async () => {
        const { storage, shell } = setup(networkWithManifest(MANIFEST));
        await shell.precache();
        const assets = storage.caches.get(`${ASSET_CACHE_PREFIX}test`)!;
        for (const name of ['Chat-111.js', 'Chat-222.css', 'Settings-333.js', 'pdf.worker.min-444.js', 'vectorSearchWorker-555.js']) {
            expect(assets.store.has(`${SCOPE}assets/${name}`)).toBe(true);
        }
    });

    it('联网打开时补齐缺的代码块，已缓存的不重复下载', async () => {
        const fetched: string[] = [];
        const { storage, navigate, settle } = setup(networkWithManifest(MANIFEST, u => fetched.push(u)));
        const assets = await storage.open(`${ASSET_CACHE_PREFIX}test`);
        await assets.put(`${SCOPE}assets/Chat-111.js`, fakeResponse({ url: `${SCOPE}assets/Chat-111.js` }));
        await navigate();
        await settle();
        expect(fetched).not.toContain(`${SCOPE}assets/Chat-111.js`);
        expect(fetched).toContain(`${SCOPE}assets/Settings-333.js`);
        expect(assets.store.has(`${SCOPE}assets/Settings-333.js`)).toBe(true);
    });

    it('清单拿不到（旧部署 / 开发环境）时照旧只补 index.html 里的资源', async () => {
        const { storage, shell } = setup(networkWithManifest(undefined));
        await shell.precache();
        const assets = storage.caches.get(`${ASSET_CACHE_PREFIX}test`)!;
        expect(assets.store.has(`${SCOPE}assets/index-abc123.js`)).toBe(true);
        expect(assets.store.has(`${SCOPE}assets/Settings-333.js`)).toBe(false);
    });

    it('同时最多 6 个下载', async () => {
        const big = { files: Array.from({ length: 30 }, (_, i) => `assets/chunk-${i}.js`) };
        let inFlight = 0;
        let peak = 0;
        const base = networkWithManifest(big);
        const { shell } = setup(async (input: any) => {
            const url = typeof input === 'string' ? input : input.url;
            if (!url.includes('/assets/chunk-')) return base(input);
            inFlight++; peak = Math.max(peak, inFlight);
            await new Promise(r => setTimeout(r, 1));
            inFlight--;
            return fakeResponse({ url, contentType: 'text/javascript' });
        });
        await shell.precache();
        expect(peak).toBeLessThanOrEqual(6);
        expect(peak).toBeGreaterThan(1);
    });
});
