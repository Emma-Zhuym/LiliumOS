// [EM-START: calendar-temporal]
/**
 * 现实时间（Apple 日历 / 提醒）在手机这一侧的摆放逻辑。
 *
 * 后端（server/agent-backend/temporal.mjs）每天同步一次，前端只读它的缓存：
 * 日历 App 不直接连桥接——列一次日历要二十多秒，那是后台任务该做的事，不是点开 App 该等的。
 *
 * 这个文件只做纯计算（排月历格子、按天归拢、算下一次同步），网络在 `emAgentBackend.ts`，
 * 界面在 `apps/CalendarApp.tsx` 和 `components/settings/AgentTemporalPanel.tsx`。
 *
 * 缓存存本机 localStorage：mini 不在线（每天 4–7 点休眠）时，日历 App 仍该显示上次看到的样子。
 */

import { AgentBackend, isAgentPaired } from './emAgentBackend';
import type { TemporalItem, TemporalLevel, TemporalSnapshot, TemporalVisibility } from './emAgentBackend';

export type { TemporalItem, TemporalLevel, TemporalSnapshot, TemporalVisibility };

const CACHE_KEY = 'em_temporal_cache_v1';

export const LEVEL_LABELS: Record<TemporalLevel, string> = {
    hidden: '不给看',
    busy: '只知道我在忙',
    title: '能看到标题',
};

/** 设置页里的档位顺序（从最保守到最开放）。 */
export const LEVELS: TemporalLevel[] = ['hidden', 'busy', 'title'];

export const emptyVisibility = (): TemporalVisibility => ({ calendars: {}, lists: {} });

export const levelOf = (
    visibility: TemporalVisibility | undefined,
    kind: 'event' | 'reminder',
    source: string,
): TemporalLevel => {
    const table = kind === 'event' ? visibility?.calendars : visibility?.lists;
    const level = table?.[source];
    return level && LEVELS.includes(level) ? level : 'hidden';
};

/** 有没有至少开了一个来源。一个都没开时后端不会去读，界面要说清楚。 */
export const hasOpenSource = (visibility: TemporalVisibility | undefined): boolean =>
    [...Object.values(visibility?.calendars ?? {}), ...Object.values(visibility?.lists ?? {})]
        .some(level => level !== 'hidden');

// ── 本机缓存 ─────────────────────────────────────────────────────
/** 最后一次从 mini 读到的样子，外加读到的时间。mini 睡着时界面就显示这份。 */
export interface TemporalCache extends TemporalSnapshot { cachedAt: number }

export const loadTemporalCache = (): TemporalCache | null => {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<TemporalCache>;
        if (!Array.isArray(parsed.items)) return null;
        return {
            items: parsed.items,
            visibility: parsed.visibility ?? emptyVisibility(),
            sync: parsed.sync ?? {},
            cachedAt: parsed.cachedAt ?? 0,
        };
    } catch {
        return null;
    }
};

export const saveTemporalCache = (snapshot: TemporalSnapshot, now = Date.now()): TemporalCache => {
    const cache: TemporalCache = { ...snapshot, cachedAt: now };
    if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* 存不下就下次再说 */ }
    }
    return cache;
};

/** 刚建的那条立刻进缓存，不用等下一次同步；已有的同一条按 sourceId 换掉。 */
export const cacheItem = (item: TemporalItem, now = Date.now()): TemporalCache | null => {
    const cache = loadTemporalCache();
    if (!cache) return null;
    return saveTemporalCache({
        ...cache,
        items: [...cache.items.filter(existing => existing.sourceId !== item.sourceId), item],
    }, now);
};

/** 勾掉之后从缓存里拿走（缓存里本来就只存没完成的）。 */
export const uncacheItem = (sourceId: string, now = Date.now()): TemporalCache | null => {
    const cache = loadTemporalCache();
    if (!cache) return null;
    return saveTemporalCache({ ...cache, items: cache.items.filter(item => item.sourceId !== sourceId) }, now);
};

/** 能往里写的提醒清单：设置里开过的那些（不给看的既列不出来，写进去角色也看不到）。 */
export const writableLists = (visibility: TemporalVisibility | undefined): string[] =>
    Object.entries(visibility?.lists ?? {}).filter(([, level]) => level !== 'hidden').map(([name]) => name);

/** 还没完成的提醒：按截止时间排（逾期的自然排最前），没写时间的垫底。 */
export const openReminders = (items: TemporalItem[]): TemporalItem[] =>
    items.filter(item => item.kind === 'reminder' && !item.completed)
        .sort((a, b) => {
            const at = a.dueAt ? Date.parse(a.dueAt) : Infinity;
            const bt = b.dueAt ? Date.parse(b.dueAt) : Infinity;
            return at - bt || a.title.localeCompare(b.title);
        });

export const isOverdue = (item: TemporalItem, now = Date.now()): boolean =>
    !!item.dueAt && Date.parse(item.dueAt) < now;

/** 「逾期 / 今天 18:00 / 明天 / 周六」这一句。 */
export const dueText = (item: TemporalItem, now = new Date()): string => {
    if (!item.dueAt) return '';
    const due = new Date(item.dueAt);
    if (Number.isNaN(due.getTime())) return '';
    const time = `${due.getHours()}:${String(due.getMinutes()).padStart(2, '0')}`;
    const days = Math.round((new Date(dayKey(due) + 'T00:00:00').getTime() - new Date(dayKey(now) + 'T00:00:00').getTime()) / 86400_000);
    if (due.getTime() < now.getTime()) return `逾期 · ${due.getMonth() + 1}月${due.getDate()}日`;
    if (days === 0) return `今天 ${time}`;
    if (days === 1) return `明天 ${time}`;
    if (days < 7) return `周${'日一二三四五六'[due.getDay()]} ${time}`;
    return `${due.getMonth() + 1}月${due.getDate()}日 ${time}`;
};

// ── 日期 ────────────────────────────────────────────────────────
/** 本地时区的 YYYY-MM-DD。日历格子按阿萌自己的时区分天，不按 UTC。 */
export const dayKey = (value: Date | string | number): string => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** 这条安排属于哪一天：事件看开始时间，提醒看截止时间。 */
export const itemDayKey = (item: TemporalItem): string => {
    const at = item.startAt ?? item.dueAt;
    return at ? dayKey(at) : '';
};

export const itemTimeText = (item: TemporalItem): string => {
    if (item.allDay) return '全天';
    const at = item.startAt ?? item.dueAt;
    if (!at) return '';
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** 排序：全天的排最前，其余按时间；没有时间的垫底。 */
export const sortItems = (items: TemporalItem[]): TemporalItem[] =>
    [...items].sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        const at = Date.parse(a.startAt ?? a.dueAt ?? '');
        const bt = Date.parse(b.startAt ?? b.dueAt ?? '');
        if (!Number.isFinite(at)) return 1;
        if (!Number.isFinite(bt)) return -1;
        return at - bt;
    });

/** 按天归拢，每天内部已排好序。跨天的事件只算在开始那天（第一版够用）。 */
export const groupByDay = (items: TemporalItem[]): Map<string, TemporalItem[]> => {
    const map = new Map<string, TemporalItem[]>();
    for (const item of items) {
        const key = itemDayKey(item);
        if (!key) continue;
        const bucket = map.get(key);
        if (bucket) bucket.push(item);
        else map.set(key, [item]);
    }
    for (const [key, bucket] of map) map.set(key, sortItems(bucket));
    return map;
};

/**
 * 月历格子：6 行 × 7 列，周日起头，前后补上邻月的日子。
 *
 * 固定 42 格是故意的：行数随月份变的话，切月时整页会跳一下。
 */
export interface MonthCell { key: string; date: Date; inMonth: boolean }

export const monthGrid = (year: number, month: number): MonthCell[] => {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
        return { key: dayKey(date), date, inMonth: date.getMonth() === month };
    });
};

export const shiftMonth = (year: number, month: number, delta: number): { year: number; month: number } => {
    const date = new Date(year, month + delta, 1);
    return { year: date.getFullYear(), month: date.getMonth() };
};

/** 隔多久才值得再问一次后端。mini 每天才同步一次，一小时一问已经很勤快了。 */
export const CACHE_REFRESH_MS = 60 * 60 * 1000;

/**
 * 顺手把缓存刷新一下（打开 App、回到前台时调）。全程静默：
 * 没配对、后端休眠、网络不通都直接返回上一次的缓存——后台服务不在线是常态，不是故障。
 */
export const refreshTemporalCache = async (options: { force?: boolean; now?: number } = {}): Promise<TemporalCache | null> => {
    const now = options.now ?? Date.now();
    const cached = loadTemporalCache();
    if (!isAgentPaired()) return cached;
    if (!options.force && cached && now - cached.cachedAt < CACHE_REFRESH_MS) return cached;
    try {
        return saveTemporalCache(await AgentBackend.temporal(), now);
    } catch {
        return cached;
    }
};

// ── 给角色看的那一份 ─────────────────────────────────────────────
/**
 * 按可见性裁一遍：`hidden` 整条不给，`busy` 只剩「有安排」，地点一律抹掉。
 *
 * 后端 `server/agent-backend/temporal.mjs` 里有一份同样的（心跳用那份）。这里再写一遍，
 * 是因为 `GET /temporal` 回的是**没裁过**的原件——日历 App 是阿萌自己在看，当然要看全。
 * 改这里记得同步改那边，两边的档位语义必须一样。
 */
export const veilForCharacter = (items: TemporalItem[], visibility: TemporalVisibility | undefined): TemporalItem[] =>
    items.flatMap(item => {
        const level = levelOf(visibility, item.kind, item.source);
        if (level === 'hidden') return [];
        if (level === 'title') return [{ ...item, location: null }];
        return [{
            ...item,
            title: item.kind === 'event' ? '有安排' : '有件事要做',
            location: null,
        }];
    });

/**
 * 写进聊天提示词的那一段。
 *
 * 只写角色真用得上的几件事：ta 现在忙不忙、接下来有什么、每周固定的那些（课表）、
 * 快到期的提醒。窗口里其余条目不写——角色不需要知道她下周二几点看牙。
 *
 * 时间一律按**阿萌自己**的时区读（设备时区）：这是她的日历，不是角色的作息，
 * 不走 `docs/character-timezone.md` 里那套角色时区换算。
 */
export const formatTemporalForPrompt = (
    items: TemporalItem[],
    now: Date,
    userName = '对方',
    timeZone?: string,
): string => {
    if (items.length === 0) return '';
    const nowMs = now.getTime();
    const dayEnd = new Date(nowMs + 36 * 3600_000).toISOString();
    const clock = (at: string) => new Intl.DateTimeFormat('zh-CN', {
        timeZone, hour12: true, hour: 'numeric', minute: '2-digit',
    }).format(new Date(at));
    const dayName = (at: string) => new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'short' }).format(new Date(at));

    const events = items.filter(item => item.kind === 'event' && item.startAt);
    const nowBusy = events.find(item =>
        Date.parse(item.startAt!) <= nowMs && Date.parse(item.endAt ?? item.startAt!) > nowMs);
    const soon = events
        .filter(item => Date.parse(item.startAt!) > nowMs && item.startAt! <= dayEnd)
        .slice(0, 4)
        .map(item => `${dayName(item.startAt!)} ${clock(item.startAt!)} ${item.title}`);
    // 每周固定的（课表）：同一个标题重复出现的，按星期几归成一句
    const weekly = new Map<string, string[]>();
    for (const item of events.filter(item => item.repeats)) {
        const slot = `${dayName(item.startAt!)}${clock(item.startAt!)}`;
        weekly.set(item.title, [...new Set([...(weekly.get(item.title) ?? []), slot])]);
    }

    const lines: string[] = [];
    if (nowBusy) lines.push(`- 此刻：${nowBusy.title}${nowBusy.endAt ? `，到 ${clock(nowBusy.endAt)}` : ''}`);
    if (soon.length > 0) lines.push(`- 接下来：${soon.join('；')}`);
    if (weekly.size > 0) {
        lines.push(`- 每周固定：${[...weekly].slice(0, 6).map(([title, slots]) => `${slots.join('、')} ${title}`).join('；')}`);
    }
    const due = items
        .filter(item => item.kind === 'reminder' && !item.completed && item.dueAt && Date.parse(item.dueAt) > nowMs)
        .slice(0, 3)
        .map(item => `${dayName(item.dueAt!)}前 ${item.title}`);
    if (due.length > 0) lines.push(`- 记着的事：${due.join('；')}`);
    if (lines.length === 0) return '';

    return `🗓 ${userName}的安排（你知道这些，但这是 ta 的日历，不是 ta 特地告诉你的）：\n${lines.join('\n')}\n`
        + '别一见面就报菜单式地复述这些；该体谅的时候体谅（ta 在忙就别追着问），'
        + '该记得的时候记得（快到期的事可以问一句）。';
};

/**
 * 每轮聊天调这个：从本机缓存里取一段提示词。**不发网络请求**——
 * mini 每天才同步一次，为拼一句提示词去等一个可能在休眠的后端不值当。
 * 缓存由 `refreshTemporalCache()` 在打开 App 时顺手更新。
 */
export const buildTemporalInjection = (userName: string, now = new Date()): string => {
    const cache = loadTemporalCache();
    if (!cache || cache.items.length === 0) return '';
    return formatTemporalForPrompt(veilForCharacter(cache.items, cache.visibility), now, userName);
};

// ── 同步状态 ────────────────────────────────────────────────────
/** 「上次同步：刚刚 / 3 小时前 / 昨天」这一句。没同步过就说还没同步过。 */
export const syncText = (sync: { lastAt?: string; lastError?: string | null } | undefined, now = Date.now()): string => {
    if (!sync?.lastAt) return '还没同步过';
    const at = Date.parse(sync.lastAt);
    if (!Number.isFinite(at)) return '还没同步过';
    const minutes = Math.floor((now - at) / 60_000);
    if (minutes < 2) return '刚刚同步过';
    if (minutes < 60) return `${minutes} 分钟前同步`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前同步`;
    return `${Math.floor(hours / 24)} 天前同步`;
};
// [EM-END: calendar-temporal]
