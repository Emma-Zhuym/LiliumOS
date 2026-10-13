/**
 * Service Worker 离线 app shell（EM 独有，worker/sw-keep-alive.ts 引入）。
 *
 * 起因：2026-10 在飞机上连了没登录的 Southwest Wi-Fi，之后每次打开 PWA 都闪一下就被
 * 带去 Wi-Fi 登录页，清了 Safari 缓存才好。SW 原来没有 fetch handler，App 每次启动全靠网络，
 * 网络给什么就显示什么。这里补三条路：
 *
 *   - 打开 App（导航到 scope 根 / index.html）：网络优先，3 秒没回来或回来的不像本站页面，
 *     就用缓存的 index.html。「像本站页面」的条件见 isUsableShellResponse，缺一条都不算，
 *     所以登录页的跳转既不会显示，也不会被存下来。
 *   - 本站静态资源（assets/ 带 hash 的 JS/CSS、icons/、manifest）：缓存优先。
 *   - 开机必需的三个 CDN（Tailwind 运行时、Google Fonts CSS、KaTeX CSS）：缓存优先。
 *     它们在 index.html 里是阻塞渲染的，断网时拿不到就是一屏没样式、或者白屏等超时。
 *     名单写死，除此之外的跨域请求（各家 API、Worker、其他 CDN）一律不拦、不存。
 *
 * 不碰 IndexedDB / localStorage，只用 Cache Storage 里自己前缀的两个缓存。
 */

export const SHELL_CACHE_PREFIX = 'liliumos-shell-';
export const ASSET_CACHE_PREFIX = 'liliumos-assets-';
export const NAVIGATION_TIMEOUT_MS = 3_000;
export const PRECACHE_TIMEOUT_MS = 20_000;
// 部署一次换一批 hash，旧文件只会越积越多；按写入顺序淘汰最早的。
export const ASSET_CACHE_MAX_ENTRIES = 400;

const SAME_ORIGIN_STATIC_PREFIXES = ['assets/', 'icons/'];
const SAME_ORIGIN_STATIC_FILES = ['manifest.webmanifest'];

export const BOOT_CDN_PREFIXES = [
    'https://cdn.tailwindcss.com/',
    'https://fonts.googleapis.com/css2',
    'https://unpkg.com/katex@',
];

export type AppShellRoute = 'shell' | 'static' | 'boot-cdn';

export interface ResponseLike {
    type: string;
    ok: boolean;
    status: number;
    url: string;
    redirected?: boolean;
    headers: { get(name: string): string | null };
}

export interface RequestLike {
    url: string;
    method: string;
    mode?: string;
}

export interface CacheLike {
    match(request: string, options?: CacheQueryOptions): Promise<Response | undefined>;
    put(request: string, response: Response): Promise<void>;
    keys(): Promise<ReadonlyArray<{ url: string }>>;
    delete(request: string): Promise<boolean>;
}

export interface CacheStorageLike {
    open(name: string): Promise<CacheLike>;
    keys(): Promise<string[]>;
    delete(name: string): Promise<boolean>;
}

export interface AppShellDeps {
    /** registration.scope，例如 https://emma-zhuym.github.io/LiliumOS/ */
    scope: string;
    /** 跟 SW_VERSION 走：SW 升级时整套缓存换新，旧的在 activate 清掉。 */
    version: string;
    fetch: (input: string | RequestLike, init?: RequestInit) => Promise<Response>;
    caches: CacheStorageLike;
    timeoutMs?: number;
    precacheTimeoutMs?: number;
    maxAssetEntries?: number;
    log?: (event: string, extra?: Record<string, unknown>) => void;
}

const MATCH_OPTIONS: CacheQueryOptions = { ignoreVary: true };

const stripSearchAndHash = (url: string): string => {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
};

export function isInScope(url: string, scope: string): boolean {
    try {
        return stripSearchAndHash(url).startsWith(stripSearchAndHash(scope));
    } catch {
        return false;
    }
}

/** scope 根和 scope/index.html 都是同一个 shell；查询参数（?openApp=chat）不影响。 */
export function isShellUrl(url: string, scope: string): boolean {
    try {
        const path = stripSearchAndHash(url);
        const root = stripSearchAndHash(scope);
        return path === root || path === `${root}index.html`;
    } catch {
        return false;
    }
}

/**
 * 网络回来的导航响应要全部满足才算本站页面：同源 basic、2xx、没被重定向过、
 * 最终地址仍在 scope 内、是 HTML。任何一条不满足（登录页跳转、opaqueredirect、
 * 被劫持成别的类型、5xx）都当失败。
 */
export function isUsableShellResponse(res: ResponseLike | null | undefined, scope: string): boolean {
    if (!res) return false;
    if (res.type !== 'basic') return false;
    if (!res.ok || res.status !== 200) return false;
    if (res.redirected) return false;
    if (!res.url || !isInScope(res.url, scope)) return false;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    return contentType.includes('text/html');
}

/** 本站静态资源：同源 basic、200（206 分段不能进缓存）、没跳转、在 scope 内。 */
export function isUsableStaticResponse(res: ResponseLike | null | undefined, scope: string): boolean {
    if (!res) return false;
    if (res.type !== 'basic') return false;
    if (res.status !== 200) return false;
    if (res.redirected) return false;
    return Boolean(res.url) && isInScope(res.url, scope);
}

/**
 * CDN：no-cors 请求只能拿到 opaque，看不到状态码，照收（走的是 HTTPS，内容是真的；
 * 风险只是偶尔存下一次 5xx，SW 升级换缓存时会重取）。cors 请求要 2xx。
 */
export function isUsableBootCdnResponse(res: ResponseLike | null | undefined): boolean {
    if (!res) return false;
    if (res.type === 'opaque') return true;
    return res.type === 'cors' && res.status === 200;
}

export function isBootCdnUrl(url: string): boolean {
    return BOOT_CDN_PREFIXES.some(prefix => url.startsWith(prefix));
}

export function isStaticUrl(url: string, scope: string): boolean {
    if (!isInScope(url, scope)) return false;
    const rel = stripSearchAndHash(url).slice(stripSearchAndHash(scope).length);
    return SAME_ORIGIN_STATIC_PREFIXES.some(prefix => rel.startsWith(prefix))
        || SAME_ORIGIN_STATIC_FILES.includes(rel);
}

/** 返回 null 表示不拦，交给浏览器照常走网络。 */
export function classifyRequest(req: RequestLike, scope: string): AppShellRoute | null {
    if (req.method !== 'GET') return null;
    if (req.mode === 'navigate') return isShellUrl(req.url, scope) ? 'shell' : null;
    if (isStaticUrl(req.url, scope)) return 'static';
    if (isBootCdnUrl(req.url)) return 'boot-cdn';
    return null;
}

export interface ShellResource {
    url: string;
    route: 'static' | 'boot-cdn';
    /** 标签带 crossorigin 时浏览器发的是 cors 请求，预缓存得用同一种模式，否则存下的 opaque 会被拒收。 */
    cors: boolean;
}

/** 从 index.html 里挑出要预缓存的资源：入口 JS/CSS、modulepreload、图标、manifest 和开机 CDN。 */
export function extractShellResources(html: string, scope: string): ShellResource[] {
    const out = new Map<string, ShellResource>();
    const tagRe = /<(script|link)\b[^>]*>/gi;
    const attrRe = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(html))) {
        const tag = m[0];
        const attr = attrRe(m[1].toLowerCase() === 'script' ? 'src' : 'href').exec(tag);
        const raw = attr ? (attr[1] ?? attr[2] ?? '') : '';
        if (!raw || raw.startsWith('data:')) continue;
        let url: string;
        try {
            url = new URL(raw.replace(/&amp;/g, '&'), scope).toString();
        } catch {
            continue;
        }
        const cors = /\scrossorigin\b/i.test(tag);
        if (isStaticUrl(url, scope)) out.set(url, { url, route: 'static', cors });
        else if (isBootCdnUrl(url)) out.set(url, { url, route: 'boot-cdn', cors });
    }
    return [...out.values()];
}

// SW 里不能 import clayTokens（它顶部引入了 CSS），这几个颜色/圆角照抄 F.appBg / F.surface /
// F.textPrimary / F.textSecondary / F.borderSoft / R.button，改 tokens 时这里跟着改。
export const OFFLINE_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>LiliumOS</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8F9F7;color:#23262A;font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}button{margin-top:16px;min-height:44px;padding:0 20px;border-radius:10px;border:1px solid #E3E6E0;background:#FFFFFF;font-size:15px}</style></head><body><div><p>现在连不上网络，本机还没有可用的离线版本。</p><p style="font-size:13px;color:#5D635F">连上网后打开一次，以后断网也能直接进来。</p><button onclick="location.reload()">重试</button></div></body></html>`;

const offlineResponse = () => new Response(OFFLINE_HTML, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
});

const TIMED_OUT = Symbol('timed-out');

const delay = (ms: number) => new Promise<typeof TIMED_OUT>(resolve => setTimeout(() => resolve(TIMED_OUT), ms));

export function createAppShell(deps: AppShellDeps) {
    const shellCacheName = `${SHELL_CACHE_PREFIX}${deps.version}`;
    const assetCacheName = `${ASSET_CACHE_PREFIX}${deps.version}`;
    const timeoutMs = deps.timeoutMs ?? NAVIGATION_TIMEOUT_MS;
    const maxAssetEntries = deps.maxAssetEntries ?? ASSET_CACHE_MAX_ENTRIES;
    const shellKey = stripSearchAndHash(deps.scope);
    const log = deps.log ?? (() => {});
    type WaitUntil = ((promise: Promise<unknown>) => void) | undefined;
    // 响应已经交出去之后还要做的事（写缓存、补资源），挂到这次 fetch 事件的 waitUntil 上，
    // 免得 SW 被提前回收。
    const background = (promise: Promise<unknown>, waitUntil: WaitUntil) => {
        const safe = promise.catch(err => log('app-shell-background-error', { message: String(err) }));
        waitUntil?.(safe);
        return safe;
    };

    const trimAssets = async (cache: CacheLike) => {
        const keys = await cache.keys();
        const excess = keys.length - maxAssetEntries;
        for (let i = 0; i < excess; i++) await cache.delete(keys[i].url);
    };

    const putAsset = async (url: string, res: Response) => {
        const cache = await deps.caches.open(assetCacheName);
        await cache.put(url, res);
        await trimAssets(cache);
    };

    const fetchShellFromNetwork = () => deps.fetch(shellKey, {
        // no-cache：每次都跟服务器确认（304 照样省流量），不让 HTTP 缓存里的旧东西冒充新页面。
        cache: 'no-cache',
        credentials: 'same-origin',
        redirect: 'follow',
    });

    /** 把新 shell 引用到的资源补进缓存（已有的跳过）。 */
    const warmResources = async (html: string) => {
        const resources = extractShellResources(html, deps.scope);
        const cache = await deps.caches.open(assetCacheName);
        await Promise.all(resources.map(async (r) => {
            if (await cache.match(r.url, MATCH_OPTIONS)) return;
            try {
                const res = r.route === 'static'
                    ? await deps.fetch(r.url, { credentials: 'same-origin' })
                    : await deps.fetch(r.url, { mode: r.cors ? 'cors' : 'no-cors', credentials: 'omit' });
                const usable = r.route === 'static'
                    ? isUsableStaticResponse(res, deps.scope)
                    : isUsableBootCdnResponse(res);
                if (usable) await cache.put(r.url, res);
            } catch {
                // 单个资源取不到不影响别的，下次有新 shell 时再补。
            }
        }));
        await trimAssets(cache);
    };

    /** 校验通过才写进缓存并顺手补资源；返回能交给页面的响应，失败返回 null。 */
    const acceptShell = async (res: Response, waitUntil: WaitUntil): Promise<Response | null> => {
        if (!isUsableShellResponse(res, deps.scope)) {
            log('app-shell-rejected', { type: res.type, status: res.status, url: res.url, redirected: res.redirected });
            return null;
        }
        const forCache = res.clone();
        const forWarm = res.clone();
        background((async () => {
            const cache = await deps.caches.open(shellCacheName);
            await cache.put(shellKey, forCache);
            await warmResources(await forWarm.text());
        })(), waitUntil);
        return res;
    };

    const matchShell = async () => {
        const cache = await deps.caches.open(shellCacheName);
        return cache.match(shellKey, MATCH_OPTIONS);
    };

    const handleShell = async (waitUntil: WaitUntil): Promise<Response> => {
        const network = fetchShellFromNetwork()
            .then(res => acceptShell(res, waitUntil))
            .catch((err) => {
                log('app-shell-network-failed', { message: String(err) });
                return null;
            });
        // 超时后网络那条继续跑，回来了照样更新缓存，下次打开就是新的。
        background(network, waitUntil);
        const first = await Promise.race([network, delay(timeoutMs)]);
        if (first && first !== TIMED_OUT) return first;

        const cached = await matchShell();
        if (cached) {
            log('app-shell-served-from-cache', { reason: first === TIMED_OUT ? 'timeout' : 'network-unusable' });
            return cached;
        }
        // 从没缓存过（第一次就是在登录页网络下打开）：慢网就接着等，真不行给离线提示页，
        // 也不把登录页的内容放进来。
        if (first === TIMED_OUT) {
            const late = await network;
            if (late) return late;
        }
        return offlineResponse();
    };

    const handleStatic = async (req: RequestLike, waitUntil: WaitUntil): Promise<Response> => {
        const cache = await deps.caches.open(assetCacheName);
        const cached = await cache.match(req.url, MATCH_OPTIONS);
        if (cached) return cached;
        const res = await deps.fetch(req);
        if (isUsableStaticResponse(res, deps.scope)) background(putAsset(req.url, res.clone()), waitUntil);
        return res;
    };

    const handleBootCdn = async (req: RequestLike, waitUntil: WaitUntil): Promise<Response> => {
        const cache = await deps.caches.open(assetCacheName);
        const cached = await cache.match(req.url, MATCH_OPTIONS);
        if (cached) return cached;
        const res = await deps.fetch(req);
        if (isUsableBootCdnResponse(res)) background(putAsset(req.url, res.clone()), waitUntil);
        return res;
    };

    return {
        shellCacheName,
        assetCacheName,

        route(req: RequestLike): AppShellRoute | null {
            return classifyRequest(req, deps.scope);
        },

        handle(req: RequestLike, route: AppShellRoute, waitUntil?: WaitUntil): Promise<Response> {
            if (route === 'shell') return handleShell(waitUntil);
            if (route === 'static') return handleStatic(req, waitUntil);
            return handleBootCdn(req, waitUntil);
        },

        /**
         * install 时预缓存。登录页网络下装新 SW 也不能因此装失败，所以吞掉错误、
         * 最多等 PRECACHE_TIMEOUT_MS；没做完的等下次打开拿到新 shell 时补。
         */
        async precache(): Promise<void> {
            const work = (async () => {
                const res = await fetchShellFromNetwork();
                if (!isUsableShellResponse(res, deps.scope)) {
                    log('app-shell-precache-skipped', { type: res.type, status: res.status, url: res.url });
                    return;
                }
                const html = await res.clone().text();
                const cache = await deps.caches.open(shellCacheName);
                await cache.put(shellKey, res);
                await warmResources(html);
            })().catch(err => log('app-shell-precache-failed', { message: String(err) }));
            await Promise.race([work, delay(deps.precacheTimeoutMs ?? PRECACHE_TIMEOUT_MS)]);
        },

        /** activate 时清掉旧版本的缓存；只动自己前缀的，别的缓存一概不碰。 */
        async cleanup(): Promise<void> {
            const names = await deps.caches.keys();
            await Promise.all(names
                .filter(name => (name.startsWith(SHELL_CACHE_PREFIX) || name.startsWith(ASSET_CACHE_PREFIX))
                    && name !== shellCacheName && name !== assetCacheName)
                .map(name => deps.caches.delete(name)));
        },
    };
}
