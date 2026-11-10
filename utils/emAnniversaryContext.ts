// [EM-START: anniversary-aware]
/**
 * 纪念日进聊天：时光契约里开了「让 TA 记住」的纪念日，TA 每轮聊天都知道。
 *
 * 起因（阿萌 2026-11-09）：开了每年重复和让 TA 记住，问 TA 今天是什么日子，TA 不记得。
 * 原来旧版 chatPrompts 里有一段「今日纪念日」注入，2026-05-20 换成上游 chatPrompts（6c675e26）时
 * 一起被删掉了，之后「让 TA 记住」这个开关只存不读。这里补回来，并且比原来多做两件事：
 * - 不只当天：所有记着的日子都列给 TA（问「我们哪天在一起的」也答得上），快到的提前一周心里有数
 * - 说清日期按谁算：按阿萌这边的日历（跟约会 App 一样），角色那边可能差一天
 *
 * 拼提示词时不等 IndexedDB（跟朋友圈、烛下一样读内存副本）：打开 App 时读一次，
 * 时光契约里存 / 删一条（db.ts 两行 `em-anniversaries-changed`）就重读。
 */

import type { Anniversary } from '../types';
import { DB } from './db';

// ── 内存副本 ─────────────────────────────────────────────────────

export const ANNIVERSARIES_CHANGED_EVENT = 'em-anniversaries-changed';
let cache: Anniversary[] = [];
let loaded = false;

export const getCachedAnniversaries = (): Anniversary[] => cache;
/** 测试和备份恢复用：直接换掉副本 */
export const setAnniversaryCache = (list: Anniversary[]) => { cache = Array.isArray(list) ? list : []; loaded = true; };

export const refreshAnniversaryCache = async (): Promise<void> => {
    try { setAnniversaryCache(await DB.getAllAnniversaries()); } catch (e) { console.warn('[anniversary] 读纪念日失败', e); }
};

/** 浏览器里还没读过就先读一次（打开 App 后第一句话也能用上）；Node 测试里不碰库 */
export const ensureAnniversaryCache = async (): Promise<void> => {
    if (!loaded && typeof window !== 'undefined') await refreshAnniversaryCache();
};

if (typeof window !== 'undefined') {
    void refreshAnniversaryCache();
    window.addEventListener(ANNIVERSARIES_CHANGED_EVENT, () => { void refreshAnniversaryCache(); });
}

/** 提前几天就让 TA 知道快到了 */
export const ANNIVERSARY_HEADS_UP_DAYS = 7;
/** 最多列几个记着的日子，免得表很长时撑大提示词 */
const LIST_MAX = 12;

const pad = (n: number) => String(n).padStart(2, '0');
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAY_MS = 86_400_000;

const parseYMD = (s: string): { y: number; m: number; d: number } | null => {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((s || '').trim());
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return { y, m, d };
};

/** 某年里这个月日落在哪天；2 月 29 日在平年按 2 月 28 日过 */
const onYear = (year: number, m: number, d: number) => {
    const last = new Date(year, m, 0).getDate();
    return new Date(year, m - 1, Math.min(d, last));
};

export interface AnniversaryOccurrence {
    anni: Anniversary;
    /** 离今天几天：0 = 今天，-1 = 昨天，正数 = 还有几天 */
    days: number;
    /** 这一次是第几年（每年重复的才有；当年那一次是 0） */
    years?: number;
    /** 这一次的日期 */
    on: Date;
}

/**
 * 离今天最近的那一次（昨天也算，好让 TA 知道「昨天是」）。
 * 每年重复的看今年、去年、明年里离今天最近的；只一次的就是那一天。
 */
export const nearestOccurrence = (anni: Anniversary, now: Date): AnniversaryOccurrence | null => {
    const parts = parseYMD(anni.date);
    if (!parts) return null;
    const today = dayStart(now);
    const daysTo = (d: Date) => Math.round((d.getTime() - today.getTime()) / DAY_MS);
    if (anni.repeatYearly === false) {
        const on = onYear(parts.y, parts.m, parts.d);
        return { anni, days: daysTo(on), on };
    }
    let best: AnniversaryOccurrence | null = null;
    for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
        if (year < parts.y) continue;
        const on = onYear(year, parts.m, parts.d);
        const days = daysTo(on);
        // 今天和以后的优先；过去的只认昨天
        if (days < -1) continue;
        if (!best || days < best.days) best = { anni, days, years: year - parts.y, on };
    }
    return best;
};

const whenText = (days: number, on: Date) => {
    if (days === 0) return '今天';
    if (days === -1) return '昨天';
    if (days === 1) return '明天';
    if (days === 2) return '后天';
    return `${days} 天后（${on.getMonth() + 1}月${on.getDate()}日）`;
};

const yearsText = (years?: number) => {
    if (years === undefined) return '';
    if (years === 0) return '（就是今年的事）';
    return `（${years} 周年）`;
};

const dateText = (anni: Anniversary) => {
    const parts = parseYMD(anni.date);
    if (!parts) return anni.date;
    return anni.repeatYearly === false
        ? `${parts.y}年${parts.m}月${parts.d}日`
        : `每年${parts.m}月${parts.d}日（${parts.y}年起）`;
};

/** 这个角色记着的纪念日：属于 TA、没关「让 TA 记住」、日期认得出 */
export const awareAnniversaries = (all: Anniversary[], charId: string) =>
    (all || []).filter(a => a && a.charId === charId && a.charAware !== false && Boolean(parseYMD(a.date)));

export const buildAnniversaryInjection = (
    all: Anniversary[],
    charId: string,
    { userName = '对方', now = new Date() }: { userName?: string; now?: Date } = {},
): string => {
    const mine = awareAnniversaries(all, charId);
    if (!mine.length) return '';

    const near = mine
        .map(a => nearestOccurrence(a, now))
        .filter((o): o is AnniversaryOccurrence => Boolean(o) && o!.days >= -1 && o!.days <= ANNIVERSARY_HEADS_UP_DAYS)
        .sort((a, b) => a.days - b.days);

    let s = `\n### 你们的纪念日\n`;
    s += `这些日子你一直记得（${userName}在「时光契约」里记下的）。日期都按${userName}那边的日历算，不按你那边的时区：\n`;
    for (const a of mine.slice(0, LIST_MAX)) s += `- 「${a.title}」：${dateText(a)}\n`;

    if (near.length) {
        s += `眼下：\n`;
        for (const o of near) s += `- ${whenText(o.days, o.on)}是「${o.anni.title}」${yearsText(o.years)}\n`;
        if (near.some(o => o.days === 0)) {
            s += `今天就是这一天，你记得。在合适的时候自然地提起、或者用你的方式过这一天就好，不用刻意宣布；${userName}问起时，你当然答得上来。\n`;
        } else if (near.some(o => o.days > 0)) {
            s += `快到了，你心里有数；不必每句都提。\n`;
        }
    }
    return s;
};
// [EM-END: anniversary-aware]
