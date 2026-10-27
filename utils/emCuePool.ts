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
 * - 第二阶段用固定权重；第三阶段（心思系统）再按心思加权
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

/**
 * 按心思加权（第三阶段，心思系统在 feat/char-drives-engine）：哪种心思强，跟它沾边的来源更容易闪过。
 * 好奇高 → 更容易想起她的账本；挂心高 → 冰箱、日历、账本；想你 / 社交高 → 日历、自己今天的事。
 * 有心思冒头时这一轮更容易闪念头（最多 0.2）。拿不到心思数据就是原来的固定权重。
 */
const SOURCE_DRIVES: Record<CueSource, string[]> = {
    finance: ['curious', 'concern'],
    kitchen: ['concern'],
    calendar: ['concern', 'miss'],
    own_life: ['social', 'miss'],
};
const LEVEL_BOOST = { mid: 1, high: 2 } as const;
export const CUE_CHANCE_MAX = 0.2;

export const driveWeightedWeights = (
    drives: { drive: string; level: 'mid' | 'high' }[],
    base: Record<CueSource, number> = CUE_SOURCE_WEIGHTS,
): Record<CueSource, number> => {
    const out = { ...base };
    for (const source of Object.keys(out) as CueSource[]) {
        const boost = drives.filter(d => SOURCE_DRIVES[source].includes(d.drive)).reduce((sum, d) => sum + (LEVEL_BOOST[d.level] ?? 0), 0);
        out[source] = base[source] * (1 + boost);
    }
    return out;
};

export const driveCueChance = (drives: { drive: string; level: 'mid' | 'high' }[], base = CHAT_CUE_CHANCE): number =>
    Math.min(CUE_CHANCE_MAX, base * (1 + 0.5 * drives.length));
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
// 每轮发送都会重新设一次（没抽中就是 null）。但别的地方也会拼同一个角色的提示词
// （本机主动消息、小小窝、彼方），所以念头只给拼进去的第一份用，拼过就不再给（2026-10-20 审查）。
const pendingCue = new Map<string, { cue: Cue; injected: boolean }>();

export const setPendingCue = (charId: string, cue: Cue | null) => {
    if (cue) pendingCue.set(charId, { cue, injected: false });
    else pendingCue.delete(charId);
};
/** 这一轮抽中的念头（拼没拼进提示词都算），记「用没用工具」时看。 */
export const getPendingCue = (charId: string): Cue | null => pendingCue.get(charId)?.cue ?? null;

/** chatPrompts 的 volatileState 调这个。没有念头、或已经拼进过一次就是空串。 */
export const buildCueInjection = (charId: string): string => {
    const entry = pendingCue.get(charId);
    if (!entry || entry.injected) return '';
    entry.injected = true;
    return formatCueInjection(entry.cue);
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

// ── 这一轮掷的结果（给 ⚡ 面板看）────────────────────────────────
// 2026-10-27 阿萌：只有控制台能看到抽没抽中，手机上看不到，所以体验不到也分不清是没抽中还是没起作用。
// 只存内存：面板看的是「刚刚那一轮」，刷新后没了也无妨；近几天的次数读 log。

export type CueRollOutcome = 'picked' | 'skipped' | 'gap' | 'missed' | 'empty' | 'error';

export interface CueRollRecord {
    at: number;
    outcome: CueRollOutcome;
    cue?: Pick<Cue, 'source' | 'text'>;
}

const lastRolls = new Map<string, CueRollRecord>();

export const noteCueRoll = (charId: string, record: CueRollRecord) => { lastRolls.set(charId, record); };
export const getLastCueRoll = (charId: string): CueRollRecord | null => lastRolls.get(charId) ?? null;

export const CUE_SOURCE_LABELS: Record<CueSource, string> = {
    finance: '账本',
    kitchen: '冰箱',
    calendar: '日历',
    own_life: 'TA 自己的事',
};

const CUE_MISS_REASONS: Record<Exclude<CueRollOutcome, 'picked'>, string> = {
    skipped: '这一轮在聊工具话题或深谈，不岔开',
    gap: '离上一次念头不到 30 分钟',
    missed: '掷了没中（约每 10 轮一次）',
    empty: '掷中了，但没有能用的素材（都在冷却或没数据）',
    error: '读素材出错了，这一轮不带',
};

const agoText = (ms: number): string => {
    const min = Math.max(0, Math.round(ms / 60000));
    if (min < 60) return `${min} 分钟前`;
    const hours = Math.round(min / 60);
    return hours < 24 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`;
};

/** ⚡ 面板「本轮念头」那两行：这一轮怎么样 + 近 7 天闪过几次。 */
export const describeCueRoll = (
    roll: CueRollRecord | null,
    state: CueCharState,
    now = Date.now(),
): { headline: string; detail?: string; recent: string } => {
    const headline = !roll
        ? '还没记录（发一条消息后才有）'
        : roll.outcome === 'picked'
            ? `这一轮闪过（${CUE_SOURCE_LABELS[roll.cue?.source ?? 'own_life']}）`
            : `这一轮没闪：${CUE_MISS_REASONS[roll.outcome]}`;
    const detail = roll?.outcome === 'picked' ? roll.cue?.text : undefined;
    const week = state.log.filter(entry => now - entry.at < 7 * 24 * 60 * 60 * 1000);
    const last = week[week.length - 1];
    const recent = last
        ? `近 7 天闪过 ${week.length} 次 · 上次 ${agoText(now - last.at)}（${CUE_SOURCE_LABELS[last.source] ?? last.source}）`
        : '近 7 天一次也没闪过';
    return { headline, detail, recent };
};
// [EM-END: char-drives-cue]
