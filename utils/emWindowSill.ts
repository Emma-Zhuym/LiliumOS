// [EM-START: window-sill]
/**
 * 窗台（原机房，apps/MachineRoomApp.tsx）的纯逻辑：每个人用哪套颜色、一跳用了什么软件、
 * 七日心事怎么排怎么说、哪张当大牌、今天发没发过牌。不碰网络、不碰 React，单测钉死。
 *
 * 颜色不跟角色绑定（阿萌 2026-11-10：现在不方便绑定角色）：三套颜色她自己在详情页右上角选，
 * 存本机 localStorage，不进备份、不改角色设定。没选过的按顺序轮着给。
 */

import type { AgentModelRun } from './emAgentBackend';
import { runKind, runSummary } from './emMachineRoom';
import { SILL_THEME_ORDER, type SillThemeId } from './sillTokens';

// ── 颜色 ───────────────────────────────────────────────────────
const THEME_KEY = 'em_sill_theme_v1';

const readThemes = (): Record<string, SillThemeId> => {
    try {
        const parsed = JSON.parse(localStorage.getItem(THEME_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

export const sillThemeFor = (charId: string, index: number, saved: Record<string, string> = readThemes()): SillThemeId => {
    const picked = saved[charId];
    if (picked && (SILL_THEME_ORDER as string[]).includes(picked)) return picked as SillThemeId;
    return SILL_THEME_ORDER[((index % SILL_THEME_ORDER.length) + SILL_THEME_ORDER.length) % SILL_THEME_ORDER.length];
};

export const saveSillTheme = (charId: string, theme: SillThemeId) => {
    try {
        localStorage.setItem(THEME_KEY, JSON.stringify({ ...readThemes(), [charId]: theme }));
    } catch {
        // 存不下就算了：下次打开还是按顺序给的那套
    }
};

// ── 一跳用了什么软件（「你不在时」时间下面的小胶囊）─────────────────
const LIFE_APP: Record<string, string> = {
    chat: '聊天',
    social: '出门',
    delivery: '外卖',
    order: '网购',
    moment: '朋友圈',
    xhs: '小红书',
};
const WORK_APP: Record<string, string> = { group: '工作群', dm: '工作', email: '邮件' };

/** 先看过日子那件事，再看工作往来，最后看是不是给她发了消息。什么都没做就没有胶囊。 */
export const runApp = (run: Pick<AgentModelRun, 'outcome' | 'episode' | 'ok'>): string | null => {
    if (!run.ok || run.outcome === 'error' || run.outcome === 'skipped') return null;
    const episode = run.episode as Record<string, any> | null | undefined;
    const life = episode?.life as Record<string, any> | undefined;
    if (life?.kind === 'gift') return life.via === 'food' ? '外卖' : '网购'; // 礼物只说渠道，惊喜不点破
    if (life?.kind && LIFE_APP[life.kind]) return LIFE_APP[life.kind];
    if (typeof episode?.channel === 'string') return WORK_APP[episode.channel] ?? '工作';
    if (run.outcome === 'message') return '聊天';
    return null;
};

/** 一跳那一行：出错的只说没醒过来，原因去设置 → Mac mini 看。 */
export const beatText = (run: AgentModelRun): { text: string; faint: boolean } => {
    const kind = runKind(run);
    if (kind === 'error') return { text: '这一跳没醒过来', faint: true };
    if (kind === 'skipped') return { text: runSummary(run), faint: true };
    return { text: runSummary(run), faint: false };
};

// ── 七日心事 ───────────────────────────────────────────────────
/** 九种心思，两个字，三组：朝着你的 / 朝外的 / TA 自己的（阿萌 2026-11-10 定名）。 */
export const SILL_DRIVE_GROUPS: { drive: string; label: string }[][] = [
    [{ drive: 'miss', label: '想你' }, { drive: 'concern', label: '担心' }, { drive: 'desire', label: '想要' }, { drive: 'sulk', label: '芥蒂' }],
    [{ drive: 'curious', label: '好奇' }, { drive: 'social', label: '社交' }, { drive: 'reminisce', label: '怀旧' }],
    [{ drive: 'tired', label: '疲惫' }, { drive: 'stress', label: '压力' }],
];
const DRIVE_LABEL = Object.fromEntries(SILL_DRIVE_GROUPS.flat().map(item => [item.drive, item.label]));

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** 「2026-11-04」→「三」；最后一天写「今」。 */
export const weekdayLabels = (days: string[]): string[] => days.map((day, index) => {
    if (index === days.length - 1) return '今';
    const [y, m, d] = day.split('-').map(Number);
    const at = new Date(y, (m || 1) - 1, d || 1);
    return Number.isNaN(at.getTime()) ? '' : WEEKDAY[at.getDay()];
});

/**
 * 「最重的一笔」那一句。挑七天里最浓的那种（一样浓取最近的），说它是怎么来的：
 * 一天比一天浓 / 今天最浓 / 周几那天最浓、现在缓下来了。都在平常水平就是 null。
 */
export const strongestLine = (rows: { drive: string; levels: number[] }[], days: string[]): { label: string; text: string } | null => {
    let best: { drive: string; level: number; day: number } | null = null;
    for (const row of rows) {
        if (!DRIVE_LABEL[row.drive]) continue;
        row.levels.forEach((level, day) => {
            if (level <= 0) return;
            if (!best || level > best.level || (level === best.level && day > best.day)) best = { drive: row.drive, level, day };
        });
    }
    if (!best) return null;
    const { drive, day } = best as { drive: string; level: number; day: number };
    const levels = rows.find(row => row.drive === drive)!.levels;
    const last = levels.length - 1;
    const label = DRIVE_LABEL[drive];
    if (day === last) {
        const rising = last >= 2 && levels[last - 2] > 0 && levels[last - 2] <= levels[last - 1] && levels[last - 1] < levels[last];
        return { label, text: rising ? '这几天一天比一天浓，今天最浓' : '今天最浓' };
    }
    const weekday = weekdayLabels(days)[day];
    const when = last - day === 1 ? '昨天' : `周${weekday}`;
    return { label, text: levels[last] > 0 ? `${when}最浓，现在还在` : `${when}最浓，现在缓下来了` };
};

// ── 哪张当大牌 ─────────────────────────────────────────────────
const TOWARD = new Set(['miss', 'concern', 'desire', 'sulk']);
const LEVEL_WEIGHT = { mid: 1, high: 2 } as const;

/**
 * 朝着她的那组心思里最强的那个人当大牌；都平平的时候返回 null（三张一样大，按最近动静排）。
 * 一样强的取最近有动静的。
 */
export const pickBigCard = (people: { charId: string; drives: { drive: string; level: 'mid' | 'high' }[]; lastAt?: string | null }[]): string | null => {
    let best: { charId: string; weight: number; at: number } | null = null;
    for (const person of people) {
        const weight = Math.max(0, ...person.drives.filter(d => TOWARD.has(d.drive)).map(d => LEVEL_WEIGHT[d.level] ?? 0));
        if (weight <= 0) continue;
        const at = Date.parse(person.lastAt ?? '') || 0;
        if (!best || weight > best.weight || (weight === best.weight && at > best.at)) best = { charId: person.charId, weight, at };
    }
    return best?.charId ?? null;
};

// ── 发牌：只在当天第一次打开时播 ───────────────────────────────
const DEAL_KEY = 'em_sill_dealt_day_v1';

const localDay = (now: Date) => `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

/** 今天还没发过牌就返回 true，并记下今天发过了。 */
export const takeDealToday = (now = new Date()): boolean => {
    try {
        const today = localDay(now);
        if (localStorage.getItem(DEAL_KEY) === today) return false;
        localStorage.setItem(DEAL_KEY, today);
        return true;
    } catch {
        return false;
    }
};
// [EM-END: window-sill]
