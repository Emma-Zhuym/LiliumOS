/**
 * 心跳（阶段 1c）。契约见 docs/agent-backend-design.md 第 4.3 节。
 *
 * 这个文件的重点不是「怎么让角色说话」，而是**怎么让角色闭嘴**：
 * 六道零模型闸只要命中一道就直接结束，连模型都不叫。闸门判断全是纯函数 + 注入时钟，
 * 这样「阿萌正在聊天时绝不插话」这种事可以用单测钉死，而不是上线后靠观察。
 *
 * 1c 默认影子运行：照常判断、照常调模型，但不发消息、不执行工具，只写 model_runs。
 */

import { createHash } from 'node:crypto';

import { getSetting } from './db.mjs';
import { getCharacter, toCharacter } from './characters.mjs';
import { getSnapshot } from './snapshots.mjs';
import { SHORT_ID_LENGTH, applyThread, closeStaleThreads, listOpenThreads } from './lifeThreads.mjs';

/** 心跳最晚执行时间：过了就 expired，mini 睡醒后不会补跑一堆旧心跳（设计 4.1）。 */
export const HEARTBEAT_TTL_MS = 15 * 60 * 1000;
/** 「阿萌正在和这个角色聊天」的判定窗口。 */
export const ACTIVE_CHAT_WINDOW_MS = 20 * 60 * 1000;
/** 开启心跳后第一跳的延迟（设计 3.3）。 */
export const FIRST_BEAT_DELAY_MS = 3 * 60 * 1000;
/**
 * 心跳消息的保质期（设计 4.3.1）。
 *
 * 推送没送到时（手机关机、没网），这条会躺在信箱里等下次打开 App。超过这个时间还没取走，
 * 就不该再当成「刚说的话」送进聊天——三天前那句「突然想到你」原样冒出来很怪。
 */
export const MESSAGE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const MINUTE = 60_000;

/**
 * ±20% 的确定性抖动。
 *
 * 用 charId + 代次 + 名义时刻算哈希，所以看起来随机，但同一跳重算永远是同一个结果——
 * 重试时不会因为「又摇了一次骰子」而长出第二条心跳链。
 */
export const jitterRatio = (charId, generation, nominalRunAt, spread = 0.2) => {
    const digest = createHash('sha256')
        .update(`${charId}:${generation}:${nominalRunAt}`)
        .digest();
    // 取两字节映射到 [-spread, +spread]，在区间里是均匀的。
    const unit = ((digest[0] << 8) | digest[1]) / 0xffff;
    return (unit - 0.5) * 2 * spread;
};

/**
 * 排跳时用的抖动幅度：±50%，也就是默认 60 分钟一跳时实际落在 30–90 分钟之间。
 *
 * 之前是 ±20%（90 分钟 → 72–108），太像整点报时。区间宽一点更像人：有时隔半小时又想起你，
 * 有时忙到一个半小时才有空。平均间隔不变，所以每天的醒来次数和预算都不受影响。
 */
export const HEARTBEAT_JITTER_SPREAD = 0.5;

/**
 * 「空档」= 从忙碌转成有空的那一刻起的一小段时间：午休、下班、茶歇。
 *
 * 真人上班谈恋爱，多半就在这种空档里多说两句。但心跳是 90 分钟一跳的随机节奏，
 * 常常整个午休都碰不上一跳；碰上了，也可能因为「刚说过话」的冷却被挡回去。
 * 所以这里把空档单独认出来：排跳时瞄准它，闸门和概率在里面放宽（见 nextRunAt / checkGates / messageChance）。
 */
export const BREAK_WINDOW_MAX_MIN = 90;
const BREAK_TITLE = /午休|午饭|午餐|午间|吃饭|茶歇|下班|休息|课间/;
/** 空档里冷却缩短到这么久：午休那点时间够说两三句，不该被上午那条挡住。 */
export const BREAK_COOLDOWN_MIN = 30;

const slotStartMinutes = slot => toMinutes(slot?.start ?? slot?.startTime);

/** 这一段算不算「空档的开头」：有空，并且是刚忙完转过来的（或者标题本身就是午休之类）。 */
const isBreakSlot = (slots, index) => {
    const slot = slots[index];
    if (!slot || slot.availability !== 'online') return false;
    if (BREAK_TITLE.test(String(slot.title ?? slot.activity ?? ''))) return true;
    return index > 0 && slots[index - 1]?.availability === 'busy';
};

/**
 * 现在是否正处在空档里：某个空档段开始后的 BREAK_WINDOW_MAX_MIN 分钟内。
 * 限时是因为「下班后整个晚上」也是 online，不能整晚都当空档放宽。
 */
export const inBreakWindow = (snapshot, now, timezone) => {
    const slots = snapshot?.payload?.todaySchedule;
    if (!Array.isArray(slots) || slots.length === 0) return false;
    const minutes = localMinutes(now, timezone);
    for (let index = 0; index < slots.length; index += 1) {
        const start = slotStartMinutes(slots[index]);
        if (start === null || !isBreakSlot(slots, index)) continue;
        if (minutes >= start && minutes < start + BREAK_WINDOW_MAX_MIN) return true;
    }
    return false;
};

/** 今天还没到的空档开头（绝对时刻，升序）。没有日程就是空数组。 */
export const upcomingBreakStarts = (snapshot, now, timezone) => {
    const slots = snapshot?.payload?.todaySchedule;
    if (!Array.isArray(slots) || slots.length === 0) return [];
    const minutes = localMinutes(now, timezone);
    const base = now.getTime() - (now.getSeconds() * 1000 + now.getMilliseconds());
    const out = [];
    for (let index = 0; index < slots.length; index += 1) {
        const start = slotStartMinutes(slots[index]);
        if (start === null || start <= minutes || !isBreakSlot(slots, index)) continue;
        out.push(new Date(base + (start - minutes) * MINUTE));
    }
    return out.sort((a, b) => a - b);
};

/** 落进空档后再晚几分钟醒（3–10 分钟，确定性）：别整点踩线，也别落到空档快结束时。 */
const breakOffsetMin = (charId, generation, breakStart) => {
    const digest = createHash('sha256').update(`${charId}:${generation}:break:${breakStart.toISOString()}`).digest();
    return 3 + (digest[0] / 255) * 7;
};

/** 这个角色这一跳实际隔多久：默认用角色自己的设置，试跑时由 override 统一接管。 */
export const effectiveEveryMin = (character, { everyMinOverride = 0 } = {}) =>
    everyMinOverride > 0 ? everyMinOverride : character.heartbeatEveryMin;

/**
 * 排下一跳的时刻。落在安静时段就推到 quiet_end 之后（再带一次抖动），
 * 免得 0–7 点排一串任务，等到 7 点一起醒来。
 */
export const nextRunAt = (character, {
    now = new Date(),
    everyMinOverride = 0,
    quiet = null,
    breakStarts = [],
} = {}) => {
    const everyMin = effectiveEveryMin(character, { everyMinOverride });
    const nominal = new Date(now.getTime() + everyMin * MINUTE);
    const ratio = jitterRatio(character.charId, character.heartbeatGeneration, nominal.toISOString(), HEARTBEAT_JITTER_SPREAD);
    let runAt = new Date(nominal.getTime() + everyMin * MINUTE * ratio);
    // 瞄准空档：有个空档开头落在「现在之后、自然下一跳之后不久」之间，就把这一跳挪进去。
    // 试跑提速（everyMinOverride）时不挪——那是在测节奏，不该被日程改写。
    if (!(everyMinOverride > 0)) {
        const target = breakStarts.find(start =>
            start.getTime() > now.getTime() + 10 * MINUTE && start.getTime() <= runAt.getTime() + 25 * MINUTE);
        if (target) {
            runAt = new Date(target.getTime()
                + breakOffsetMin(character.charId, character.heartbeatGeneration, target) * MINUTE);
        }
    }
    if (quiet?.isQuiet?.(runAt)) {
        const wake = quiet.nextEndAfter(runAt);
        runAt = new Date(wake.getTime() + Math.abs(ratio) * everyMin * MINUTE);
    }
    return runAt;
};

/** 心跳任务的 uuid：同一代次、同一名义时刻只会有一条（设计 4.3 第 2 步）。 */
export const heartbeatUuid = (charId, generation, runAt) =>
    `hb:${charId}:${generation}:${new Date(runAt).toISOString()}`;

/** 本地时间（角色所在时区）的「分钟数」，用来和 sleepWindow 比。 */
const localMinutes = (date, timezone) => {
    const text = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
    }).format(date);
    const [hour, minute] = text.split(':').map(Number);
    return hour * 60 + minute;
};

const toMinutes = value => {
    const [h, m] = String(value || '').split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export const inSleepWindow = (now, sleepWindow, timezone) => {
    const from = toMinutes(sleepWindow?.start);
    const to = toMinutes(sleepWindow?.end);
    if (from === null || to === null) return false;
    const minutes = localMinutes(now, timezone);
    // 跨午夜（00:30–08:00 之外的写法，比如 23:00–07:00）要按「或」判断。
    return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
};

/**
 * 「最近一次真实互动」：取在场信号与快照里的时间戳的较大值。
 *
 * 快照里的时间来自手机，手机时钟跑快的话会把心跳长期封死，所以先夹到不晚于
 * 快照的 received_at——最多只能算作「上传那一刻刚聊过」（设计 4.3 第 3 步）。
 */
export const lastRealInteractionAt = (character, snapshot) => {
    const candidates = [];
    if (character.lastUserInteractionAt) candidates.push(Date.parse(character.lastUserInteractionAt));
    if (snapshot) {
        const receivedAt = Date.parse(snapshot.receivedAt);
        for (const key of ['userAt', 'charAt']) {
            const raw = snapshot.payload?.lastInteraction?.[key];
            if (!raw) continue;
            const parsed = Date.parse(raw);
            if (Number.isFinite(parsed)) candidates.push(Math.min(parsed, receivedAt));
        }
    }
    const valid = candidates.filter(Number.isFinite);
    return valid.length ? new Date(Math.max(...valid)) : null;
};

/** 今天（按角色时区算的自然日）已经真正调用过几次模型。skipped 的不算（设计 2.8）。 */
export const modelRunsToday = (db, charId, now, timezone) => {
    const dayStart = startOfLocalDay(now, timezone);
    return db.prepare(
        `SELECT COUNT(*) AS n FROM model_runs
          WHERE char_id = ? AND started_at >= ? AND outcome IS NOT 'skipped'`,
    ).get(charId, dayStart.toISOString()).n;
};

export const startOfLocalDay = (now, timezone) => {
    const minutes = localMinutes(now, timezone);
    return new Date(now.getTime() - minutes * MINUTE - (now.getSeconds() * 1000 + now.getMilliseconds()));
};

/** 上一条真发出去的主动消息的时刻，用来算冷却。影子期没有真消息，冷却自然不会命中。 */
const lastChatMessageAt = (db, charId) =>
    db.prepare(
        `SELECT created_at FROM outbox
          WHERE char_id = ? AND kind = 'chat_message'
          ORDER BY id DESC LIMIT 1`,
    ).get(charId)?.created_at ?? null;

/**
 * 六道零模型闸。返回命中的那道闸的名字，全都通过则返回 null。
 *
 * 顺序按「越便宜越先判」排：读角色行就能判的排前面，要查表的排后面。
 */
export const checkGates = (db, { character, snapshot, now = new Date() }) => {
    if (character.heartbeatPaused) return 'paused';
    if (!snapshot) return 'no_snapshot';

    const timezone = snapshot.payload?.timezone || getSetting(db, 'timezone') || 'America/Chicago';
    if (inSleepWindow(now, snapshot.payload?.sleepWindow, timezone)) return 'sleeping';

    const lastInteraction = lastRealInteractionAt(character, snapshot);
    if (lastInteraction && now.getTime() - lastInteraction.getTime() < ACTIVE_CHAT_WINDOW_MS) {
        return 'active_chat';
    }

    // 空档里冷却缩短：午休本来就是多说两句的时候，不该被上午那条挡住。
    const cooldownMin = inBreakWindow(snapshot, now, timezone)
        ? Math.min(character.messageCooldownMin, BREAK_COOLDOWN_MIN)
        : character.messageCooldownMin;
    const lastMessage = lastChatMessageAt(db, character.charId);
    if (lastMessage && now.getTime() - Date.parse(lastMessage) < cooldownMin * MINUTE) {
        return 'message_cooldown';
    }

    if (modelRunsToday(db, character.charId, now, timezone) >= character.dailyModelBudget) {
        return 'daily_budget';
    }
    return null;
};

export const recordModelRun = (db, {
    jobUuid = null,
    charId,
    runtime,
    startedAt,
    durationMs = null,
    ok,
    outcome = null,
    shadow = false,
    reason = null,
    proposedText = null,
    proposedTool = null,
    proposedArgsSummary = null,
    skipGate = null,
    error = null,
    activity = null,
    rawOutput = null,
    intent = null,
    urge = null,
    episode = null,
}) => {
    db.prepare(
        `INSERT INTO model_runs (job_uuid, char_id, runtime, started_at, duration_ms, ok, outcome,
                                 shadow, reason, proposed_text, proposed_tool, proposed_args_summary,
                                 skip_gate, error, activity, raw_output, intent, urge, episode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        jobUuid, charId, runtime, startedAt, durationMs, ok ? 1 : 0, outcome,
        shadow ? 1 : 0, truncate(reason, 500), truncate(proposedText, 2000), proposedTool,
        truncate(proposedArgsSummary, 500), skipGate, truncate(error, 500),
        truncate(activity, 200), truncate(rawOutput, 2000), intent, urge,
        episode ? truncate(JSON.stringify(episode), 4000) : null,
    );
};

/**
 * TA 前几次醒来时的样子（按时间正序）。
 *
 * 每一跳原本都是失忆的：上一跳刚想过「等会儿去找她」，这一跳完全不知道，
 * 于是「等会儿」永远停在嘴上。只取真正动过脑的那些，被闸门拦下的没有内容。
 */
export const recentThoughts = (db, charId, { since, limit = 4 } = {}) => db.prepare(
    `SELECT started_at, activity, reason, outcome, proposed_text FROM model_runs
      WHERE char_id = ? AND ok = 1 AND shadow = 0 AND outcome IN ('noop','message') AND started_at >= ?
      ORDER BY id DESC LIMIT ?`,
).all(charId, since.toISOString(), limit).reverse().map(row => ({
    at: row.started_at,
    activity: row.activity,
    reason: row.reason,
    said: row.outcome === 'message' ? row.proposed_text : null,
}));

/**
 * 上一跳留下、还没兑现的「想找 ta」。
 *
 * 只看最近一次动过脑的那跳：它说了「等会儿」却没开口，这一跳就是那个等会儿。
 * `since` 是最后一次真实聊天——之后聊过了，念头已经在聊天里了结，不再欠着。
 */
export const pendingUrge = (db, charId, { since = null } = {}) => {
    const row = db.prepare(
        `SELECT started_at, reason, urge, outcome FROM model_runs
          WHERE char_id = ? AND ok = 1 AND shadow = 0 AND outcome IN ('noop','message')
          ORDER BY id DESC LIMIT 1`,
    ).get(charId);
    if (!row || row.outcome === 'message') return null;
    if (row.urge !== 'later' && row.urge !== 'now') return null;
    if (since && Date.parse(row.started_at) <= since.getTime()) return null;
    return { at: row.started_at, reason: row.reason, urge: row.urge };
};

const truncate = (value, limit) =>
    value === null || value === undefined ? null : String(value).slice(0, limit);

export const listModelRuns = (db, { charId = null, limit = 50 } = {}) => {
    const clauses = [];
    const params = [];
    if (charId) { clauses.push('char_id = ?'); params.push(charId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
    return db.prepare(`SELECT * FROM model_runs ${where} ORDER BY id DESC LIMIT ?`).all(...params).map(row => ({
        id: row.id,
        jobUuid: row.job_uuid,
        charId: row.char_id,
        runtime: row.runtime,
        startedAt: row.started_at,
        durationMs: row.duration_ms,
        ok: row.ok === 1,
        outcome: row.outcome,
        shadow: row.shadow === 1,
        reason: row.reason,
        proposedText: row.proposed_text,
        proposedTool: row.proposed_tool,
        proposedArgsSummary: row.proposed_args_summary,
        skipGate: row.skip_gate,
        error: row.error,
        activity: row.activity,
        rawOutput: row.raw_output,
        intent: row.intent,
        urge: row.urge,
        episode: (() => { try { return row.episode ? JSON.parse(row.episode) : null; } catch { return null; } })(),
    }));
};

export const isShadowMode = db => {
    try {
        return JSON.parse(getSetting(db, 'heartbeat_shadow') || '{}').enabled !== false;
    } catch {
        // 设置读坏了就按影子算：宁可少说话，也不要在没人看着的时候突然真发消息。
        return true;
    }
};

/**
 * 当前落在日程的哪一段。没有日程就返回 null，权重按「不知道在忙什么」算。
 */
export const currentSlot = (snapshot, now, timezone) => {
    const slots = snapshot?.payload?.todaySchedule;
    if (!Array.isArray(slots) || slots.length === 0) return null;
    const minutes = localMinutes(now, timezone);
    let current = null;
    for (const slot of slots) {
        const start = toMinutes(slot.start ?? slot.startTime);
        if (start === null || start > minutes) continue;
        if (!current || start >= toMinutes(current.start ?? current.startTime)) current = slot;
    }
    return current;
};

/**
 * 这一跳开口的概率。
 *
 * 为什么要抽签：让模型每次判断「要不要打扰对方」，它几乎永远能为沉默找到理由——
 * 换了 Opus 和 Gemini 都一样，这是「判断题」式提示词的通病，不是哪家模型的问题。
 * 所以把「这次开不开口」交给程序，模型只负责把定好的事说得自然（设计 3.3）。
 *
 * 权重跟着日程走：忙的时候本来就不该老找人；闲着的时候想起对方是自然的。
 * 再叠一层时间：越久没说话，越该开口——否则一周都碰不上一次高概率的时刻。
 */
export const messageChance = ({ availability, minutesSinceContact, inBreak = false }) => {
    const base = inBreak ? 0.45
        : availability === 'busy' ? 0.08
            : availability === 'offline' ? 0.02
                : availability === 'online' ? 0.25
                    : 0.15;
    const hours = (minutesSinceContact ?? 0) / 60;
    // 空档里不罚「刚说过话」：午休本来就是想多聊两句的时候。
    const gapBoost = hours >= 12 ? 3 : hours >= 6 ? 2.5 : hours >= 3 ? 1.8 : hours >= 1 || inBreak ? 1 : 0.4;
    // 封顶 0.6：再高就成了「每隔两跳必找你一次」，那是另一种不自然。
    return Math.min(0.6, Math.max(0, base * gapBoost));
};

/**
 * 决定这一跳的意图。reach_out = 去说句话；live = 过自己的日子。
 * rng 可注入，测试里钉死。
 */
export const decideIntent = ({ snapshot, now, timezone, minutesSinceContact, carried = null, rng = Math.random }) => {
    const slot = currentSlot(snapshot, now, timezone);
    const availability = slot?.availability ?? null;
    // 上一跳自己说了「等会儿找 ta」：这一跳不再抽签，兑现它。
    // 冷却、每日上限这些闸在抽签之前已经过了，所以不会因此刷屏。
    const inBreak = inBreakWindow(snapshot, now, timezone);
    const chance = carried ? 1 : messageChance({ availability, minutesSinceContact, inBreak });
    return {
        intent: rng() < chance ? 'reach_out' : 'live',
        chance,
        slot: slot ? { title: slot.title ?? slot.activity ?? '', availability } : null,
        inBreak,
    };
};

/**
 * 这一段日程算不算「在忙工作 / 学业」：标了忙，或者标题里带这些词。
 * 不认某个角色的具体职业——只认通用的「上班 / 开会 / 上课」这类说法，人设不同、措辞不同也都够用。
 */
const WORK_TITLE = /上班|工作|开会|会议|办公|公司|项目|审批|加班|出差|谈判|应酬|上课|课程|自习|实验|论文|考试/;
export const isWorkSlot = slot =>
    Boolean(slot) && (slot.availability === 'busy' || WORK_TITLE.test(String(slot.title ?? slot.activity ?? '')));

/**
 * 这一跳要不要产出一段工作往来。
 *
 * 和「开不开口」同一个道理：让模型自己决定要不要写，它会选最省事的那个（不写）。
 * 所以由程序抽签，抽中了才把要求交给模型。工作时段概率高，别的时段也留一点——
 * 真人下班后偶尔也会回一条工作消息；手头有正在推进的事时更该接着写。
 *
 * 只在「过自己的日子」的跳里抽：去找阿萌的那一跳，注意力全在 ta 身上，
 * 节外生枝写一段同事对话反而像心不在焉。
 */
export const episodeChance = ({ workish, hasThreads }) => {
    const base = workish ? 0.55 : 0.12;
    return Math.min(0.75, base + (workish && hasThreads ? 0.15 : 0));
};

export const decideEpisode = ({ snapshot, now, timezone, intent, threads = [], rng = Math.random }) => {
    if (intent !== 'live') return { wanted: false, chance: 0 };
    const slot = currentSlot(snapshot, now, timezone);
    if (slot?.availability === 'offline') return { wanted: false, chance: 0 };
    const chance = episodeChance({ workish: isWorkSlot(slot), hasThreads: threads.length > 0 });
    return { wanted: rng() < chance, chance };
};

/**
 * 排查开关：解析失败时要不要把模型原文留一段。
 * 默认关。原文里有角色的话，只落在 mini 的库里，不进日志、不进推送。
 */
export const shouldCaptureRaw = db => {
    try {
        return JSON.parse(getSetting(db, 'heartbeat_debug') || '{}').captureRawOnError === true;
    } catch {
        return false;
    }
};

/** 心跳输出的 JSON Schema（设计 4.3 第 4 步）。 */
export const HEARTBEAT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'activity', 'reason'],
    properties: {
        action: { type: 'string', enum: ['noop', 'message'] },
        activity: { type: 'string', maxLength: 120 },
        reason: { type: 'string', maxLength: 500 },
        text: { type: 'string', maxLength: 2000 },
        urge: { type: 'string', enum: ['none', 'later', 'now'] },
        // 工作往来：只有程序抽中「这一跳在处理工作」时才会要求写，见 decideEpisode。
        episode: {
            type: 'object',
            additionalProperties: false,
            required: ['channel', 'with', 'lines'],
            properties: {
                channel: { type: 'string', enum: ['group', 'dm', 'email'] },
                with: { type: 'string', maxLength: 40 },
                subject: { type: 'string', maxLength: 80 },
                lines: {
                    type: 'array',
                    maxItems: 8,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['who', 'text'],
                        properties: { who: { type: 'string', maxLength: 24 }, text: { type: 'string', maxLength: 400 } },
                    },
                },
                thread: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['title', 'summary', 'status'],
                    properties: {
                        id: { type: 'string', maxLength: 64 },
                        title: { type: 'string', maxLength: 40 },
                        summary: { type: 'string', maxLength: 200 },
                        status: { type: 'string', enum: ['open', 'done'] },
                    },
                },
            },
        },
    },
};

/**
 * 拼提示词。「什么时候该说话」写死在这里，不交给模型自由发挥——
 * 没话找话是主动消息最容易翻车的地方（设计 4.3 第 4 步）。
 */
export const buildPrompt = (character, snapshot, now = new Date(), intent = 'live', {
    thoughts = [], carried = null, threads = [], episode = false,
} = {}) => {
    const p = snapshot.payload || {};
    const lines = [];
    lines.push(`你是「${p.identity?.name || character.displayName}」，正在自己的生活里过日子。`);
    if (p.identity?.persona) lines.push(`你的设定：\n${p.identity.persona}`);
    lines.push(`对方是「${p.user?.name || '阿萌'}」。现在是 ${formatLocal(now, p.timezone)}（${p.timezone || '未知时区'}）。`);
    if (p.sleepWindow) lines.push(`你的作息：${p.sleepWindow.start} 睡，${p.sleepWindow.end} 起。`);
    // 情绪底色：聊天那边每轮情绪评估写出来的叙事。缺了它，心跳里的 TA 永远是出厂情绪。
    if (p.mood) lines.push(`你此刻的情绪底色：\n${p.mood}`);
    // 日常节律：跟聊天日程生成用的是同一份自由文本。没有它，心跳完全不知道 TA 平时在哪、忙什么。
    if (p.dailyRhythm) lines.push(`你平时的生活节律（稳定的框架，不是今天必须逐字照做）：\n${p.dailyRhythm}`);
    if (Array.isArray(p.todaySchedule) && p.todaySchedule.length) {
        lines.push(`今天的安排：\n${p.todaySchedule.map(s => `- ${s.start}–${s.end} ${s.title}`).join('\n')}`);
    }
    if (Array.isArray(p.boundaries) && p.boundaries.length) {
        lines.push(`已经确认过的关系与边界（必须遵守）：\n${p.boundaries.map(b => `- ${b.text}`).join('\n')}`);
    }
    if (Array.isArray(p.openThreads) && p.openThreads.length) {
        const confirmed = p.openThreads.filter(t => t.confirmed);
        const guessed = p.openThreads.filter(t => !t.confirmed);
        if (confirmed.length) lines.push(`你们说好的事：\n${confirmed.map(t => `- ${t.text}`).join('\n')}`);
        if (guessed.length) {
            lines.push(`你自己的猜测（**没有**得到确认）：\n${guessed.map(t => `- 也许：${t.text}`).join('\n')}`);
            lines.push('硬性要求：不得把未确认的猜测说成对方答应过的事或已经约定的安排。');
        }
    }
    if (Array.isArray(p.recentMessages) && p.recentMessages.length) {
        // 必须写明「这是多久以前的」：近况快照只在对方发消息时才更新，
        // 不标时间的话，角色会把三小时前的对话当成刚刚发生，于是永远觉得「人就在旁边，没必要说话」。
        const gap = formatGap(lastRealInteractionAt(character, snapshot), now);
        lines.push(
            `${gap ? `你们上次说话是${gap}。下面这些对话发生在那时候，不是刚刚：` : '最近的对话：'}\n`
            + p.recentMessages.slice(-12).map(m => `${m.role === 'user' ? '对方' : '你'}：${m.text}`).join('\n'),
        );
        // 只给间隔还不够：模型会拿这段空白自己补剧情，把「她应该洗完了」一路脑补成
        // 「我已经帮她吹完头发了」，然后据此判断「人就在身边，没必要发消息」——
        // 等着的那件事被自己想完了，开口的理由也就没了。所以这里把边界写死。
        lines.push(
            '重要：从上次说话到现在，你们之间没有发生过任何互动。'
            + '这段时间对方在做什么，你并不知道；不要假设你们已经见过面、说过话，'
            + '也不要把当时说好要做的事当成已经做完了。'
            + '如果你们之间有还没兑现的约定，而时间已经过去不少，问一句正是此刻该做的事。',
        );
    }
    if (thoughts.length) {
        lines.push(
            '你今天早些时候自己待着的样子（这是你真实经历过的，对方并不知道）：\n'
            + thoughts.map(t => `- ${formatLocal(new Date(t.at), p.timezone)}：${t.activity || ''}`
                + `${t.reason ? `（心里想：${t.reason}）` : ''}${t.said ? `（你对 ta 说了：${t.said}）` : ''}`).join('\n'),
        );
    }
    if (carried) {
        lines.push(`你上一次醒来时心里想的是：「${carried.reason}」。现在就是那个「等会儿」了。`);
    }
    // 手头正在推进的事：每一跳都带上，「领口还要改」下一跳才接得上。
    if (threads.length) {
        lines.push(
            '你手头正在推进的事（这是你真实在做的，对方并不知道细节）：\n'
            + threads.map(t => `- 「${t.title}」${t.summary ? `：${t.summary}` : ''}（id：${String(t.id).slice(0, SHORT_ID_LENGTH)}）`).join('\n'),
        );
    }
    // 开不开口已经定了，模型不再做判断题，只负责把它说得像这个人会说的话。
    lines.push(
        intent === 'reach_out'
            ? '现在你想起了对方，并且决定跟 ta 说句话。\n'
                + '规则：activity 里用第一人称写你这会儿在做什么（40 字以内）；'
                + 'action 填 "message"，text 写你要说的那句话——'
                + '要贴着你此刻正在做的事和你们之间还没了结的话头，别写成万能问候。'
                + '真的想不出任何自然的话头时才退回 action="noop"，那说明这一刻确实不合适。'
                + 'reason 写你心里的想法，对方看不到它。urge 填 "none"。'
            : '现在你自己醒了一下，过你自己的日子。\n'
                + '规则：activity 里用第一人称写你这会儿在做什么（40 字以内），'
                + '贴着你当下的时段——在上班就是工作里的事，闲着就是闲着的事。'
                + '一般 action 填 "noop"；但如果你心里正放不下 ta、此刻就想说（比如 ta 刚才在难过），'
                + '那就别等：action 填 "message"，text 写你要说的话。'
                + 'reason 写你心里的想法，对方看不到它。'
                + 'urge：你打算过一阵再找 ta 就填 "later"（下次醒来你就会去找），没这个打算填 "none"。',
    );
    // 抽中了「这一跳在处理工作」：把要求交给模型，让它写一小段真实的往来。
    if (episode && intent !== 'reach_out') {
        lines.push(
            '这一跳你正好在处理工作（或学业）上的事。在 episode 里写一小段真实的往来：\n'
            + '- channel：group = 工作群，dm = 和某个同事私聊，email = 邮件；with 写群名或对方的名字。'
            + '同事的名字前后要一致，别每次换人；email 再写 subject。\n'
            + '- lines：最多 6 句，who 写说话人的名字，你自己写「我」。只写工作里的话，别提对方。\n'
            + '- 上面有正在推进的事就接着写它的下一步：thread.id 照抄括号里的 id，summary 写这一步之后的进展。'
            + '开一件新事就不填 id。事情办完了 status 填 "done"，否则 "open"。\n'
            + '- 只写日常工作里的往来，不要在里面做出辞职、搬家、出事这类会改变你人生的大事。\n'
            + '- 如果你根本没有工作或学业，整段省略 episode。\n'
            + 'activity 仍然写你这会儿在做什么，要和 episode 对得上。',
        );
    }
    return lines.join('\n\n');
};

/**
 * 给模型看的时间。
 *
 * 用中文 12 小时制（「晚上7:47」），不用 24 小时制：实测模型会把 `19:47` 读成 9 点多，
 * 一句话里的时间错两个小时，后面的判断全跟着歪。角色本来也该这么说话。
 */
/** 「3 小时 20 分钟前」。太近（不到 1 分钟）就不写，免得出现「0 分钟前」。 */
export const formatGap = (since, now) => {
    if (!since) return '';
    const minutes = Math.floor((now.getTime() - since.getTime()) / 60_000);
    if (minutes < 1) return '';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours < 24) return rest ? `${hours} 小时 ${rest} 分钟前` : `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
};

const formatLocal = (date, timezone) => {
    try {
        return new Intl.DateTimeFormat('zh-CN', {
            timeZone: timezone || 'America/Chicago', hour12: true,
            month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit',
        }).format(date);
    } catch {
        return date.toISOString();
    }
};

/**
 * 心跳处理器。
 *
 * 步骤严格按设计 4.3：代次检查 → **先排下一跳** → 零模型闸 → 调模型 → 记录。
 * 「先排下一跳」不能挪到后面：模型那步一旦抛错，链子就断了，之后这个角色再也不会醒。
 */
export const createHeartbeatHandler = ({
    db, config, runners, scheduleNext, deliver = null, quiet = null, now = () => new Date(), rng = Math.random,
}) => async job => {
    const row = getCharacter(db, job.charId);
    if (!row) return { skipped: 'unknown_character' };
    const character = toCharacter(row);

    // 代次不符 = 阿萌期间关过心跳或改过频率，这条是旧链上的残留，直接结束且不续排。
    if (job.generation !== null && job.generation !== character.heartbeatGeneration) {
        return { cancelled: 'stale_generation' };
    }
    if (!character.heartbeatEnabled) return { cancelled: 'disabled' };

    scheduleNext(character, now());

    const snapshot = getSnapshot(db, character.charId);
    const gate = checkGates(db, { character, snapshot, now: now() });
    if (gate) {
        recordModelRun(db, {
            jobUuid: job.uuid,
            charId: character.charId,
            runtime: character.runtime,
            startedAt: now().toISOString(),
            ok: true,
            outcome: 'skipped',
            skipGate: gate,
            shadow: isShadowMode(db),
        });
        return { skipped: gate };
    }

    const runner = runners[character.runtime];
    const startedAt = now();
    if (!runner) {
        recordModelRun(db, {
            jobUuid: job.uuid,
            charId: character.charId,
            runtime: character.runtime,
            startedAt: startedAt.toISOString(),
            ok: false,
            outcome: 'error',
            error: `没有接入这种大脑：${character.runtime}`,
            shadow: isShadowMode(db),
        });
        return { failed: 'no_runner', runtime: character.runtime };
    }

    const shadow = isShadowMode(db);
    const timezone = snapshot.payload?.timezone || getSetting(db, 'timezone') || 'America/Chicago';
    const lastContact = lastRealInteractionAt(character, snapshot);
    const carried = pendingUrge(db, character.charId, { since: lastContact });
    // 开不开口由程序抽签，不再让模型做判断题——它总能为沉默找到理由（设计 3.3）。
    const { intent } = decideIntent({
        snapshot,
        now: startedAt,
        timezone,
        minutesSinceContact: lastContact ? (startedAt.getTime() - lastContact.getTime()) / 60_000 : null,
        carried,
        rng,
    });
    // 只回看最近 12 小时：更早的那些，今天的聊天多半已经盖过去了。
    const thoughts = recentThoughts(db, character.charId, {
        since: new Date(startedAt.getTime() - 12 * 60 * 60_000),
    });
    // 手头正在推进的事：先把久没动静的收掉，再交给模型接着做。试跑期不动库，只是看看。
    if (!shadow) closeStaleThreads(db, character.charId, startedAt);
    const threads = listOpenThreads(db, character.charId);
    // 这一跳要不要写一段工作往来：同样由程序抽签，抽中了才要求模型写。
    const { wanted: wantsEpisode } = decideEpisode({
        snapshot, now: startedAt, timezone, intent, threads, rng,
    });
    const result = await runner.run({
        charId: character.charId,
        credRef: character.credRef,
        system: buildPrompt(character, snapshot, startedAt, intent, { thoughts, carried, threads, episode: wantsEpisode }),
        user: '现在要做什么？只按 schema 回一个 JSON。',
        schema: HEARTBEAT_SCHEMA,
        timeoutMs: config.heartbeatTimeoutMs,
    });
    const durationMs = now().getTime() - startedAt.getTime();

    if (!result.ok) {
        recordModelRun(db, {
            jobUuid: job.uuid,
            charId: character.charId,
            runtime: character.runtime,
            startedAt: startedAt.toISOString(),
            durationMs,
            ok: false,
            outcome: 'error',
            error: result.error,
            shadow,
            intent,
            rawOutput: shouldCaptureRaw(db) ? result.raw ?? null : null,
        });
        // 心跳 max_attempts=1：这里抛出去就是本次 failed，由已经排好的下一跳接续。
        throw new Error(result.error);
    }

    const output = result.output;
    // 没被要求写的 episode 一律不收：写不写由程序抽签定，模型自己加戏不算数。
    const episode = wantsEpisode ? output.episode ?? null : null;
    recordModelRun(db, {
        jobUuid: job.uuid,
        charId: character.charId,
        runtime: character.runtime,
        startedAt: startedAt.toISOString(),
        durationMs,
        ok: true,
        outcome: output.action,
        reason: output.reason,
        // activity 是「这次醒来我做了什么」，起居注列的就是它。
        activity: output.activity,
        proposedText: output.action === 'message' ? output.text : null,
        shadow,
        // 抽中了开口、模型却退回 noop 的次数值得盯：多了说明提示词还是在劝它闭嘴。
        intent,
        // 开了口就不再欠着；没开口的「等会儿」留给下一跳兑现。
        urge: output.action === 'message' ? 'none' : output.urge,
        episode,
    });

    // 影子期到此为止：不写 outbox、不推送、不执行工具（设计 4.3 第 9 步）。
    if (shadow || !deliver) {
        return { ok: true, shadow, intent, action: output.action, activity: output.activity, durationMs };
    }

    // 工作往来：先记「正在推进的事」，再送去手机。静默送达（notify:false）：
    // 这是给阿萌翻的记录，不是来打扰她的消息。messageId 以任务 uuid 为幂等键。
    let workDelivered = false;
    if (episode) {
        const thread = episode.thread ? applyThread(db, character.charId, episode.thread, startedAt) : null;
        const { thread: _draft, ...rest } = episode;
        await deliver({
            messageId: `hb:${job.uuid}:work`,
            charId: character.charId,
            jobUuid: job.uuid,
            kind: 'job_result',
            notify: false,
            payload: {
                type: 'work_episode',
                createdAt: startedAt.toISOString(),
                activity: output.activity,
                episode: rest,
                thread,
            },
        });
        workDelivered = true;
    }
    if (output.action !== 'message') {
        return { ok: true, shadow, intent, action: output.action, activity: output.activity, workDelivered, durationMs };
    }

    // 真实执行（1d）：落信箱 + 推送。messageId 以任务 uuid 为幂等键——
    // 同一跳重试或对账补记都不会变成两条消息。
    const createdAt = now();
    await deliver({
        messageId: `hb:${job.uuid}`,
        charId: character.charId,
        jobUuid: job.uuid,
        kind: 'chat_message',
        title: character.displayName,
        body: output.text,
        payload: {
            text: output.text,
            source: 'heartbeat',
            createdAt: createdAt.toISOString(),
            // 过了保质期就不再当「刚说的话」送进聊天（设计 4.3.1），由前端据此分流。
            staleAfter: new Date(createdAt.getTime() + MESSAGE_STALE_AFTER_MS).toISOString(),
        },
    });
    return { ok: true, shadow: false, intent, action: 'message', activity: output.activity, delivered: true, workDelivered, durationMs };
};
