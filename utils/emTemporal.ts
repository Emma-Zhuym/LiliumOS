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
