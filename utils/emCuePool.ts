// [EM-START: char-drives-cue]
/**
 * 契机池（聊天这一侧）：偶尔让 TA 脑子里闪过一件跟当前话题无关的事。
 * 规格见 docs/spec-character-drives.md 第 3 节。
 *
 * 起因（阿萌 2026-10-14）：角色从来不会灵光一现——「我来看看你这个月的账本吧」这种念头不会出现。
 * 工具按关键词递进来，没命中就不存在；就算递了，模型也几乎不会无缘无故去用。
 * 人的灵光一现也不是凭空来的，总有个东西勾起它。这里由程序偶尔抽一个「勾起它的东西」，
 * 读好一小段摘录放进提示词，说不说、怎么说、理不理由角色自己定。
 *
 * - 这是契机，不是规定：措辞只写「闪过了什么」，不写「你应该做什么」
 * - 摘录是本地提前读好的，不需要工具循环：交给 mini / 云端回复的那一轮照样能用，也不改路线
 * - 第二阶段用固定权重；第三阶段（劲儿系统）再按劲儿加权
 *
 * 本文件只有纯逻辑和本机状态；读数据的来源在 emCueProviders.ts。
 */

export type CueSource = 'finance' | 'kitchen' | 'calendar' | 'own_life';

export interface Cue {
    source: CueSource;
    /** 同一件事不重复闪，例如「finance:2026-10-13:Trader Joe's:42.1」 */
    dedupeKey: string;
    /** ≤120 字的现成摘录，已经按可见性裁过 */
    text: string;
    /** 本地生成时这一组工具在场，他想细看可以真去查（只用来记账「用没用」） */
    toolGroup?: 'finance';
}

/** 每轮掷一次「有没有念头」。阿萌还没最后定，先按约每 10 轮一次。 */
export const CHAT_CUE_CHANCE = 0.1;
/** 两个念头之间至少隔这么久，免得连着两轮都在闪。 */
export const CUE_MIN_GAP_MS = 30 * 60 * 1000;
/** 同一来源冷却 */
export const CUE_SOURCE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** 同一件事冷却 */
export const CUE_KEY_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
/** 固定权重（第二阶段）。没有内容的来源不参与，其余按比例重分。 */
export const CUE_SOURCE_WEIGHTS: Record<CueSource, number> = {
    finance: 0.3,
    kitchen: 0.25,
    calendar: 0.2,
    own_life: 0.25,
};
const CUE_TEXT_MAX = 120;
const LOG_MAX = 50;

export interface CueLogEntry {
    at: number;
    source: CueSource;
    key: string;
    /** 这一轮交给了谁生成：本机 / mini / 云端 / Instant Push */
    route: string;
    /** 带工具组的契机，这一轮里那组工具真被调用了 */
    toolUsed?: boolean;
}

export interface CueCharState {
    lastAt: number;
    bySource: Partial<Record<CueSource, number>>;
    byKey: Record<string, number>;
    log: CueLogEntry[];
}

const emptyState = (): CueCharState => ({ lastAt: 0, bySource: {}, byKey: {}, log: [] });

/** 冷却里的不能抽。 */
export const isCooledDown = (cue: Cue, state: CueCharState, now: number): boolean =>
    now - (state.bySource[cue.source] ?? 0) >= CUE_SOURCE_COOLDOWN_MS
    && now - (state.byKey[cue.dedupeKey] ?? 0) >= CUE_KEY_COOLDOWN_MS;

/** 先掷「这一轮有没有念头」。没过最小间隔也不掷（rng 照样取一个，保持序列稳定）。 */
export const shouldRollCue = (state: CueCharState, now: number, rng: () => number = Math.random, chance = CHAT_CUE_CHANCE): boolean => {
    const roll = rng();
    if (now - state.lastAt < CUE_MIN_GAP_MS) return false;
    return roll < chance;
};

/** 在可用的契机里按来源权重抽一个；一个都没有就返回 null。 */
export const pickCue = (
    candidates: Cue[],
    state: CueCharState,
    now: number,
    rng: () => number = Math.random,
    weights: Record<CueSource, number> = CUE_SOURCE_WEIGHTS,
): Cue | null => {
    const usable = candidates.filter(cue => cue.text.trim() && isCooledDown(cue, state, now));
    if (!usable.length) return null;
    const scored = usable.map(cue => ({ cue, weight: Math.round((weights[cue.source] ?? 0) * 1000) }))
        .filter(entry => entry.weight > 0);
    const total = scored.reduce((sum, entry) => sum + entry.weight, 0);
    if (!total) return null;
    const target = Math.floor(rng() * total);
    let acc = 0;
    for (const entry of scored) {
        acc += entry.weight;
        if (target < acc) return entry.cue;
    }
    return scored[scored.length - 1].cue;
};

export const clipCueText = (text: string): string => {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    return clean.length > CUE_TEXT_MAX ? `${clean.slice(0, CUE_TEXT_MAX - 1)}…` : clean;
};

/** 写进 volatileState 的那一段。只说闪过了什么，不规定怎么做。 */
export const formatCueInjection = (cue: Cue): string =>
    `\n[此刻闪过的念头]\n你脑子里忽然闪过：${cue.text}。\n`
    + '这是你自己冒出来的念头，跟你们正在聊的不一定有关系。可以顺口提一句、问一句、借题聊开，也可以先放着；'
    + 'ta 正在难过或者在说要紧的事时就先别岔开。怎么提按你自己的性格来，别像在汇报或查岗。\n';

// ── 本机状态（冷却 + 记账）──────────────────────────────────────
const STATE_KEY = 'em_cue_state_v1';

const readAll = (): Record<string, CueCharState> => {
    if (typeof localStorage === 'undefined') return {};
    try {
        const parsed = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const writeAll = (all: Record<string, CueCharState>) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(all));
    } catch {
        // 存不下就算了：最坏是冷却失效，多闪一次
    }
};

export const loadCueState = (charId: string): CueCharState => {
    const raw = readAll()[charId];
    if (!raw || typeof raw !== 'object') return emptyState();
    return {
        lastAt: Number(raw.lastAt) || 0,
        bySource: raw.bySource && typeof raw.bySource === 'object' ? raw.bySource : {},
        byKey: raw.byKey && typeof raw.byKey === 'object' ? raw.byKey : {},
        log: Array.isArray(raw.log) ? raw.log : [],
    };
};

/** 抽中了：记冷却、记一行账。过期的 key 顺手清掉，免得越存越多。 */
export const recordCuePicked = (charId: string, cue: Cue, route: string, now = Date.now()): CueCharState => {
    const all = readAll();
    const state = loadCueState(charId);
    const byKey = Object.fromEntries(
        Object.entries(state.byKey).filter(([, at]) => now - Number(at) < CUE_KEY_COOLDOWN_MS),
    );
    byKey[cue.dedupeKey] = now;
    const next: CueCharState = {
        lastAt: now,
        bySource: { ...state.bySource, [cue.source]: now },
        byKey,
        log: [...state.log, { at: now, source: cue.source, key: cue.dedupeKey, route }].slice(-LOG_MAX),
    };
    all[charId] = next;
    writeAll(all);
    return next;
};

// ── 这一轮的契机（聊天提示词同步读）──────────────────────────────
// 提示词是同步拼的，读数据是异步的：发送前先抽好放这里，拼提示词时取。
// 每轮发送都会重新设一次（没抽中就是 null），所以不会把上一轮的念头带到下一轮。
const pendingCue = new Map<string, Cue | null>();

export const setPendingCue = (charId: string, cue: Cue | null) => { pendingCue.set(charId, cue); };
export const getPendingCue = (charId: string): Cue | null => pendingCue.get(charId) ?? null;

/** chatPrompts 的 volatileState 调这个。没有念头就是空串。 */
export const buildCueInjection = (charId: string): string => {
    const cue = getPendingCue(charId);
    return cue ? formatCueInjection(cue) : '';
};

/** 这一轮真调用了某组工具：如果这一轮的契机正是那一组，记一笔「用了」。 */
export const noteCueToolUse = (charId: string, group: 'finance', now = Date.now()) => {
    const cue = getPendingCue(charId);
    if (!cue || cue.toolGroup !== group) return;
    const all = readAll();
    const state = loadCueState(charId);
    const last = state.log[state.log.length - 1];
    if (!last || last.key !== cue.dedupeKey || now - last.at > 10 * 60 * 1000 || last.toolUsed) return;
    state.log[state.log.length - 1] = { ...last, toolUsed: true };
    all[charId] = state;
    writeAll(all);
};
// [EM-END: char-drives-cue]
