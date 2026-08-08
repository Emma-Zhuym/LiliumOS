/**
 * 实时上下文管理器 - 让AI角色感知真实世界
 * Real-time Context Manager - Give AI characters awareness of the real world
 */

import { safeResponseJson } from './safeApi';
import { DB } from './db';
import type { NotionDiaryExtraProperty, NotionExtraDatabase } from '../types';
import { getProxyWorkerUrl } from './proxyWorker';
import { nowInTimeZone } from './timezone';
import {
    performSearch as performSearchCore,
    notionGetDiaryByDate,
    notionReadDiaryContent,
    notionSearchUserNotes,
    feishuGetToken,
    feishuGetDiaryByDate,
    type SearchResult,
    type DiaryPreview,
    type FeishuDiaryPreview,
} from './realtimeFetchCore';
import {
    fetchWeatherWithFallback,
    generateWeatherAdvice as generateWeatherAdviceCore,
    checkSpecialDates as checkSpecialDatesCore,
    clearGeocodeCache,
    fetchHotNews as fetchHotNewsCore,
    getHotNewsSlot as getHotNewsSlotCore,
    resolveHotNewsPlatforms,
    sameHotNewsPlatforms,
    pickRandomNews,
    renderRealtimeWorldBlock,
    HOTNEWS_PLATFORM_LABELS,
    DEFAULT_HOTNEWS_PLATFORMS,
    REALTIME_NEWS_PICK_COUNT,
    type WeatherData,
    type NewsItem,
} from './realtimeWorldCore';
import { getLocalDateKey } from './localDate';
import { getMotionContextLine } from './deviceMotion';
// [EM-START: weather-openmeteo]
import { fetchOpenMeteoCurrent, resolveWeatherCoords, type WeatherLocation } from './openMeteo';
export type { WeatherLocation };
// [EM-END: weather-openmeteo]
// 两份环境无关叶子，amsg worker 共用同一份，这里的 Manager 方法委托过去；
// 类型与常量原样 re-export，既有 import 路径不用改：
//   realtimeFetchCore  搜索 / Notion / 飞书的读取类纯 fetch（服务端工具循环用）
//   realtimeWorldCore  天气 / 热搜 / 节日的取数与成段渲染（到点组 prompt 用）
export type { SearchResult, DiaryPreview, FeishuDiaryPreview } from './realtimeFetchCore';
export type { WeatherData, NewsItem } from './realtimeWorldCore';
export {
    fetchOwmWeather,
    fetchOpenMeteoWeather,
    HOTNEWS_API_BASE_URL,
} from './realtimeWorldCore';

export interface RealtimeConfig {
    // 天气配置 [EM-START: weather-openmeteo] Open-Meteo 免 key，坐标查天气
    weatherEnabled: boolean;
    weatherMode: 'geo' | 'city';        // geo=自动定位（默认）；city=固定城市（Settings 搜索选定）
    weatherLocation?: WeatherLocation;  // city 模式选定的城市；geo 模式作定位失败的降级
    /** @deprecated 旧 OWM 字段，仅老备份导入兼容 */
    weatherApiKey?: string;
    /** @deprecated 同上 */
    weatherCity?: string;
    // [EM-END: weather-openmeteo]

    // 新闻配置
    newsEnabled: boolean;
    newsApiKey?: string;    // 可选，Brave Search 回落源用
    newsPlatforms?: string[]; // hot_news 热榜平台 key（默认主源，免鉴权），留空用内置默认

    // Notion 配置
    notionEnabled: boolean;
    notionApiKey: string;   // Notion Integration Token
    notionDatabaseId: string; // 日记数据库ID
    notionNotesDatabaseId?: string; // 用户笔记数据库ID（可选）
    notionDiaryExtraProperties?: NotionDiaryExtraProperty[];
    notionExtraDatabases?: NotionExtraDatabase[];

    // 飞书配置
    feishuEnabled?: boolean;
    feishuAppId?: string;
    feishuAppSecret?: string;
    feishuBaseId?: string;
    feishuTableId?: string;

    // 小红书配置 (xiaohongshu-skills)
    xhsEnabled?: boolean;
    xhsMcpConfig?: {
        enabled: boolean;
        serverUrl: string;
        cookie?: string;        // Lite 模式：登录后的完整小红书 cookie
        rnoteApiKey?: string;   // Lite 模式：用户自备的 Rnote Key，用于真实评论
        loggedInNickname?: string;
        loggedInUserId?: string;
        userXsecToken?: string; // 从 feed 列表自动获取，用于 getUserProfile 等
    };

    // 缓存配置
    cacheMinutes: number;   // 缓存时长（分钟）
}

// 默认配置
export const defaultRealtimeConfig: RealtimeConfig = {
    weatherEnabled: false,
    weatherMode: 'geo', // [EM: weather-openmeteo]
    newsEnabled: false,
    newsApiKey: '',
    newsPlatforms: ['weibo', 'zhihu', 'baidu', 'bilibili', 'douyin'],
    notionEnabled: false,
    notionApiKey: '',
    notionDatabaseId: '',
    notionDiaryExtraProperties: [],
    notionExtraDatabases: [],
    xhsEnabled: false,
    xhsMcpConfig: {
        enabled: false,
        serverUrl: `${getProxyWorkerUrl()}/api`,
        cookie: undefined,
        rnoteApiKey: undefined,
        loggedInNickname: undefined,
        loggedInUserId: undefined,
        userXsecToken: undefined,
    },
    cacheMinutes: 30
};

// 缓存
let weatherCache: { data: WeatherData | null; timestamp: number } = { data: null, timestamp: 0 };
let newsCache: { data: NewsItem[]; timestamp: number } = { data: [], timestamp: 0 };


export const RealtimeContextManager = {

    /**
     * 获取天气信息。填了 OpenWeatherMap key 优先走 OWM，失败或没填 key 时回落免费的 Open-Meteo。
     */
    fetchWeather: async (config: RealtimeConfig): Promise<WeatherData | null> => {
        // [EM-START: weather-openmeteo] OpenWeatherMap → Open-Meteo（免 key，坐标查天气）
        if (!config.weatherEnabled) {
            return null;
        }

        const now = Date.now();
        const cacheMs = config.cacheMinutes * 60 * 1000;

        // 检查缓存（geo 模式缓存窗口内的位移可忽略，key 不带坐标）
        if (weatherCache.data && (now - weatherCache.timestamp) < cacheMs) {
            return weatherCache.data;
        }

        const coords = await resolveWeatherCoords(config.weatherMode || 'geo', config.weatherLocation);
        if (!coords) {
            return null; // 拒权/超时且无已存城市 → 本轮静默跳过天气注入
        }

        const current = await fetchOpenMeteoCurrent(coords.latitude, coords.longitude);
        if (!current) {
            return null;
        }

        const weather: WeatherData = { ...current, city: coords.displayName };

        // 更新缓存
        weatherCache = { data: weather, timestamp: now };

        return weather;
        // [EM-END: weather-openmeteo]
    },

    // 平台名表、默认平台、真正的多平台拉取都住在 realtimeWorldCore（主动消息到点
    // 也要用同一份），这里保留同名入口，「热点」App 与既有调用方不用改。
    HOTNEWS_PLATFORM_LABELS,

    DEFAULT_HOTNEWS_PLATFORMS,

    /**
     * 使用 hot_news（news.orz.ai）获取中文多平台热榜。
     * 免鉴权、半小时刷新。浏览器端优先直连；若被 CORS 拦截则本调用返回 []，
     * 由 fetchNews 自然回落到 Brave / Hacker News。
     */
    fetchHotNews: async (platforms?: string[], perPlatform = 12, total = 240): Promise<NewsItem[]> => {
        const list = resolveHotNewsPlatforms(platforms);
        const final = await fetchHotNewsCore(list, perPlatform, total);

        // ── F12 探针：看角色这次到底召回了哪些热点 ──
        try {
            console.groupCollapsed(`%c[hot_news] 召回 ${final.length} 条 · 平台[${list.join(', ')}]`, 'color:#2563eb;font-weight:bold');
            if (final.length > 0 && typeof console.table === 'function') {
                console.table(final.map((n, i) => ({ '#': i + 1, 平台: n.source, 标题: n.title, 链接: n.url || '' })));
            } else if (final.length === 0) {
                console.warn('[hot_news] 一条都没召回 → fetchNews 将回落到 Brave / Hacker News');
            }
            console.groupEnd();
        } catch { /* 探针挂了也不影响主流程 */ }

        return final;
    },

    // 一天分 6 段（每 4 小时）：0-4 凌晨 / 4-8 清晨 / 8-12 上午 / 12-16 午后 / 16-20 傍晚 / 20-24 夜间。
    getHotNewsSlot: (d: Date = new Date()) => getHotNewsSlotCore({ now: d }),

    // 同一时段并发只真正发一次请求（群聊 / 多角色同时回复时复用同一 Promise）
    _hotNewsInFlight: new Map<string, Promise<NewsItem[]>>(),

    /**
     * 分时段热点：每天每时段最多拉一次，持久化在 IndexedDB，全角色共享。
     * - 本时段已有快照且平台集一致 → 直接复用，不发请求
     * - 否则拉一次并存快照；拉失败则退回最近一次快照（且不写本时段，下次会重试）
     */
    getSlottedHotNews: async (config: RealtimeConfig): Promise<NewsItem[]> => {
        const { id, date, slot, label } = RealtimeContextManager.getHotNewsSlot();
        const platforms = resolveHotNewsPlatforms(config.newsPlatforms);

        // 1. 命中本时段快照（平台一致）→ 复用
        try {
            const snap = await DB.getHotNewsSnapshot(id);
            if (snap && snap.items?.length > 0 && sameHotNewsPlatforms(snap.platforms, platforms)) {
                const mins = Math.round((Date.now() - snap.fetchedAt) / 60000);
                console.log(`%c[hot_news] 命中今日${label}快照（${snap.items.length} 条，${mins} 分钟前拉的）`, 'color:#16a34a');
                return snap.items;
            }
        } catch { /* 读快照失败就当没有，继续去拉 */ }

        // 2. in-flight 锁：本时段已有在飞请求就复用
        const inflight = RealtimeContextManager._hotNewsInFlight.get(id);
        if (inflight) return inflight;

        const job = (async (): Promise<NewsItem[]> => {
            console.log(`%c[hot_news] 触发今日${label}拉取…`, 'color:#2563eb;font-weight:bold');
            const items = await RealtimeContextManager.fetchHotNews(platforms);
            if (items.length > 0) {
                try {
                    await DB.saveHotNewsSnapshot({ id, date, slot, slotLabel: label, items, platforms, fetchedAt: Date.now() });
                    DB.pruneHotNewsSnapshots(12).catch(() => {});
                } catch { /* 存快照失败不影响返回 */ }
                return items;
            }
            // 拉取失败 → 退回最近一次快照（不写本时段，下条消息会再试）
            try {
                const latest = await DB.getLatestHotNewsSnapshot();
                if (latest && latest.items?.length > 0) {
                    console.warn(`[hot_news] ${label}拉取失败，复用最近快照（${latest.date} ${latest.slotLabel}，${latest.items.length} 条）`);
                    return latest.items;
                }
            } catch { /* ignore */ }
            return [];
        })();

        RealtimeContextManager._hotNewsInFlight.set(id, job);
        try {
            return await job;
        } finally {
            RealtimeContextManager._hotNewsInFlight.delete(id);
        }
    },

    /**
     * 使用 Brave Search API 获取新闻（通过自建 Cloudflare Worker 代理）
     */
    fetchBraveNews: async (apiKey: string): Promise<NewsItem[]> => {
        try {
            // 使用自建的 Cloudflare Worker 代理
            const workerUrl = `${getProxyWorkerUrl()}/news?q=热点新闻&count=5&country=cn`;

            const response = await fetch(workerUrl, {
                headers: {
                    'Accept': 'application/json',
                    'X-Brave-API-Key': apiKey  // Worker 需要这个 header
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Brave API error:', response.status, errorText);
                return [];
            }

            const data = await safeResponseJson(response);

            // Brave News API 返回结构
            if (data.results && data.results.length > 0) {
                return data.results.slice(0, 5).map((item: any) => ({
                    title: item.title,
                    source: item.meta_url?.netloc || item.source || 'Brave新闻',
                    url: item.url
                }));
            }
            return [];
        } catch (e) {
            console.error('Brave Search failed:', e);
            return [];
        }
    },

    /**
     * 获取热点新闻
     * 优先级: hot_news 分时段快照（默认主源，每天每时段最多拉一次）> Brave Search API > Hacker News
     */
    fetchNews: async (config: RealtimeConfig): Promise<NewsItem[]> => {
        if (!config.newsEnabled) {
            return [];
        }

        // 1. 默认主源：hot_news 分时段持久化快照（全角色共享，自带 IndexedDB 缓存与 in-flight 锁）
        const slotted = await RealtimeContextManager.getSlottedHotNews(config);
        if (slotted.length > 0) {
            return slotted;
        }

        // ── 回落源用内存缓存兜一下，避免降级态下每条消息都打 Brave/HN ──
        const now = Date.now();
        const cacheMs = config.cacheMinutes * 60 * 1000;
        if (newsCache.data.length > 0 && (now - newsCache.timestamp) < cacheMs) {
            return newsCache.data;
        }

        let news: NewsItem[] = [];

        // 2. 回落：Brave Search API（需 key，走 Worker 代理）
        if (config.newsApiKey) {
            news = await RealtimeContextManager.fetchBraveNews(config.newsApiKey);
            if (news.length > 0) {
                console.log(`%c[hot_news] 本次新闻源 = Brave 回落（${news.length} 条）`, 'color:#d97706;font-weight:bold');
                newsCache = { data: news, timestamp: now };
                return news;
            }
        }

        // 3. 兜底：Hacker News（英文但稳定，无CORS限制）
        news = await RealtimeContextManager.fetchBackupNews();
        if (news.length > 0) {
            console.log(`%c[hot_news] 本次新闻源 = Hacker News 兜底（${news.length} 条，英文）`, 'color:#dc2626;font-weight:bold');
            newsCache = { data: news, timestamp: now };
        }
        return news;
    },

    /**
     * 备用新闻源 - 使用Hacker News API（总是可用）
     */
    fetchBackupNews: async (): Promise<NewsItem[]> => {
        try {
            const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
            if (!response.ok) return [];

            const ids = await safeResponseJson(response);
            const topIds = ids.slice(0, 5);

            const stories = await Promise.all(
                topIds.map(async (id: number) => {
                    const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
                    return safeResponseJson(storyRes);
                })
            );

            return stories.map((s: any) => ({
                title: s.title,
                source: 'Hacker News',
                url: s.url
            }));
        } catch (e) {
            return [];
        }
    },

    /**
     * 获取时间上下文
     */
    getTimeContext: (tz?: string) => {
        const now = nowInTimeZone(tz);
        const hour = now.getHours();
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const dayOfWeek = dayNames[now.getDay()];

        let timeOfDay = '凌晨';
        let mood = '安静';

        if (hour >= 5 && hour < 9) {
            timeOfDay = '早晨';
            mood = '清新';
        } else if (hour >= 9 && hour < 12) {
            timeOfDay = '上午';
            mood = '精神';
        } else if (hour >= 12 && hour < 14) {
            timeOfDay = '中午';
            mood = '放松';
        } else if (hour >= 14 && hour < 17) {
            timeOfDay = '下午';
            mood = '平静';
        } else if (hour >= 17 && hour < 19) {
            timeOfDay = '傍晚';
            mood = '慵懒';
        } else if (hour >= 19 && hour < 22) {
            timeOfDay = '晚上';
            mood = '温馨';
        } else if (hour >= 22 || hour < 5) {
            timeOfDay = '深夜';
            mood = '安静';
        }

        return {
            timestamp: now.toISOString(),
            dateStr: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`,
            timeStr: `${hour.toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
            dayOfWeek,
            timeOfDay,
            mood,
            hour,
            isWeekend: now.getDay() === 0 || now.getDay() === 6
        };
    },

    /**
     * 检查特殊日期。
     * tz 非空时按角色所在时区判「今天几号」——否则角色会跟着用户的日历过节：
     * 用户这边 2/14 早上，角色在纽约还是 13 号晚上，却被告知今天是情人节。
     */
    checkSpecialDates: (tz?: string): string[] => checkSpecialDatesCore(tz),

    /**
     * 生成天气建议
     */
    generateWeatherAdvice: (weather: WeatherData): string => generateWeatherAdviceCore(weather),

    /**
     * 构建完整的实时上下文（注入到系统提示词）。
     * 取数在这里（天气两源 + 热点分时段快照），拼成话交给 realtimeWorldCore 的
     * renderRealtimeWorldBlock——主动消息到点生成时 worker 自己取数、调同一个渲染，
     * 两边说的是同一套话。
     */
    buildFullContext: async (
        config: RealtimeConfig,
        tz: string | undefined,
        // includeTime=false：角色关掉了「时间感知」。天气/新闻还要，但当前时间和今日节日
        // 属于时间感知的范畴，这个开关关着就不该从这一段里漏出去。
        opts: { includeTime: boolean },
    ): Promise<string> => {
        const includeTime = opts.includeTime;

        // 1. 时间与节日。tz 非空时按角色所在时区折算，两者同一个时区，否则同一段里
        //    日期和节日会打架。时差提示（tzAwarenessNote）统一由 ContextBuilder.buildCoreContext
        //    注入，这里不再追加，避免双份。
        const time = includeTime ? RealtimeContextManager.getTimeContext(tz) : null;
        const timeLine = time ? `${time.dateStr} ${time.dayOfWeek} ${time.timeOfDay} ${time.timeStr}` : undefined;
        const specialDates = includeTime ? RealtimeContextManager.checkSpecialDates(tz) : [];

        // 2. 天气（有没有 OWM key 都能取：无 key 走 Open-Meteo）
        const weather = config.weatherEnabled ? await RealtimeContextManager.fetchWeather(config) : null;

        // 3. 新闻热点（背景认知）
        //    完整快照存 IndexedDB 给「热点」App；这里每轮随机抽几条打散注入，控 token + 保持新鲜感。
        const newsPool = config.newsEnabled ? await RealtimeContextManager.fetchNews(config) : [];
        const picks = pickRandomNews(newsPool, REALTIME_NEWS_PICK_COUNT);

        let fullContext = renderRealtimeWorldBlock({ timeLine, specialDates, weather, news: picks });
        // [EM: device-motion] 运动状态来自本机传感器，worker 无法代取。
        const motionLine = getMotionContextLine();
        if (motionLine) fullContext += `\n${motionLine}`;

        // ── F12 探针：本轮真正注入 prompt 的热点 + 文本量（评估 token 用）──
        try {
            const pickDesc = picks.filter(n => n.desc).length;
            const poolDesc = newsPool.filter(n => n.desc).length;
            console.groupCollapsed(`%c[hot_news] 本轮注入 prompt：${picks.length} 条热点（带简介 ${pickDesc}）· 整段 ${fullContext.length} 字（池子共 ${newsPool.length} 条，带简介 ${poolDesc}）`, 'color:#7c3aed;font-weight:bold');
            if (typeof console.table === 'function') {
                console.table(picks.map((n, i) => ({ '#': i + 1, 平台: n.source || '', 标题: n.title, 简介: n.desc || '—' })));
            }
            console.log(fullContext);
            console.groupEnd();
        } catch { /* 探针不影响主流程 */ }
        return fullContext;
    },

    /**
     * 清除缓存
     */
    clearCache: () => {
        weatherCache = { data: null, timestamp: 0 };
        newsCache = { data: [], timestamp: 0 };
        clearGeocodeCache();
    },

    /**
     * 主动搜索 - 让AI角色能够主动搜索任意内容
     * Active Search - Let AI characters actively search for anything
     */
    performSearch: async (query: string, apiKey: string): Promise<{ success: boolean; results: SearchResult[]; message: string }> => {
        return performSearchCore(query, apiKey);
    }
};

// ============================================
// Notion 集成模块
// ============================================

export interface NotionDiaryEntry {
    title: string;
    content: string;
    mood?: string;
    date?: string;
    tags?: string[];
    characterName?: string;  // 角色名，用于区分不同角色的日记
}

function normOptName(s: string): string {
    return (s || '').normalize('NFKC').replace(/\u200b/g, '').trim();
}

/** 角色名：优先 entry.characterName；为空时从标题前缀 [xxx] 解析 */
function effectiveCharacterName(entry: NotionDiaryEntry): string {
    const n = (entry.characterName || '').replace(/\u200b/g, '').trim();
    if (n) return n;
    const title = (entry.title || '').trim();
    const m = title.match(/^\[([^\]]+?)\]\s*/);
    return m ? m[1].replace(/\u200b/g, '').trim() : '';
}

/** 设置里的属性名 → Notion 数据库真实 property key */
function resolveCanonicalPropertyKey(props: Record<string, unknown>, userKey: string): string | null {
    const t = (userKey || '').trim();
    if (!t || !props || typeof props !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(props, t)) return t;
    const normUser = normOptName(t);
    for (const k of Object.keys(props)) {
        if (normOptName(k) === normUser) return k;
    }
    const lower = t.toLowerCase();
    for (const k of Object.keys(props)) {
        if (k.toLowerCase() === lower) return k;
    }
    return null;
}

type NotionOption = { id?: string; name?: string };

function findBestSelectOption(opts: NotionOption[] | undefined, wantRaw: string): NotionOption | null {
    if (!opts?.length) return null;
    const want = normOptName(wantRaw);
    if (!want) return null;
    let opt = opts.find(o => normOptName(o.name || '') === want);
    if (opt) return opt;
    const wantSp = want.replace(/\s+/g, ' ');
    opt = opts.find(o => normOptName(o.name || '').replace(/\s+/g, ' ') === wantSp);
    if (opt) return opt;
    const partial = opts.filter(o => {
        const n = normOptName(o.name || '');
        if (n.length < 2 || want.length < 2) return false;
        return n.includes(want) || want.includes(n);
    });
    const only = partial.length === 1 ? partial[0] : undefined;
    return only ?? null;
}

/** 将设置里的额外属性模板转为 Notion API properties 片段（不含 Name/Date） */
function buildNotionDiaryExtraPropertiesApi(
    defs: NotionDiaryExtraProperty[] | undefined,
    entry: NotionDiaryEntry,
    dateStr: string,
    schema: Record<string, unknown> | null
): Record<string, unknown> {
    if (!defs?.length) return {};
    const charName = effectiveCharacterName(entry);
    const applyTpl = (tpl: string) =>
        (tpl || '')
            .replace(/\$\{char\}/g, charName)
            .replace(/\$\{date\}/g, dateStr)
            .replace(/\$\{mood\}/g, (entry.mood || '').trim())
            .replace(/\$\{title\}/g, (entry.title || '').trim());
    const propsSchema = (schema?.properties || {}) as Record<string, { type?: string; select?: { options?: NotionOption[] }; status?: { options?: NotionOption[] }; multi_select?: { options?: NotionOption[] } }>;
    const hasSchema = Object.keys(propsSchema).length > 0;
    const out: Record<string, unknown> = {};
    for (const d of defs) {
        const key = (d.propertyName || '').trim();
        if (!key || key === 'Name' || key === 'Date') continue;
        const canonicalKey = hasSchema ? resolveCanonicalPropertyKey(propsSchema as Record<string, unknown>, key) ?? key : key;
        const raw = applyTpl(d.valueTemplate).replace(/\u200b/g, '').trim(); // 去零宽字符
        const want = normOptName(raw);
        const t = String(d.notionType || 'rich_text').toLowerCase() as NotionDiaryExtraProperty['notionType'];
        const propMeta = propsSchema[canonicalKey];

        // 有数据库 schema 时：按 Notion 里真实列类型写，Select/Status/Multi 优先用选项 id（比只传 name 稳）
        if (want && propMeta?.type === 'select') {
            const opts = propMeta.select?.options || [];
            const opt = findBestSelectOption(opts, raw);
            out[canonicalKey] = opt?.id ? { select: { id: opt.id } } : { select: { name: raw.slice(0, 100) } };
            continue;
        }
        if (want && propMeta?.type === 'status') {
            const opts = propMeta.status?.options || [];
            const opt = findBestSelectOption(opts, raw);
            out[canonicalKey] = opt?.id ? { status: { id: opt.id } } : { status: { name: raw.slice(0, 100) } };
            continue;
        }
        if (want && propMeta?.type === 'multi_select') {
            const opts = propMeta.multi_select?.options || [];
            const opt = findBestSelectOption(opts, raw);
            out[canonicalKey] = opt?.id ? { multi_select: [{ id: opt.id }] } : { multi_select: [{ name: raw.slice(0, 100) }] };
            continue;
        }

        switch (t) {
            case 'rich_text':
                out[canonicalKey] = { rich_text: [{ text: { content: raw.slice(0, 2000) } }] };
                break;
            case 'select':
                out[canonicalKey] = raw ? { select: { name: raw.slice(0, 100) } } : { select: null };
                break;
            case 'status':
                out[canonicalKey] = raw ? { status: { name: raw.slice(0, 100) } } : { status: null };
                break;
            case 'multi_select':
                out[canonicalKey] = raw ? { multi_select: [{ name: raw.slice(0, 100) }] } : { multi_select: [] };
                break;
            case 'number': {
                const n = parseFloat(raw.replace(/,/g, ''));
                out[canonicalKey] = { number: Number.isFinite(n) ? n : 0 };
                break;
            }
            case 'checkbox':
                out[canonicalKey] = { checkbox: /^(1|true|yes|是|on)$/i.test(raw) };
                break;
            default:
                break;
        }
    }
    return out;
}

export const NotionManager = {

    // Worker 代理地址（中心配置，用户可在设置里换成自部署实例）
    get WORKER_URL() { return getProxyWorkerUrl(); },

    /**
     * 测试 Notion 连接（通过 Worker 代理）
     */
    testConnection: async (apiKey: string, databaseId: string): Promise<{ success: boolean; message: string }> => {
        try {
            const response = await fetch(`${NotionManager.WORKER_URL}/notion/database/${databaseId}`, {
                method: 'GET',
                headers: {
                    'X-Notion-API-Key': apiKey
                }
            });

            const text = await response.text();

            if (!response.ok) {
                try {
                    const errJson = JSON.parse(text);
                    return { success: false, message: `连接失败: ${errJson.error || errJson.message || response.status}` };
                } catch {
                    return { success: false, message: `连接失败: ${response.status}` };
                }
            }

            try {
                const data = JSON.parse(text);
                return { success: true, message: `连接成功！数据库: ${data.title?.[0]?.plain_text || databaseId}` };
            } catch {
                return { success: false, message: '返回格式错误' };
            }
        } catch (e: any) {
            const msg = String(e?.message || e);
            // fetch 在请求根本没到达服务器时抛 TypeError（Safari 报 "Load failed"、
            // Chrome 报 "Failed to fetch"），说明是代理 Worker 不可达，不是 Notion 拒绝了 Key
            if (/load failed|failed to fetch|networkerror/i.test(msg)) {
                return { success: false, message: `无法连接到代理服务器 ${NotionManager.WORKER_URL}：请先在浏览器里试试能否直接打开该地址。打不开说明当前网络访问不了它（换网络/开代理后重试），或在「设置 → 网络代理 (Worker)」填入自部署的 Worker 地址` };
            }
            return { success: false, message: `网络错误: ${msg}` };
        }
    },

    /** 拉取数据库 JSON（含 properties 与各列选项 id），供写入时对齐 Select */
    fetchDatabaseJson: async (apiKey: string, databaseId: string): Promise<Record<string, unknown> | null> => {
        try {
            const response = await fetch(`${NotionManager.WORKER_URL}/notion/database/${databaseId}`, {
                method: 'GET',
                headers: { 'X-Notion-API-Key': apiKey }
            });
            if (!response.ok) return null;
            return (await response.json()) as Record<string, unknown>;
        } catch {
            return null;
        }
    },

    /**
     * 创建日记页面（通过 Worker 代理）- 花里胡哨美化版 ✨
     * 支持 Markdown 格式的日记内容，自动转换为丰富的 Notion blocks
     * 附加列会先拉库 schema，Select 等尽量用选项 id
     */
    createDiaryPage: async (
        apiKey: string,
        databaseId: string,
        entry: NotionDiaryEntry,
        extraPropertyDefs?: NotionDiaryExtraProperty[]
    ): Promise<{ success: boolean; pageId?: string; url?: string; message: string; appliedExtrasHint?: string }> => {
        try {
            const now = new Date();
            const dateStr = entry.date || getLocalDateKey(now);

            // 使用 markdown 解析器生成丰富的 Notion blocks
            const children = parseMarkdownToNotionBlocks(entry.content, entry.mood, entry.characterName);

            // 构建页面数据，标题包含角色名便于筛选
            const titlePrefix = entry.characterName ? `[${entry.characterName}] ` : '';
            const moodEmoji = getMoodEmoji(entry.mood || '平静');
            let dbSchema: Record<string, unknown> | null = null;
            if (extraPropertyDefs?.length) {
                dbSchema = await NotionManager.fetchDatabaseJson(apiKey, databaseId);
            }
            const extraProps = buildNotionDiaryExtraPropertiesApi(extraPropertyDefs, entry, dateStr, dbSchema);
            const pageData = {
                parent: { database_id: databaseId },
                icon: { emoji: moodEmoji },
                properties: {
                    'Name': {
                        title: [{ text: { content: `${titlePrefix}${entry.title || dateStr + ' 的日记'}` } }]
                    },
                    'Date': {
                        date: { start: dateStr }
                    },
                    ...extraProps
                },
                children
            };
            const extraKeys = Object.keys(extraProps);
            let appliedExtrasHint: string | undefined;
            if (extraKeys.length > 0) {
                const propsRaw = (dbSchema?.properties || {}) as Record<string, unknown>;
                const hasSch = Object.keys(propsRaw).length > 0;
                const charForTpl = effectiveCharacterName(entry);
                const parts: string[] = [];
                for (const d of extraPropertyDefs || []) {
                    const rawKey = (d.propertyName || '').trim();
                    if (!rawKey) continue;
                    const canon = hasSch ? resolveCanonicalPropertyKey(propsRaw, rawKey) ?? rawKey : rawKey;
                    if (!Object.prototype.hasOwnProperty.call(extraProps, canon)) continue;
                    const tplVal = (d.valueTemplate || '')
                        .replace(/\$\{char\}/g, charForTpl)
                        .replace(/\$\{date\}/g, dateStr)
                        .replace(/\$\{mood\}/g, (entry.mood || '').trim())
                        .replace(/\$\{title\}/g, (entry.title || '').trim())
                        .replace(/\u200b/g, '')
                        .trim();
                    parts.push(tplVal ? `${canon}=${tplVal.slice(0, 32)}` : canon);
                }
                appliedExtrasHint =
                    parts.length > 0
                        ? `附加列: ${parts.join('、')}${dbSchema ? '' : '（未拉到库结构）'}`
                        : `附加列: ${extraKeys.join('、')}${dbSchema ? '' : '（未拉到库结构，已按名称写入）'}`;
            }
            if (extraKeys.length > 0) {
                console.debug('[Notion createDiaryPage] extra properties:', JSON.stringify(extraProps));
            }

            const response = await fetch(`${NotionManager.WORKER_URL}/notion/pages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Notion-API-Key': apiKey
                },
                body: JSON.stringify(pageData)
            });

            const text = await response.text();

            if (!response.ok) {
                try {
                    const errJson = JSON.parse(text) as { message?: string; error?: string; code?: string };
                    const detail = errJson.message || errJson.error || text.slice(0, 280);
                    return { success: false, message: `写入失败: ${detail}` };
                } catch {
                    return { success: false, message: `写入失败: ${response.status}` };
                }
            }

            try {
                const data = JSON.parse(text);
                return {
                    success: true,
                    pageId: data.id,
                    url: data.url,
                    message: '日记已写入Notion!',
                    appliedExtrasHint
                };
            } catch {
                return { success: false, message: '返回格式错误' };
            }
        } catch (e: any) {
            return { success: false, message: `网络错误: ${e.message}` };
        }
    },

    /**
     * 获取角色最近的日记（通过 Worker 代理）
     */
    getRecentDiaries: async (
        apiKey: string,
        databaseId: string,
        characterName: string,
        limit: number = 5
    ): Promise<{ success: boolean; entries: DiaryPreview[]; message: string }> => {
        try {
            const response = await fetch(`${NotionManager.WORKER_URL}/notion/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Notion-API-Key': apiKey
                },
                body: JSON.stringify({
                    database_id: databaseId,
                    filter: {
                        property: 'Name',
                        title: {
                            starts_with: `[${characterName}]`
                        }
                    },
                    sorts: [{ property: 'Date', direction: 'descending' }],
                    page_size: limit
                })
            });

            const text = await response.text();

            if (!response.ok) {
                console.error('Query diaries failed:', response.status, text);
                return { success: false, entries: [], message: `查询失败: ${response.status}` };
            }

            const data = JSON.parse(text);

            if (!data.results || data.results.length === 0) {
                return { success: true, entries: [], message: '暂无日记' };
            }

            const entries: DiaryPreview[] = data.results.map((page: any) => {
                const title = page.properties?.Name?.title?.[0]?.plain_text || '无标题';
                // 移除角色名前缀，只保留实际标题
                const cleanTitle = title.replace(/^\[.*?\]\s*/, '');
                return {
                    id: page.id,
                    title: cleanTitle,
                    date: page.properties?.Date?.date?.start || '',
                    url: page.url
                };
            });

            return { success: true, entries, message: '获取成功' };
        } catch (e: any) {
            console.error('Get diaries failed:', e);
            return { success: false, entries: [], message: `获取失败: ${e.message}` };
        }
    },

    /**
     * 按日期查找角色的日记（通过 Worker 代理）
     * 支持一天多篇日记，全部返回
     */
    getDiaryByDate: async (
        apiKey: string,
        databaseId: string,
        characterName: string,
        date: string  // YYYY-MM-DD
    ): Promise<{ success: boolean; entries: DiaryPreview[]; message: string }> => {
        return notionGetDiaryByDate(apiKey, databaseId, characterName, date);
    },

    /**
     * 读取日记页面的完整内容（通过 Worker 代理）
     * 调用 /notion/blocks/:pageId 端点，将 blocks 转换为可读文本
     */
    readDiaryContent: async (
        apiKey: string,
        pageId: string
    ): Promise<{ success: boolean; content: string; message: string }> => {
        return notionReadDiaryContent(apiKey, pageId);
    },

    /**
     * 获取用户笔记列表（从用户的笔记数据库）
     * 让角色能偶尔看到用户写的日常笔记，增加温馨感
     */
    getUserNotes: async (
        apiKey: string,
        notesDatabaseId: string,
        limit: number = 5
    ): Promise<{ success: boolean; entries: DiaryPreview[]; message: string }> => {
        try {
            const response = await fetch(`${NotionManager.WORKER_URL}/notion/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Notion-API-Key': apiKey
                },
                body: JSON.stringify({
                    database_id: notesDatabaseId,
                    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
                    page_size: limit
                })
            });

            const text = await response.text();

            if (!response.ok) {
                console.error('Query user notes failed:', response.status, text);
                return { success: false, entries: [], message: `查询失败: ${response.status}` };
            }

            const data = JSON.parse(text);

            if (!data.results || data.results.length === 0) {
                return { success: true, entries: [], message: '暂无笔记' };
            }

            const entries: DiaryPreview[] = data.results.map((page: any) => {
                const title = page.properties?.Name?.title?.[0]?.plain_text
                    || page.properties?.['名称']?.title?.[0]?.plain_text
                    || page.properties?.Title?.title?.[0]?.plain_text
                    || '无标题';
                // 尝试多种日期属性名
                const date = page.properties?.Date?.date?.start
                    || page.properties?.['日期']?.date?.start
                    || page.last_edited_time?.split('T')[0]
                    || '';
                return {
                    id: page.id,
                    title,
                    date,
                    url: page.url || ''
                };
            });

            return { success: true, entries, message: '获取成功' };
        } catch (e: any) {
            console.error('Get user notes failed:', e);
            return { success: false, entries: [], message: `获取失败: ${e.message}` };
        }
    },

    /**
     * 读取用户笔记页面的完整内容
     * 复用 readDiaryContent 的逻辑（都是通过 pageId 读 blocks）
     */
    readNoteContent: async (
        apiKey: string,
        pageId: string
    ): Promise<{ success: boolean; content: string; message: string }> => {
        // 和 readDiaryContent 一样，通过 blocks 端点读取
        return NotionManager.readDiaryContent(apiKey, pageId);
    },

    /**
     * 按关键词搜索用户笔记
     */
    searchUserNotes: async (
        apiKey: string,
        notesDatabaseId: string,
        keyword: string,
        limit: number = 5
    ): Promise<{ success: boolean; entries: DiaryPreview[]; message: string }> => {
        return notionSearchUserNotes(apiKey, notesDatabaseId, keyword, limit);
    },

    /**
     * 额外数据库只读查询：返回条目的标题 + 所有 property 的纯文本（用于 [[READ_TAG: 关键词]]）
     */
    queryExtraDatabaseRead: async (
        apiKey: string,
        databaseId: string,
        keyword: string,
        options?: { limit?: number; maxPropsPerEntry?: number; maxCharsPerValue?: number; maxTotalChars?: number }
    ): Promise<{
        success: boolean;
        entries: { id: string; title: string; url: string; propertiesText: string }[];
        message: string;
    }> => {
        const limit = Math.min(15, Math.max(1, options?.limit ?? 10));
        const maxProps = options?.maxPropsPerEntry ?? 24;
        const maxVal = options?.maxCharsPerValue ?? 220;
        const maxTotal = options?.maxTotalChars ?? 12000;

        try {
            const dbJson = await NotionManager.fetchDatabaseJson(apiKey, databaseId);
            const propsSchema = (dbJson?.properties || {}) as Record<string, { type?: string }>;
            const titleKey = findNotionTitlePropertyKey(propsSchema);

            const body: Record<string, unknown> = {
                database_id: databaseId,
                sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
                page_size: limit
            };
            const kw = (keyword || '').trim();
            if (kw && titleKey) {
                body.filter = {
                    property: titleKey,
                    title: { contains: kw }
                };
            }

            const response = await fetch(`${NotionManager.WORKER_URL}/notion/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Notion-API-Key': apiKey
                },
                body: JSON.stringify(body)
            });
            const text = await response.text();
            if (!response.ok) {
                let msg = `查询失败: ${response.status}`;
                try {
                    const err = JSON.parse(text) as { message?: string };
                    if (err.message) msg = err.message;
                } catch { /* ignore */ }
                return { success: false, entries: [], message: msg };
            }
            const data = JSON.parse(text) as { results?: any[] };
            const results = data.results || [];
            if (results.length === 0) {
                return {
                    success: true,
                    entries: [],
                    message: kw ? `没有找到包含「${kw}」的条目` : '数据库暂无条目'
                };
            }

            const entries: { id: string; title: string; url: string; propertiesText: string }[] = [];
            let totalChars = 0;
            for (const page of results) {
                const props = page.properties as Record<string, unknown> | undefined;
                const title = extractNotionPageTitle(props, titleKey);
                const skipKey = titleKey || undefined;
                let block = notionPropertiesToText(props, {
                    maxProps,
                    maxValChars: maxVal,
                    skipTitleKey: skipKey
                });
                if (block.length > maxTotal - totalChars - 200) {
                    block = block.slice(0, Math.max(0, maxTotal - totalChars - 200)) + '\n…(截断)';
                }
                const piece = `■ ${title}\n${block}`;
                totalChars += piece.length;
                entries.push({
                    id: page.id,
                    title,
                    url: page.url || '',
                    propertiesText: block
                });
                if (totalChars >= maxTotal) break;
            }

            return {
                success: true,
                entries,
                message: `找到 ${entries.length} 条`
            };
        } catch (e: any) {
            console.error('queryExtraDatabaseRead failed:', e);
            return { success: false, entries: [], message: `查询失败: ${e.message}` };
        }
    }
};

/** 从数据库 schema 找 title 类型列名 */
function findNotionTitlePropertyKey(schema: Record<string, { type?: string }>): string | null {
    for (const [k, v] of Object.entries(schema)) {
        if (v?.type === 'title') return k;
    }
    return null;
}

function extractNotionPageTitle(properties: Record<string, unknown> | undefined, titleKey: string | null): string {
    if (!properties) return '（无标题）';
    if (titleKey && properties[titleKey]) {
        const t = (properties[titleKey] as { type?: string; title?: any[] })?.title;
        const plain = richTextToPlain(t);
        if (plain) return plain;
    }
    for (const val of Object.values(properties)) {
        const p = val as { type?: string; title?: any[] };
        if (p?.type === 'title' && Array.isArray(p.title)) {
            const plain = richTextToPlain(p.title);
            if (plain) return plain;
        }
    }
    return '（无标题）';
}

function richTextToPlain(blocks: any[] | undefined): string {
    if (!Array.isArray(blocks)) return '';
    return blocks.map((b: any) => b.plain_text || b.text?.content || '').join('').trim();
}

function truncate(s: string, max: number): string {
    if (!s) return '';
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * 将 Notion page.properties 转为多行可读文本（通用，用于额外库只读）
 */
export function notionPropertiesToText(
    properties: Record<string, unknown> | undefined,
    opts?: { maxProps?: number; maxValChars?: number; skipTitleKey?: string }
): string {
    if (!properties || typeof properties !== 'object') return '';
    const maxProps = opts?.maxProps ?? 24;
    const maxVal = opts?.maxValChars ?? 220;
    const skip = opts?.skipTitleKey;
    const lines: string[] = [];
    let n = 0;
    for (const [key, raw] of Object.entries(properties)) {
        if (skip && key === skip) continue;
        if (n >= maxProps) break;
        const line = formatNotionPropertyLine(key, raw, maxVal);
        if (line) {
            lines.push(line);
            n++;
        }
    }
    return lines.join('\n');
}

function formatNotionPropertyLine(name: string, raw: unknown, maxVal: number): string {
    if (!raw || typeof raw !== 'object') return '';
    const prop = raw as Record<string, unknown>;
    const t = prop.type as string;
    switch (t) {
        case 'title': {
            const text = richTextToPlain(prop.title as any[]);
            return text ? `【${name}】${truncate(text, maxVal)}` : '';
        }
        case 'rich_text': {
            const text = richTextToPlain(prop.rich_text as any[]);
            return text ? `【${name}】${truncate(text, maxVal)}` : '';
        }
        case 'number': {
            const num = prop.number;
            return `【${name}】${num !== null && num !== undefined ? String(num) : ''}`;
        }
        case 'select': {
            const nm = (prop.select as { name?: string } | null)?.name;
            return nm ? `【${name}】${nm}` : '';
        }
        case 'status': {
            const nm = (prop.status as { name?: string } | null)?.name;
            return nm ? `【${name}】${nm}` : '';
        }
        case 'multi_select': {
            const arr = (prop.multi_select as { name?: string }[]) || [];
            const s = arr.map((x) => x.name).filter(Boolean).join('、');
            return s ? `【${name}】${truncate(s, maxVal)}` : '';
        }
        case 'date': {
            const d = prop.date as { start?: string; end?: string } | null;
            const s = d?.end ? `${d.start || ''} ~ ${d.end}` : d?.start || '';
            return s ? `【${name}】${s}` : '';
        }
        case 'checkbox':
            return `【${name}】${prop.checkbox ? '是' : '否'}`;
        case 'url':
            return prop.url ? `【${name}】${truncate(String(prop.url), maxVal)}` : '';
        case 'email':
            return prop.email ? `【${name}】${String(prop.email)}` : '';
        case 'phone_number':
            return prop.phone_number ? `【${name}】${String(prop.phone_number)}` : '';
        case 'formula': {
            const f = prop.formula as Record<string, unknown> | undefined;
            if (!f?.type) return '';
            const ft = f.type as string;
            if (ft === 'string') return `【${name}】${truncate(String(f.string || ''), maxVal)}`;
            if (ft === 'number') return `【${name}】${f.number ?? ''}`;
            if (ft === 'boolean') return `【${name}】${f.boolean ? '是' : '否'}`;
            if (ft === 'date') {
                const d = f.date as { start?: string } | undefined;
                return d?.start ? `【${name}】${d.start}` : '';
            }
            return '';
        }
        case 'relation': {
            const rel = prop.relation as { id?: string }[];
            return rel?.length ? `【${name}】${rel.length} 条关联` : '';
        }
        case 'rollup':
            return `【${name}】(rollup)`;
        case 'people': {
            const pe = prop.people as { name?: string }[];
            const s = pe?.map((p) => p.name || '用户').join('、') || '';
            return s ? `【${name}】${truncate(s, maxVal)}` : '';
        }
        case 'files':
            return `【${name}】${((prop.files as any[]) || []).length} 个文件`;
        default:
            return '';
    }
}

// 心情对应的 Emoji
function getMoodEmoji(mood: string): string {
    const moodMap: Record<string, string> = {
        'happy': '😊',
        'sad': '😢',
        'angry': '😠',
        'excited': '🎉',
        'tired': '😴',
        'calm': '😌',
        'anxious': '😰',
        'love': '❤️',
        'nostalgic': '🌅',
        'curious': '🔍',
        'grateful': '🙏',
        'confused': '😵‍💫',
        'proud': '✨',
        'lonely': '🌙',
        'hopeful': '🌈',
        'playful': '🎮',
        '开心': '😊',
        '难过': '😢',
        '生气': '😠',
        '兴奋': '🎉',
        '疲惫': '😴',
        '平静': '😌',
        '焦虑': '😰',
        '爱': '❤️',
        '怀念': '🌅',
        '好奇': '🔍',
        '感恩': '🙏',
        '迷茫': '😵‍💫',
        '骄傲': '✨',
        '孤独': '🌙',
        '期待': '🌈',
        '调皮': '🎮',
        '温暖': '☀️',
        '感动': '🥹',
        '害羞': '😳',
        '无聊': '😑',
        '紧张': '😬',
        '满足': '😌',
        '幸福': '🥰',
        '心动': '💓',
        '思念': '💭',
        '委屈': '🥺',
        '释然': '🍃'
    };
    return moodMap[mood.toLowerCase()] || '📝';
}

// 心情对应的颜色主题
function getMoodColorTheme(mood: string): { primary: string; secondary: string; accent: string } {
    const moodColors: Record<string, { primary: string; secondary: string; accent: string }> = {
        'happy': { primary: 'yellow_background', secondary: 'orange', accent: 'yellow' },
        'sad': { primary: 'blue_background', secondary: 'blue', accent: 'purple' },
        'angry': { primary: 'red_background', secondary: 'red', accent: 'orange' },
        'excited': { primary: 'pink_background', secondary: 'pink', accent: 'red' },
        'tired': { primary: 'gray_background', secondary: 'gray', accent: 'brown' },
        'calm': { primary: 'blue_background', secondary: 'blue', accent: 'green' },
        'anxious': { primary: 'purple_background', secondary: 'purple', accent: 'gray' },
        'love': { primary: 'pink_background', secondary: 'pink', accent: 'red' },
        '开心': { primary: 'yellow_background', secondary: 'orange', accent: 'yellow' },
        '难过': { primary: 'blue_background', secondary: 'blue', accent: 'purple' },
        '生气': { primary: 'red_background', secondary: 'red', accent: 'orange' },
        '兴奋': { primary: 'pink_background', secondary: 'orange', accent: 'red' },
        '疲惫': { primary: 'gray_background', secondary: 'gray', accent: 'brown' },
        '平静': { primary: 'blue_background', secondary: 'blue', accent: 'green' },
        '焦虑': { primary: 'purple_background', secondary: 'purple', accent: 'gray' },
        '爱': { primary: 'pink_background', secondary: 'pink', accent: 'red' },
        '温暖': { primary: 'yellow_background', secondary: 'orange', accent: 'brown' },
        '感动': { primary: 'pink_background', secondary: 'pink', accent: 'blue' },
        '害羞': { primary: 'pink_background', secondary: 'pink', accent: 'red' },
        '思念': { primary: 'purple_background', secondary: 'purple', accent: 'blue' },
        '幸福': { primary: 'yellow_background', secondary: 'pink', accent: 'orange' },
        '心动': { primary: 'pink_background', secondary: 'red', accent: 'pink' },
        '孤独': { primary: 'gray_background', secondary: 'blue', accent: 'purple' },
        '期待': { primary: 'green_background', secondary: 'green', accent: 'blue' },
    };
    return moodColors[mood.toLowerCase()] || { primary: 'blue_background', secondary: 'blue', accent: 'gray' };
}

// 装饰性 emoji 池 - 根据心情随机选取
function getDecorativeEmojis(mood: string): string[] {
    const moodDecorations: Record<string, string[]> = {
        'happy': ['🌟', '✨', '🎵', '🌻', '🍀', '🎈', '💫'],
        'sad': ['🌧️', '💧', '🍂', '🌊', '🕊️', '🌙'],
        'angry': ['🔥', '⚡', '💢', '🌪️', '💥'],
        'excited': ['🎉', '🎊', '🚀', '✨', '💥', '🎆', '⭐'],
        'love': ['💕', '💗', '🌹', '💝', '🦋', '🌸', '💖'],
        'calm': ['🍃', '☁️', '🌿', '🕊️', '💠', '🌊'],
        'tired': ['💤', '🌙', '☕', '🛏️', '😪'],
        '开心': ['🌟', '✨', '🎵', '🌻', '🍀', '🎈', '💫'],
        '难过': ['🌧️', '💧', '🍂', '🌊', '🕊️', '🌙'],
        '兴奋': ['🎉', '🎊', '🚀', '✨', '💥', '🎆', '⭐'],
        '爱': ['💕', '💗', '🌹', '💝', '🦋', '🌸', '💖'],
        '平静': ['🍃', '☁️', '🌿', '🕊️', '💠', '🌊'],
        '温暖': ['☀️', '🌼', '🍵', '🧡', '🌅'],
        '思念': ['💭', '🌙', '⭐', '🌌', '📮'],
        '幸福': ['🥰', '🌈', '🌸', '💖', '✨'],
    };
    return moodDecorations[mood.toLowerCase()] || ['📝', '✨', '💫', '🌟'];
}

function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================
// 解析内联格式 (Markdown → Notion Rich Text)
// ============================================
function parseInlineFormatting(text: string): any[] {
    const richTexts: any[] = [];
    // 正则匹配: **bold**, *italic*, ~~strikethrough~~, `code`
    const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`(.+?)`)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        // 前面的普通文本
        if (match.index > lastIndex) {
            richTexts.push({
                type: 'text',
                text: { content: text.slice(lastIndex, match.index) }
            });
        }

        if (match[2]) {
            // **bold**
            richTexts.push({
                type: 'text',
                text: { content: match[2] },
                annotations: { bold: true }
            });
        } else if (match[3]) {
            // *italic*
            richTexts.push({
                type: 'text',
                text: { content: match[3] },
                annotations: { italic: true }
            });
        } else if (match[4]) {
            // ~~strikethrough~~
            richTexts.push({
                type: 'text',
                text: { content: match[4] },
                annotations: { strikethrough: true }
            });
        } else if (match[5]) {
            // `code`
            richTexts.push({
                type: 'text',
                text: { content: match[5] },
                annotations: { code: true }
            });
        }

        lastIndex = match.index + match[0].length;
    }

    // 剩余文本
    if (lastIndex < text.length) {
        richTexts.push({
            type: 'text',
            text: { content: text.slice(lastIndex) }
        });
    }

    if (richTexts.length === 0) {
        richTexts.push({ type: 'text', text: { content: text } });
    }

    return richTexts;
}

// ============================================
// Markdown → Notion Blocks 转换器
// ============================================
function parseMarkdownToNotionBlocks(content: string, mood?: string, characterName?: string): any[] {
    const blocks: any[] = [];
    const lines = content.split('\n');
    const colors = getMoodColorTheme(mood || '平静');
    const decorEmojis = getDecorativeEmojis(mood || '平静');
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    // ── 顶部: 心情横幅 ──
    if (mood) {
        blocks.push({
            object: 'block', type: 'callout',
            callout: {
                rich_text: [{
                    type: 'text',
                    text: { content: `${pickRandom(decorEmojis)} 今日心情: ${mood} ${pickRandom(decorEmojis)}` },
                    annotations: { bold: true }
                }],
                icon: { emoji: getMoodEmoji(mood) },
                color: colors.primary
            }
        });
    }

    // ── 时间戳 ──
    blocks.push({
        object: 'block', type: 'quote',
        quote: {
            rich_text: [
                { type: 'text', text: { content: '🕐 ' }, annotations: { color: 'gray' } },
                { type: 'text', text: { content: `写于 ${timeStr}` }, annotations: { italic: true, color: 'gray' } }
            ],
            color: 'gray'
        }
    });

    blocks.push({ object: 'block', type: 'divider', divider: {} });

    // ── 正文解析 ──
    let sectionIndex = 0;
    const sectionColors = ['default', colors.secondary, 'default', colors.accent, 'default'];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) continue; // 跳过空行

        // --- 或 *** → 分割线
        if (/^[-*]{3,}$/.test(trimmed)) {
            blocks.push({ object: 'block', type: 'divider', divider: {} });
            sectionIndex++;
            continue;
        }

        // # Heading 1
        if (trimmed.startsWith('# ')) {
            const headingText = trimmed.slice(2);
            blocks.push({
                object: 'block', type: 'heading_2',
                heading_2: {
                    rich_text: [
                        { type: 'text', text: { content: `${pickRandom(decorEmojis)} ` } },
                        { type: 'text', text: { content: headingText }, annotations: { bold: true, color: colors.secondary } }
                    ],
                    color: colors.primary
                }
            });
            continue;
        }

        // ## Heading 2
        if (trimmed.startsWith('## ')) {
            const headingText = trimmed.slice(3);
            blocks.push({
                object: 'block', type: 'heading_3',
                heading_3: {
                    rich_text: parseInlineFormatting(headingText),
                    color: colors.accent
                }
            });
            continue;
        }

        // ### Heading 3 → 用 callout 代替，更好看
        if (trimmed.startsWith('### ')) {
            const headingText = trimmed.slice(4);
            const bgColors = [colors.primary, 'green_background', 'purple_background', 'orange_background', 'pink_background'];
            blocks.push({
                object: 'block', type: 'callout',
                callout: {
                    rich_text: parseInlineFormatting(headingText),
                    icon: { emoji: pickRandom(decorEmojis) },
                    color: bgColors[sectionIndex % bgColors.length]
                }
            });
            continue;
        }

        // > quote
        if (trimmed.startsWith('> ')) {
            const quoteText = trimmed.slice(2);
            blocks.push({
                object: 'block', type: 'quote',
                quote: {
                    rich_text: parseInlineFormatting(quoteText),
                    color: colors.secondary
                }
            });
            continue;
        }

        // - bullet / * bullet
        if (/^[-*]\s/.test(trimmed)) {
            const bulletText = trimmed.slice(2);
            blocks.push({
                object: 'block', type: 'bulleted_list_item',
                bulleted_list_item: {
                    rich_text: parseInlineFormatting(bulletText),
                    color: sectionColors[sectionIndex % sectionColors.length]
                }
            });
            continue;
        }

        // 1. numbered list
        if (/^\d+\.\s/.test(trimmed)) {
            const numText = trimmed.replace(/^\d+\.\s/, '');
            blocks.push({
                object: 'block', type: 'numbered_list_item',
                numbered_list_item: {
                    rich_text: parseInlineFormatting(numText)
                }
            });
            continue;
        }

        // [!callout] 特殊 callout 语法
        if (trimmed.startsWith('[!') && trimmed.includes(']')) {
            const calloutMatch = trimmed.match(/^\[!(.+?)\]\s*(.*)/);
            if (calloutMatch) {
                const calloutType = calloutMatch[1];
                const calloutText = calloutMatch[2] || '';
                const calloutColorMap: Record<string, string> = {
                    'warning': 'orange_background', 'danger': 'red_background',
                    'info': 'blue_background', 'success': 'green_background',
                    'note': 'purple_background', 'tip': 'green_background',
                    'heart': 'pink_background', 'star': 'yellow_background',
                    '重要': 'red_background', '想法': 'purple_background',
                    '秘密': 'pink_background', '提醒': 'orange_background',
                    '开心': 'yellow_background', '难过': 'blue_background',
                };
                const calloutEmojiMap: Record<string, string> = {
                    'warning': '⚠️', 'danger': '🚨', 'info': 'ℹ️',
                    'success': '✅', 'note': '📝', 'tip': '💡',
                    'heart': '💖', 'star': '⭐',
                    '重要': '❗', '想法': '💭', '秘密': '🤫',
                    '提醒': '📌', '开心': '😊', '难过': '😢',
                };
                blocks.push({
                    object: 'block', type: 'callout',
                    callout: {
                        rich_text: parseInlineFormatting(calloutText),
                        icon: { emoji: calloutEmojiMap[calloutType] || '📌' },
                        color: calloutColorMap[calloutType] || colors.primary
                    }
                });
                continue;
            }
        }

        // 普通段落 - 带随机微妙颜色
        const currentColor = sectionIndex % 3 === 0 ? 'default' : sectionColors[sectionIndex % sectionColors.length];
        blocks.push({
            object: 'block', type: 'paragraph',
            paragraph: {
                rich_text: parseInlineFormatting(trimmed),
                color: currentColor
            }
        });
    }

    // ── 底部装饰 ──
    blocks.push({ object: 'block', type: 'divider', divider: {} });

    // 签名
    if (characterName) {
        blocks.push({
            object: 'block', type: 'paragraph',
            paragraph: {
                rich_text: [
                    { type: 'text', text: { content: `${pickRandom(decorEmojis)} ` } },
                    { type: 'text', text: { content: `—— ${characterName}` }, annotations: { italic: true, color: 'gray' } },
                    { type: 'text', text: { content: ` ${pickRandom(decorEmojis)}` } }
                ]
            }
        });
    }

    return normalizeBlocksForNotion(blocks);
}

// Notion API 硬限制：单个 rich_text content ≤ 2000 字符；单次 POST children ≤ 100。
// 留点 buffer 防 emoji / 双字节边界拼接。
const NOTION_MAX_RICH_TEXT_LEN = 1900;
const NOTION_MAX_CHILDREN = 100;

function splitRichTextItem(item: any): any[] {
    const content = item?.text?.content;
    if (typeof content !== 'string' || content.length <= NOTION_MAX_RICH_TEXT_LEN) return [item];
    const chunks: any[] = [];
    for (let i = 0; i < content.length; i += NOTION_MAX_RICH_TEXT_LEN) {
        chunks.push({
            ...item,
            text: { ...item.text, content: content.slice(i, i + NOTION_MAX_RICH_TEXT_LEN) }
        });
    }
    return chunks;
}

function normalizeBlocksForNotion(blocks: any[]): any[] {
    // 1. 每个 block 的 rich_text 切 2000 字符
    const safe = blocks.map(block => {
        const payload = block[block.type];
        if (payload && Array.isArray(payload.rich_text)) {
            const split: any[] = [];
            for (const item of payload.rich_text) split.push(...splitRichTextItem(item));
            return { ...block, [block.type]: { ...payload, rich_text: split } };
        }
        return block;
    });

    // 2. 总 block 数限制 100；超出截断并附提示
    if (safe.length <= NOTION_MAX_CHILDREN) return safe;
    const truncated = safe.slice(0, NOTION_MAX_CHILDREN - 1);
    truncated.push({
        object: 'block',
        type: 'callout',
        callout: {
            rich_text: [{
                type: 'text',
                text: { content: `（日记内容过长，已截断 ${safe.length - (NOTION_MAX_CHILDREN - 1)} 个段落）` },
                annotations: { italic: true, color: 'gray' }
            }],
            icon: { emoji: '✂️' },
            color: 'gray_background'
        }
    });
    return truncated;
}

// ============================================
// Notion Blocks → 可读文本 转换器
// ============================================
// ============================================
// 飞书多维表格 集成模块 (中国区 Notion 替代)
// ============================================

export interface FeishuDiaryEntry {
    title: string;
    content: string;
    mood?: string;
    date?: string;
    characterName?: string;
}

/**
 * 飞书日记内容美化格式化器
 * 把 AI 写的原始文本变成带 emoji、分隔线、心情横幅的漂亮文本
 */
function formatFeishuDiaryContent(content: string, mood?: string, characterName?: string): string {
    const moodEmoji = getMoodEmoji(mood || '平静');
    const decorEmojis = getDecorativeEmojis(mood || '平静');
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

    const lines: string[] = [];

    // ── 心情横幅 ──
    if (mood) {
        lines.push(`${pick(decorEmojis)} ━━━━━━━━━━━━━━━━━━ ${pick(decorEmojis)}`);
        lines.push(`${moodEmoji}  今日心情: ${mood}  ${moodEmoji}`);
        lines.push(`${pick(decorEmojis)} ━━━━━━━━━━━━━━━━━━ ${pick(decorEmojis)}`);
        lines.push('');
    }

    // ── 时间戳 ──
    lines.push(`🕐 写于 ${timeStr}`);
    lines.push('');
    lines.push('─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─');
    lines.push('');

    // ── 正文处理 ──
    const contentLines = content.split('\n');
    for (const line of contentLines) {
        const trimmed = line.trim();
        if (!trimmed) {
            lines.push('');
            continue;
        }

        // # 大标题 → emoji 装饰
        if (trimmed.startsWith('# ')) {
            lines.push('');
            lines.push(`${pick(decorEmojis)} 【${trimmed.slice(2)}】${pick(decorEmojis)}`);
            lines.push('');
            continue;
        }

        // ## 中标题
        if (trimmed.startsWith('## ')) {
            lines.push('');
            lines.push(`✦ ${trimmed.slice(3)}`);
            lines.push('');
            continue;
        }

        // ### 小标题
        if (trimmed.startsWith('### ')) {
            lines.push(`  ▸ ${trimmed.slice(4)}`);
            continue;
        }

        // > 引用
        if (trimmed.startsWith('> ')) {
            lines.push(`  ❝ ${trimmed.slice(2)} ❞`);
            continue;
        }

        // --- 分割线
        if (/^[-*]{3,}$/.test(trimmed)) {
            lines.push('');
            lines.push(`  ${pick(decorEmojis)} · · · · · · · · · ${pick(decorEmojis)}`);
            lines.push('');
            continue;
        }

        // - 列表
        if (/^[-*]\s/.test(trimmed)) {
            lines.push(`  ${pick(decorEmojis)} ${trimmed.slice(2)}`);
            continue;
        }

        // 1. 有序列表
        if (/^\d+\.\s/.test(trimmed)) {
            lines.push(`  ${trimmed}`);
            continue;
        }

        // [!callout] 特殊标记
        const calloutMatch = trimmed.match(/^\[!(.+?)\]\s*(.*)/);
        if (calloutMatch) {
            const calloutType = calloutMatch[1];
            const calloutText = calloutMatch[2] || '';
            const calloutEmojis: Record<string, string> = {
                'heart': '💖', 'star': '⭐', 'warning': '⚠️', 'danger': '🚨',
                'info': 'ℹ️', 'success': '✅', 'note': '📝', 'tip': '💡',
                '重要': '❗', '想法': '💭', '秘密': '🤫', '提醒': '📌',
                '开心': '😊', '难过': '😢',
            };
            const emoji = calloutEmojis[calloutType] || '📌';
            lines.push(`  ┊ ${emoji} ${calloutText}`);
            continue;
        }

        // 普通段落
        lines.push(trimmed);
    }

    // ── 底部装饰 ──
    lines.push('');
    lines.push('─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─');

    if (characterName) {
        lines.push(`${pick(decorEmojis)} —— ${characterName} ${pick(decorEmojis)}`);
    }

    return lines.join('\n');
}

export const FeishuManager = {

    // Worker 代理地址（中心配置，用户可在设置里换成自部署实例）
    get WORKER_URL() { return getProxyWorkerUrl(); },

    /**
     * 获取飞书 tenant_access_token（通过 Worker 代理，带缓存）
     */
    getToken: async (appId: string, appSecret: string): Promise<{ success: boolean; token: string; message: string }> => {
        return feishuGetToken(appId, appSecret);
    },

    /**
     * 测试飞书连接（验证凭据 + 列出数据表验证权限）
     */
    testConnection: async (
        appId: string,
        appSecret: string,
        baseId: string,
        tableId: string
    ): Promise<{ success: boolean; message: string }> => {
        try {
            const tokenResult = await FeishuManager.getToken(appId, appSecret);
            if (!tokenResult.success) {
                return { success: false, message: tokenResult.message };
            }

            // 用列出所有表的端点（飞书没有获取单个表的GET端点）
            const response = await fetch(`${FeishuManager.WORKER_URL}/feishu/bitable/${baseId}/tables`, {
                method: 'GET',
                headers: { 'X-Feishu-Token': tokenResult.token }
            });

            const text = await response.text();
            if (!response.ok) {
                try {
                    const errJson = JSON.parse(text);
                    return { success: false, message: `连接失败: ${errJson.msg || errJson.error || response.status}` };
                } catch {
                    return { success: false, message: `连接失败: ${response.status}` };
                }
            }

            const data = JSON.parse(text);
            if (data.code !== 0) {
                return { success: false, message: `飞书错误: ${data.msg || '请检查多维表格权限'}` };
            }

            const tables = data.data?.items || [];
            const targetTable = tables.find((t: any) => t.table_id === tableId);
            if (targetTable) {
                return { success: true, message: `连接成功! 数据表: ${targetTable.name}` };
            } else {
                const tableNames = tables.map((t: any) => `${t.name}(${t.table_id})`).join(', ');
                return { success: false, message: `多维表格中未找到表 ${tableId}。可用表: ${tableNames || '无'}` };
            }
        } catch (e: any) {
            return { success: false, message: `网络错误: ${e.message}` };
        }
    },

    /**
     * 创建日记记录（写入飞书多维表格）
     * 数据表需要字段: 标题(文本), 内容(文本), 日期(日期), 心情(文本), 角色(文本)
     */
    createDiaryRecord: async (
        appId: string,
        appSecret: string,
        baseId: string,
        tableId: string,
        entry: FeishuDiaryEntry
    ): Promise<{ success: boolean; recordId?: string; message: string }> => {
        try {
            const tokenResult = await FeishuManager.getToken(appId, appSecret);
            if (!tokenResult.success) {
                return { success: false, message: tokenResult.message };
            }

            const now = new Date();
            const dateStr = entry.date || getLocalDateKey(now);
            const dateTimestamp = new Date(dateStr).getTime();
            const titlePrefix = entry.characterName ? `[${entry.characterName}] ` : '';

            // 美化日记内容
            const formattedContent = formatFeishuDiaryContent(
                entry.content || '',
                entry.mood,
                entry.characterName
            );

            const fields: Record<string, any> = {
                '标题': `${getMoodEmoji(entry.mood || '平静')} ${titlePrefix}${entry.title || dateStr + ' 的日记'}`,
                '内容': formattedContent,
                '日期': dateTimestamp,
                '心情': `${getMoodEmoji(entry.mood || '平静')} ${entry.mood || '平静'}`,
                '角色': entry.characterName || ''
            };

            const response = await fetch(`${FeishuManager.WORKER_URL}/feishu/bitable/${baseId}/${tableId}/records`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Feishu-Token': tokenResult.token
                },
                body: JSON.stringify({ fields })
            });

            const text = await response.text();
            if (!response.ok) {
                try {
                    const errJson = JSON.parse(text);
                    return { success: false, message: `写入失败: ${errJson.msg || errJson.error || response.status}` };
                } catch {
                    return { success: false, message: `写入失败: ${response.status}` };
                }
            }

            const data = JSON.parse(text);
            if (data.code !== 0) {
                return { success: false, message: `飞书错误: ${data.msg || '写入失败'}` };
            }

            return {
                success: true,
                recordId: data.data?.record?.record_id,
                message: '日记已写入飞书!'
            };
        } catch (e: any) {
            return { success: false, message: `网络错误: ${e.message}` };
        }
    },

    /**
     * 获取角色最近的日记
     */
    getRecentDiaries: async (
        appId: string,
        appSecret: string,
        baseId: string,
        tableId: string,
        characterName: string,
        limit: number = 5
    ): Promise<{ success: boolean; entries: FeishuDiaryPreview[]; message: string }> => {
        try {
            const tokenResult = await FeishuManager.getToken(appId, appSecret);
            if (!tokenResult.success) {
                return { success: false, entries: [], message: tokenResult.message };
            }

            const response = await fetch(`${FeishuManager.WORKER_URL}/feishu/bitable/${baseId}/${tableId}/records/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Feishu-Token': tokenResult.token
                },
                body: JSON.stringify({
                    filter: {
                        conjunction: 'and',
                        conditions: [{
                            field_name: '角色',
                            operator: 'is',
                            value: [characterName]
                        }]
                    },
                    sort: [{ field_name: '日期', desc: true }],
                    page_size: limit
                })
            });

            const text = await response.text();
            if (!response.ok) {
                return { success: false, entries: [], message: `查询失败: ${response.status}` };
            }

            const data = JSON.parse(text);
            if (data.code !== 0) {
                return { success: false, entries: [], message: `飞书错误: ${data.msg || '查询失败'}` };
            }

            const items = data.data?.items || [];
            if (items.length === 0) {
                return { success: true, entries: [], message: '暂无日记' };
            }

            const entries: FeishuDiaryPreview[] = items.map((item: any) => {
                const fields = item.fields || {};
                const rawTitle = (Array.isArray(fields['标题']) ? fields['标题']?.[0]?.text : fields['标题']) || '无标题';
                const cleanTitle = String(rawTitle).replace(/^\[.*?\]\s*/, '');
                const rawDate = fields['日期'];
                const rawDateText = typeof rawDate === 'string' ? rawDate.trim() : '';
                const parsedDate = rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDateText)
                    ? new Date(rawDate)
                    : null;
                const dateStr = rawDate
                    ? /^\d{4}-\d{2}-\d{2}$/.test(rawDateText)
                        ? rawDateText
                        : parsedDate && !Number.isNaN(parsedDate.getTime())
                            ? getLocalDateKey(parsedDate)
                            : ''
                    : '';

                return {
                    recordId: item.record_id,
                    title: cleanTitle,
                    date: dateStr,
                    content: (Array.isArray(fields['内容']) ? fields['内容']?.[0]?.text : fields['内容']) || ''
                };
            });

            return { success: true, entries, message: '获取成功' };
        } catch (e: any) {
            return { success: false, entries: [], message: `获取失败: ${e.message}` };
        }
    },

    /**
     * 按日期查找角色的日记
     */
    getDiaryByDate: async (
        appId: string,
        appSecret: string,
        baseId: string,
        tableId: string,
        characterName: string,
        date: string  // YYYY-MM-DD
    ): Promise<{ success: boolean; entries: FeishuDiaryPreview[]; message: string }> => {
        return feishuGetDiaryByDate(appId, appSecret, baseId, tableId, characterName, date);
    },

    /**
     * 读取指定记录的日记内容
     * 飞书多维表格直接存储在字段中，不需要像 Notion 一样读取 blocks
     */
    readDiaryContent: async (
        appId: string,
        appSecret: string,
        baseId: string,
        tableId: string,
        recordId: string
    ): Promise<{ success: boolean; content: string; message: string }> => {
        try {
            const tokenResult = await FeishuManager.getToken(appId, appSecret);
            if (!tokenResult.success) {
                return { success: false, content: '', message: tokenResult.message };
            }

            const response = await fetch(`${FeishuManager.WORKER_URL}/feishu/bitable/${baseId}/${tableId}/records/${recordId}`, {
                method: 'GET',
                headers: { 'X-Feishu-Token': tokenResult.token }
            });

            const text = await response.text();
            if (!response.ok) {
                return { success: false, content: '', message: `读取失败: ${response.status}` };
            }

            const data = JSON.parse(text);
            if (data.code !== 0) {
                return { success: false, content: '', message: `飞书错误: ${data.msg || '读取失败'}` };
            }

            const fields = data.data?.record?.fields || {};
            const content = (Array.isArray(fields['内容']) ? fields['内容']?.[0]?.text : fields['内容']) || '（空白日记）';

            return { success: true, content: String(content), message: '读取成功' };
        } catch (e: any) {
            return { success: false, content: '', message: `读取失败: ${e.message}` };
        }
    }
};

// ==================== 小红书 Types ====================

export interface XhsNote {
    noteId: string;
    title: string;
    desc: string;
    likes: number;
    collects?: number;
    commentCount?: number;
    shareCount?: number;
    author: string;
    authorId: string;
    xsecToken?: string;
    coverUrl?: string;
    type?: string;  // 'normal' | 'video'
    comments?: {
        author: string;
        content: string;
        likes: number;
        commentId?: string;
        userId?: string;
    }[];
}
// XhsManager removed — all XHS ops go through xhsMcpClient.ts
