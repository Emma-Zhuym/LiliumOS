// [EM-START: char-promises]
/**
 * TA 答应阿萌的事。起因（阿萌 2026-10-30，烛下）：「你什么都不付出，只是动动嘴皮子」——
 * TA 说了「周四陪你去」，没有地方记，到时候就忘了。所以说出口就要写下来：
 * - 聊天和烛下里 TA 写 `[[PROMISE: 什么时候 | 做什么]]`，存在这台手机上（不靠 mini）
 * - 每轮提示词提醒 TA：哪些到期了、哪些过期了；做完写 `[[PROMISE_DONE: 编号]]`，做不到写 `[[PROMISE_DROP: 编号 | 为什么]]`
 * - 阿萌在「约会」App 和日历里看得到，也能自己标「做到了」「没做到」
 * - 心跳从快照读到今天到期的，当天还没说过话就主动找她
 *
 * 跟 emDatePlans（一份完整的约会安排，当天才揭晓）、emAgentPlans（TA 跟亲友的约定，存在 mini）都不是一回事。
 * 日期是阿萌这边的日期。
 */
import { dateKeyOf, daysBetween, parseDateWord, parseTimeWord } from './emDatePlans';
import { isSafeKeptLine } from './deepTalk';

const STORE_KEY = 'em_char_promises_v1';
const WHAT_MAX = 80;
const REASON_MAX = 80;
/** 一条消息最多认几件：烛下里 TA 一口气答应一串时，只记最要紧的几件，够了。 */
const MAX_PER_MESSAGE = 5;
/** 提示词里最多列几件，免得越攒越长。 */
const MAX_IN_PROMPT = 10;
/** 她标了「没做到」之后，这么久之内每轮告诉 TA。 */
const MISSED_NOTICE_MS = 3 * 86_400_000;

export type PromiseStatus = 'open' | 'done' | 'dropped';

export interface CharPromise {
    id: string;
    charId: string;
    /** 答应的事，TA 自己的话 */
    what: string;
    /** 阿萌这边的日期 YYYY-MM-DD；没说哪天或认不出就空 */
    date?: string;
    time?: string;
    /** 认不出日期时留下 TA 的原话（「等你忙完」） */
    whenText?: string;
    status: PromiseStatus;
    /** 没做到的原因（TA 写的，或阿萌标的时候为空） */
    reason?: string;
    /** 谁标的结果 */
    settledBy?: 'char' | 'user';
    /** 在烛下说的、带现实处境的：只留在烛下，不进平时的提示词和心跳 */
    candleOnly?: boolean;
    createdAt: number;
    updatedAt: number;
}

const isPromise = (p: any): p is CharPromise => Boolean(p) && typeof p.id === 'string' && typeof p.charId === 'string'
    && typeof p.what === 'string' && ['open', 'done', 'dropped'].includes(p.status);

export const loadPromises = (): CharPromise[] => {
    if (typeof localStorage === 'undefined') return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(isPromise) : [];
    } catch {
        return [];
    }
};

const listeners = new Set<() => void>();
export const subscribePromises = (fn: () => void) => {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
};

const savePromises = (list: CharPromise[]) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch {
        // 只有文字，正常不会满
    }
    listeners.forEach(fn => fn());
};

export const exportPromises = (): CharPromise[] => loadPromises();
/** 恢复：按 id 合并，备份里的覆盖本机同 id 的，本机独有的留着。 */
export const importPromises = (raw: unknown) => {
    if (!Array.isArray(raw)) return;
    const byId = new Map(loadPromises().map(p => [p.id, p]));
    for (const p of raw.filter(isPromise)) byId.set(p.id, p);
    savePromises([...byId.values()]);
};

/** 编号：给 TA 写 DONE / DROP 用，id 的末四位 */
export const promiseCode = (p: Pick<CharPromise, 'id'>) => p.id.slice(-4);

export const addPromise = (input: { charId: string; what: string; date?: string; time?: string; whenText?: string; candleOnly?: boolean }, now = Date.now()): CharPromise => {
    const list = loadPromises();
    const what = input.what.trim().slice(0, WHAT_MAX);
    // 同一件事再写一遍（模型爱重复）：更新时间，不新加一条
    const existing = list.find(p => p.charId === input.charId && p.status === 'open' && p.what === what);
    const promise: CharPromise = {
        id: existing?.id ?? `pr-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        charId: input.charId,
        what,
        ...(input.date ? { date: input.date } : {}),
        ...(input.time ? { time: input.time } : {}),
        ...(input.whenText ? { whenText: input.whenText } : {}),
        ...(input.candleOnly ? { candleOnly: true } : {}),
        status: 'open',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    savePromises([...list.filter(p => p.id !== promise.id), promise]);
    return promise;
};

export const settlePromise = (id: string, status: 'done' | 'dropped', by: 'char' | 'user', reason?: string, now = Date.now()): CharPromise | null => {
    const list = loadPromises();
    const target = list.find(p => p.id === id);
    if (!target) return null;
    const next: CharPromise = {
        ...target,
        status,
        settledBy: by,
        updatedAt: now,
        ...(reason ? { reason: reason.slice(0, REASON_MAX) } : {}),
    };
    savePromises(list.map(p => (p.id === id ? next : p)));
    return next;
};

/**
 * 重写 / 重新生成：被换掉的回复里答应的事不算数。标签在消息落库前就记了，所以按
 * 「被换掉的回复之前那条消息」的时间算，这之后新记的、还没结的都撤掉。
 */
export const retractPromisesSince = (charId: string, since: number): void => {
    const list = loadPromises();
    const kept = list.filter(p => !(p.charId === charId && p.status === 'open' && p.createdAt > since));
    if (kept.length !== list.length) savePromises(kept);
};

/** 还没结的，有日期的按日期在前，没日期的在后 */
export const openPromises = (list: CharPromise[], charId?: string): CharPromise[] => list
    .filter(p => p.status === 'open' && (!charId || p.charId === charId))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.createdAt - b.createdAt);

export type PromiseDue = 'overdue' | 'today' | 'later' | 'undated';
export const promiseDue = (p: Pick<CharPromise, 'date'>, today: string): PromiseDue => {
    if (!p.date) return 'undated';
    if (p.date < today) return 'overdue';
    return p.date === today ? 'today' : 'later';
};

// ── 聊天里的标签 ───────────────────────────────────────────────

const PROMISE_TAG_RE = /\[\[\s*PROMISE(?:_(DONE|DROP))?\s*[:：]\s*([\s\S]*?)\]\]/g;

export type PromiseOp =
    | { kind: 'add'; what: string; date?: string; time?: string; whenText?: string }
    | { kind: 'done'; code: string }
    | { kind: 'drop'; code: string; reason?: string };

export const parsePromiseDirectives = (content: string, now = new Date()): { content: string; ops: PromiseOp[] } => {
    const ops: PromiseOp[] = [];
    for (const [, verb, rawArgs] of content.matchAll(PROMISE_TAG_RE)) {
        if (ops.length >= MAX_PER_MESSAGE) break;
        const parts = rawArgs.split(/[|｜]/).map(part => part.trim());
        if (verb === 'DONE') {
            if (parts[0]) ops.push({ kind: 'done', code: parts[0] });
        } else if (verb === 'DROP') {
            if (parts[0]) ops.push({ kind: 'drop', code: parts[0], ...(parts[1] ? { reason: parts[1] } : {}) });
        } else {
            const when = parts.length > 1 ? parts[0] : '';
            const what = parts.length > 1 ? parts.slice(1).join('|').trim() : parts[0];
            if (!what) continue;
            const date = when ? parseDateWord(when.replace(/周末/, '周六'), now) ?? undefined : undefined;
            const time = when && date ? parseTimeWord(when) : undefined;
            // 认不出日期也记：答应了就是答应了，把 TA 的原话留着
            ops.push({ kind: 'add', what, ...(date ? { date } : {}), ...(time ? { time } : {}), ...(when && !date ? { whenText: when } : {}) });
        }
    }
    return { content: content.replace(PROMISE_TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim(), ops };
};

type Toast = (msg: string, type: 'info' | 'success' | 'error') => void;

const findByCode = (charId: string, code: string): CharPromise | undefined =>
    loadPromises().find(p => p.charId === charId && p.status === 'open' && promiseCode(p) === code);

const whenLabel = (p: Pick<CharPromise, 'date' | 'time' | 'whenText'>) => {
    if (p.date) {
        const d = new Date(`${p.date}T00:00:00`);
        return `${d.getMonth() + 1}月${d.getDate()}日${p.time ? ` ${p.time}` : ''}`;
    }
    return p.whenText || '';
};

/** chatParser 和烛下调：写进本机、弹一条提示。返回剥掉标签的正文。 */
export const executePromiseDirectives = (
    content: string, charId: string, charName: string, toast?: Toast, opts: { deepTalk?: boolean } = {},
): string => {
    const { content: rest, ops } = parsePromiseDirectives(content);
    // 一次答应好几件时合成一条提示：同一毫秒弹两条，提示条的 key 会撞
    const notes: string[] = [];
    for (const op of ops) {
        if (op.kind === 'add') {
            const candleOnly = !!opts.deepTalk && !isSafeKeptLine(op.what);
            const saved = addPromise({ charId, what: op.what, date: op.date, time: op.time, whenText: op.whenText, candleOnly });
            const when = whenLabel(saved);
            notes.push(`${charName} 记下了${when ? `（${when}）` : ''}：${saved.what}`);
        } else {
            const target = findByCode(charId, op.code);
            if (!target) continue;
            if (op.kind === 'done') {
                settlePromise(target.id, 'done', 'char');
                notes.push(`${charName} 做到了：${target.what}`);
            } else {
                settlePromise(target.id, 'dropped', 'char', op.reason);
                notes.push(`${charName} 说做不到了：${target.what}`);
            }
        }
    }
    if (notes.length) toast?.(notes.join('；'), 'success');
    return rest;
};

// ── 给 TA 看的 ────────────────────────────────────────────────

const lineFor = (p: CharPromise, today: string, userName: string) => {
    const code = promiseCode(p);
    const due = promiseDue(p, today);
    const when = whenLabel(p);
    if (due === 'overdue') return `- [${code}] 过期 ${daysBetween(p.date!, today)} 天：${p.what}（说好 ${when}）`;
    if (due === 'today') return `- [${code}] 今天要做：${p.what}${p.time ? `（${p.time}）` : ''}`;
    if (due === 'later') return `- [${code}] ${when}：${p.what}`;
    return `- [${code}] ${when ? `${when}：` : ''}${p.what}（没定哪天，自己找时间，别让${userName}催）`;
};

/** 聊天提示词：TA 答应过的事 + 怎么写。所有角色都教，不靠 mini。烛下里（inCandle）带上只留在烛下的那些。 */
export const buildPromisesInjection = (
    charId: string,
    { userName = '对方', now = new Date(), list = loadPromises(), inCandle = false }: { userName?: string; now?: Date; list?: CharPromise[]; inCandle?: boolean } = {},
): string => {
    const today = dateKeyOf(now);
    const mine = openPromises(list, charId).filter(p => inCandle || !p.candleOnly).slice(0, MAX_IN_PROMPT);
    let s = `\n### 你答应${userName}的事\n`;
    if (mine.length) {
        s += `这些是你亲口答应的，${userName}看得到。\n${mine.map(p => lineFor(p, today, userName)).join('\n')}\n`;
        if (mine.some(p => promiseDue(p, today) === 'overdue' || promiseDue(p, today) === 'today')) {
            s += `到期的先办：做了就说做了什么；过期的别装没这回事，你自己先提，别等${userName}来问。\n`;
        }
    }
    const missed = list.filter(p => p.charId === charId && p.status === 'dropped' && p.settledBy === 'user'
        && (inCandle || !p.candleOnly) && now.getTime() - p.updatedAt < MISSED_NOTICE_MS);
    if (missed.length) s += `${userName}把这些标成了你没做到：${missed.map(p => `「${p.what}」`).join('、')}。你心里有数，别装不知道。\n`;
    s += `答应${userName}一件具体的事时，当场写下来：单独起一行 \`[[PROMISE: 什么时候 | 做什么]]\`。`
        + '什么时候写「明天」「周四」「11月3日 晚上8点」；没定就写「没定」。标签不会显示。只记真要做的事，一句情话不用记。'
        + '做到了写 `[[PROMISE_DONE: 编号]]`；做不到了，先跟 ta 说清楚，再写 `[[PROMISE_DROP: 编号 | 为什么]]`。\n';
    return s;
};

/** 心跳快照：到期和接下来两天的（只留在烛下的不带） */
export const promisesForSnapshot = (charId: string, now = new Date(), list = loadPromises()) => {
    const today = dateKeyOf(now);
    return openPromises(list, charId)
        .filter(p => !p.candleOnly && p.date && daysBetween(today, p.date) <= 2)
        .slice(0, MAX_IN_PROMPT)
        .map(p => ({ date: p.date as string, ...(p.time ? { time: p.time } : {}), what: p.what }));
};
// [EM-END: char-promises]
