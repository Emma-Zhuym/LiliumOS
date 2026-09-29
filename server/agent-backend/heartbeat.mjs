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
import {
    SHORT_ID_LENGTH, applyThread, closePassedPlans, closeStaleThreads, completeThread, isPlanDue, isPlanThread, listOpenThreads,
} from './lifeThreads.mjs';
import { parsePlanTime } from './planTime.mjs';
import {
    SHIP_KINDS, SHOPPING_KINDS, formatEtaForPrompt, formatPurchasesForPrompt, formatShipOptions, pickEtas, recentPurchases, withEta,
} from './shopping.mjs';
import {
    applyXhsActions, fetchDetail, fetchFeed, formatDetailForPrompt, formatFeedForPrompt, resolvePicks, resolveShare, XHS_MAX_PICKS,
} from './xhsFeed.mjs';
import {
    MOMENTS_MAX_PER_BEAT, formatMomentsForPrompt, markMomentsSeen, resolveMomentReactions, unseenMoments,
} from './moments.mjs';
import { formatTemporalForPrompt, listTemporalItems, readVisibility, veilForCharacter } from './temporal.mjs';

/** 心跳最晚执行时间：过了就 expired，mini 睡醒后不会补跑一堆旧心跳（设计 4.1）。 */
export const HEARTBEAT_TTL_MS = 15 * 60 * 1000;
/**
 * 「刚聊过」的判定窗口：这段时间里醒来照样过自己的日子，只是不主动开口。
 * 原来是 20 分钟、而且整跳不动脑；阿萌觉得 20 分钟后再来一句并不离谱，醒了也可以做别的（2026-09-24）。
 */
export const ACTIVE_CHAT_WINDOW_MS = 10 * 60 * 1000;
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

const dateKey = (date, timezone) => {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'America/Chicago' }).format(date);
    } catch {
        return date.toISOString().slice(0, 10);
    }
};

/**
 * 快照里的「今天的安排」只在拼快照的那一天有效。
 *
 * 快照只在阿萌发消息 / 打开 App 时更新：一整天没动静，手里那份就还是昨天的，
 * 不丢掉的话 TA 会照着昨天的时间表判断现在忙不忙、该上班还是在家。
 * 按角色时区比日期；不是今天的就当没有日程（权重按「不知道在忙什么」算），别的字段照旧。
 */
export const withTodaySchedule = (snapshot, now = new Date()) => {
    if (!snapshot?.payload?.todaySchedule) return snapshot;
    const built = Date.parse(snapshot.builtAt);
    const timezone = snapshot.payload.timezone;
    if (Number.isFinite(built) && dateKey(new Date(built), timezone) === dateKey(now, timezone)) return snapshot;
    const { todaySchedule: _stale, ...payload } = snapshot.payload;
    return { ...snapshot, payload };
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

/**
 * 上一条真发出去的消息的时刻（主动消息 + 即时回复），用来算冷却、判断「TA 回过没有」。
 * 影子期没有真消息，冷却自然不会命中。
 */
const lastChatMessageAt = (db, charId) =>
    db.prepare(
        `SELECT created_at FROM outbox
          WHERE char_id = ? AND kind IN ('chat_message', 'chat_reply')
          ORDER BY id DESC LIMIT 1`,
    ).get(charId)?.created_at ?? null;

/**
 * 阿萌发了、TA 还没回的那几条（按时间正序）。
 *
 * 阿萌睡前发了消息没点生成，TA 醒来得先读到它们——以前心跳完全不看这个，
 * 醒来照样抽签，六成去过自己的日子，抽中开口也是接着自己的事另起话头。
 *
 * 「TA 回过」要看两处：快照里 TA 的消息（聊天里生成的），和 outbox 里心跳已经发出的那条
 * （快照要等阿萌下次发消息才更新，不看 outbox 的话同一批会被回两遍）。
 */
export const unreadFromUser = (db, charId, snapshot) => {
    const messages = snapshot?.payload?.recentMessages;
    if (!Array.isArray(messages) || messages.length === 0) return [];
    let lastChar = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role !== 'user') { lastChar = index; break; }
    }
    const tail = messages.slice(lastChar + 1);
    if (!tail.length) return [];
    const repliedAt = [snapshot.payload?.lastInteraction?.charAt, lastChatMessageAt(db, charId)]
        .map(value => (value ? Date.parse(value) : NaN))
        .filter(Number.isFinite);
    const since = repliedAt.length ? Math.max(...repliedAt) : -Infinity;
    // 没带时间的消息没法跟 outbox 比先后：TA 从没回过才算没读，否则宁可当读过，别重复回。
    return tail.filter(message => {
        const at = message.at ? Date.parse(message.at) : NaN;
        return Number.isFinite(at) ? at > since : since === -Infinity;
    });
};

/**
 * 阿萌最后一次说话之后，TA 主动发出去、还没等到回音的那几条（按时间正序）。
 *
 * 真人连发两三条没回就不再追了；心跳以前看不到这个，照样按概率开口，
 * 于是一天里「到家了吗」「你人呢」「上次那条好像发送失败了」一条接一条。
 */
export const unansweredProactive = (db, charId, since) => db.prepare(
    `SELECT created_at, payload FROM outbox
      WHERE char_id = ? AND kind = 'chat_message' AND created_at > ?
      ORDER BY id ASC`,
).all(charId, since ? since.toISOString() : '1970-01-01T00:00:00.000Z').map(row => {
    let text = '';
    try { text = String(JSON.parse(row.payload)?.text ?? ''); } catch { /* 坏了就当空 */ }
    return { at: row.created_at, text };
});

/** 阿萌最后一次真的开口的时刻：快照里的 userAt（夹到 received_at）和在场信号取大。TA 自己说的不算。 */
export const lastUserSpokeAt = (character, snapshot) => {
    const candidates = [];
    if (character.lastUserInteractionAt) candidates.push(Date.parse(character.lastUserInteractionAt));
    const raw = snapshot?.payload?.lastInteraction?.userAt;
    if (raw) {
        const receivedAt = Date.parse(snapshot.receivedAt);
        const parsed = Date.parse(raw);
        if (Number.isFinite(parsed)) candidates.push(Number.isFinite(receivedAt) ? Math.min(parsed, receivedAt) : parsed);
    }
    const valid = candidates.filter(Number.isFinite);
    return valid.length ? new Date(Math.max(...valid)) : null;
};

/** 连发了几条没回，开口的概率打几折：一条没回照常，两条减半，三条起就不再主动找了。 */
export const UNANSWERED_BACKOFF = [1, 1, 0.4, 0];
export const unansweredFactor = count => UNANSWERED_BACKOFF[Math.min(count, UNANSWERED_BACKOFF.length - 1)];

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

    if (modelRunsToday(db, character.charId, now, timezone) >= character.dailyModelBudget) {
        return 'daily_budget';
    }
    return null;
};

/**
 * 「这一跳不开口」的两个原因。和上面的闸不同，命中了**照样醒、照样动脑**，
 * 只是不主动找阿萌——工作往来、生活小事照常写，TA 还是在过自己的日子。
 *
 * - active_chat：10 分钟内聊过（任意一方说过话），人就在跟前，不必另起话头；
 * - message_cooldown：离上一条主动消息太近（空档里缩到 30 分钟）。欠着阿萌的回复时不算：
 *   冷却是为了别刷屏，阿萌在那之后又发了话，回她不叫刷屏。
 */
export const speakBlock = (db, { character, snapshot, now = new Date(), owed = false }) => {
    const timezone = snapshot?.payload?.timezone || getSetting(db, 'timezone') || 'America/Chicago';
    const lastInteraction = lastRealInteractionAt(character, snapshot);
    if (lastInteraction && now.getTime() - lastInteraction.getTime() < ACTIVE_CHAT_WINDOW_MS) {
        return 'active_chat';
    }
    if (owed) return null;
    // 空档里冷却缩短：午休本来就是多说两句的时候，不该被上午那条挡住。
    const cooldownMin = inBreakWindow(snapshot, now, timezone)
        ? Math.min(character.messageCooldownMin, BREAK_COOLDOWN_MIN)
        : character.messageCooldownMin;
    const lastMessage = lastChatMessageAt(db, character.charId);
    if (lastMessage && now.getTime() - Date.parse(lastMessage) < cooldownMin * MINUTE) {
        return 'message_cooldown';
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
    // 阿萌定的比例（2026-09-24）：有空的时候醒来约 40% 会找她，其余的跳过自己的日子（工作往来 / 生活小事）。
    // 忙的时候少一些但不是不找；睡着几乎不找（真正拦截由 sleeping 闸做）。
    const base = inBreak ? 0.5
        : availability === 'busy' ? 0.15
            : availability === 'offline' ? 0.02
                : 0.4;
    const hours = (minutesSinceContact ?? 0) / 60;
    // 只做温和的调整，不再大起大落：刚聊完稍低，很久没说话稍高。空档里不罚「刚说过话」。
    const gapBoost = hours >= 6 ? 1.4 : hours >= 3 ? 1.2 : hours >= 1 || inBreak ? 1 : 0.75;
    // 封顶 0.6：再高就成了「每隔两跳必找你一次」，那是另一种不自然。
    return Math.min(0.6, Math.max(0, base * gapBoost));
};

/**
 * 决定这一跳的意图。reach_out = 去说句话；live = 过自己的日子。
 * rng 可注入，测试里钉死。
 */
export const decideIntent = ({
    snapshot, now, timezone, minutesSinceContact, carried = null, canSpeak = true, owed = false, unanswered = 0, rng = Math.random,
}) => {
    const slot = currentSlot(snapshot, now, timezone);
    const availability = slot?.availability ?? null;
    // 阿萌发了消息 TA 还没回：醒来第一件事是读消息、回她，不抽签（随机数照样取一个，保持序列不变）。
    if (owed && canSpeak) {
        rng();
        return {
            intent: 'reply',
            chance: 1,
            slot: slot ? { title: slot.title ?? slot.activity ?? '', availability } : null,
            inBreak: inBreakWindow(snapshot, now, timezone),
        };
    }
    // 上一跳自己说了「等会儿找 ta」：这一跳不再抽签，兑现它。
    // 冷却、每日上限这些闸在抽签之前已经过了，所以不会因此刷屏。
    const inBreak = inBreakWindow(snapshot, now, timezone);
    // 这一跳不能开口时照样抽一次（保持随机序列不变），只是概率为 0；欠着的「等会儿」留到下一跳。
    // 连发了没回：欠着的「等会儿」也不再强行兑现，概率照样打折（三条起为 0）。
    const backoff = unansweredFactor(unanswered);
    const chance = !canSpeak ? 0
        : carried && unanswered < 2 ? 1
            : messageChance({ availability, minutesSinceContact, inBreak }) * backoff;
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
    const base = workish ? 0.8 : 0.15;
    return Math.min(0.85, base + (workish && hasThreads ? 0.05 : 0));
};

/**
 * 私人生活里的小事：下班后、周末写得多，上班时偶尔（比如午饭点个外卖）。
 * 和工作往来共用一次抽签：先看落不落在工作那一截，再看落不落在生活那一截，其余这一跳什么都不写。
 */
// 不找阿萌的那些跳基本都要有点自己的事：上班时几乎全是工作，下班后几乎全是生活。
export const lifeChance = ({ workish }) => (workish ? 0.15 : 0.85);

export const decideEpisode = ({ snapshot, now, timezone, intent, threads = [], rng = Math.random }) => {
    if (intent !== 'live') return { kind: null, wanted: false, chance: 0, lifeChance: 0 };
    const slot = currentSlot(snapshot, now, timezone);
    if (slot?.availability === 'offline') return { kind: null, wanted: false, chance: 0, lifeChance: 0 };
    const workish = isWorkSlot(slot);
    const chance = episodeChance({ workish, hasThreads: threads.length > 0 });
    const life = lifeChance({ workish });
    const roll = rng();
    const kind = roll < chance ? 'work' : roll < chance + life ? 'life' : null;
    return { kind, wanted: kind === 'work', chance, lifeChance: life };
};

/**
 * 生活里具体做哪件事，也由程序定：让模型自己挑，它会一直挑同一种（多半是找人聊天）。
 *
 * 购物（delivery + order + gift）两行都压在 20%（2026-09-26）：原来饭点外卖 0.35，
 * 算下来一个角色一晚上约 0.9 次外卖，几个角色一起跑就天天在买东西、饭后还点外卖。
 * 饭点仍然外卖偏多、非饭点仍然网购偏多，只是整体让位给聊天 / 社交 / 朋友圈。
 *
 * 逛小红书（xhs）从朋友圈那一份里分出 0.08（2026-09-26）：原来一发就是一条朋友圈，
 * 现在有时只是刷刷首页。刷不到（服务没起来、角色没开小红书）就退回朋友圈，所以合起来不变。
 */
export const MEALTIME_LIFE_WEIGHTS = [
    ['chat', 0.42], ['social', 0.16], ['delivery', 0.13], ['order', 0.04], ['gift', 0.03], ['moment', 0.14], ['xhs', 0.08],
];
export const OTHER_LIFE_WEIGHTS = [
    ['chat', 0.40], ['social', 0.17], ['delivery', 0.04], ['order', 0.12], ['gift', 0.04], ['moment', 0.15], ['xhs', 0.08],
];
export const isMealtime = minutesOfDay =>
    (minutesOfDay >= 11 * 60 && minutesOfDay < 13 * 60 + 30) || (minutesOfDay >= 17 * 60 && minutesOfDay < 20 * 60 + 30);

export const pickLifeKind = (minutesOfDay, rng = Math.random) => {
    // gift = 给阿萌买点东西（网购或外卖，TA 自己定要不要当惊喜）；少见才珍贵
    // social = 跟朋友当场有点来往：临时出门（少见），或临时约好上线打游戏
    // xhs = 刷会儿小红书首页（真实首页，程序先刷好再交给模型）
    const weights = isMealtime(minutesOfDay) ? MEALTIME_LIFE_WEIGHTS : OTHER_LIFE_WEIGHTS;
    // 按千分位累加再比：浮点一路相减，分档边界（0.42 / 0.58 …）会差一个 ε 落错档
    const roll = rng() * 1000;
    let edge = 0;
    for (const [kind, weight] of weights) {
        edge += Math.round(weight * 1000);
        if (roll < edge) return kind;
    }
    return 'chat';
};

export const localMinutesOf = (date, timezone) => localMinutes(date, timezone);

/**
 * 逛小红书的结果：模型写的编号换回真实笔记（标题、作者、赞数用首页的真值），
 * 再附上整页首页，前端小红书 App 的「看过的帖子」照这个列。没刷成首页的 xhs 整条不要。
 */
/** 首页笔记 → 聊天里小红书卡片要的形状（MessageItem 读 metadata.xhsNote）。 */
export const toCardNote = note => ({
    noteId: note.noteId,
    title: note.title,
    desc: '',
    author: note.author || '',
    authorId: '',
    likes: note.likes || 0,
    ...(note.xsecToken ? { xsecToken: note.xsecToken } : {}),
    ...(note.coverUrl ? { coverUrl: note.coverUrl } : {}),
    type: note.video ? 'video' : 'normal',
});

export const withXhsFeed = (life, feed = []) => {
    if (!life || life.kind !== 'xhs') return life;
    if (!feed.length || !life.detail) return null;
    const { picks, share, ...rest } = life;
    const resolved = resolvePicks(picks, feed);
    const sharing = resolveShare(share, feed);
    return { ...rest, feed, ...(resolved.length ? { picks: resolved } : {}), ...(sharing ? { share: sharing } : {}) };
};

/**
 * 给 life 里的 plan 定时间：模型写的是「周六下午」，这里按时区解析成绝对时刻（dueAt）。
 * 解析不了就把 plan 整条丢掉，life 其余部分照常——跟 episode 写坏了只丢那一段同一个原则。
 */
export const withPlanTime = (life, now, timezone) => {
    if (!life?.plan) return life;
    const { plan, ...rest } = life;
    const dueAt = parsePlanTime(plan.at, now, timezone);
    return dueAt ? { ...rest, plan: { ...plan, dueAt: dueAt.toISOString() } } : rest;
};

/**
 * 惊喜礼物：起居注和试跑记录里不能写出买了什么。
 *
 * 「查手机 → 起居注」是阿萌在翻，`activity` 和 `reason` 原样写进去，惊喜当场就穿帮了。
 * 所以落审计时换成不点破的说法；**买了什么原样留在 `episode.life` 里**（排查看得到），
 * 真正的那一单也照常进投喂站，送到了自然揭晓。
 */
export const veilSurprise = (output, life, userName) => {
    if (!life || life.kind !== 'gift' || !life.surprise) return { activity: output.activity, reason: output.reason };
    const who = userName || '对方';
    return { activity: `给${who}准备了点东西`, reason: `想给 ${who} 一个惊喜，先不说是什么。` };
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
        // 私人生活里的一件小事：只有程序抽中「这一跳在过私人生活」时才会要求写，见 decideEpisode。
        life: {
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: {
                kind: { type: 'string', enum: ['chat', 'social', 'delivery', 'order', 'moment', 'gift', 'xhs'] },
                with: { type: 'string', maxLength: 40 },
                relation: { type: 'string', maxLength: 20 },
                group: { type: 'string', enum: ['friend', 'family', 'school', 'online', 'other'] },
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
                detail: { type: 'string', maxLength: 400 },
                value: { type: 'string', maxLength: 20 },
                via: { type: 'string', enum: ['net', 'food'] },
                // 网购选哪种配送（当天达 / 次日达 / 普通快递）；几点到由程序定
                ship: { type: 'string', enum: SHIP_KINDS },
                surprise: { type: 'boolean' },
                note: { type: 'string', maxLength: 120 },
                // moment：亲友评论、虚拟赞数、不给哪些分组看
                comments: {
                    type: 'array',
                    maxItems: 5,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['who', 'text'],
                        properties: { who: { type: 'string', maxLength: 24 }, relation: { type: 'string', maxLength: 12 }, text: { type: 'string', maxLength: 200 } },
                    },
                },
                likes: { type: 'integer', minimum: 0, maximum: 999 },
                hide: { type: 'array', items: { type: 'string', enum: ['family', 'friend', 'work', 'school', 'service', 'online', 'other'] } },
                // xhs：刷首页时多看了两眼的几条，index 是首页列表里的编号，note 是为什么停下来看；
                // like / fav 是想点赞 / 收藏（程序去做，最多两次）
                picks: {
                    type: 'array',
                    maxItems: XHS_MAX_PICKS,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['index'],
                        properties: {
                            index: { type: 'integer', minimum: 1, maximum: 20 },
                            note: { type: 'string', maxLength: 120 },
                            like: { type: 'boolean' },
                            fav: { type: 'boolean' },
                        },
                    },
                },
                // xhs：刷到想给对方看的，转发一条 + 配一两句话。不想发就省略。
                share: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['index', 'text'],
                    properties: {
                        index: { type: 'integer', minimum: 1, maximum: 20 },
                        text: { type: 'string', maxLength: 200 },
                    },
                },
                // chat / social：顺口约了以后的事。时间写自然语言，由程序解析成绝对时刻（planTime.mjs）。
                plan: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['what', 'at'],
                    properties: {
                        what: { type: 'string', maxLength: 40 },
                        at: { type: 'string', maxLength: 40 },
                    },
                },
            },
        },
        // 刷到阿萌的新朋友圈：只有提示词里列了动态才会要求写。index 是列表里的编号。
        moments: {
            type: 'array',
            maxItems: MOMENTS_MAX_PER_BEAT,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['index'],
                properties: {
                    index: { type: 'integer', minimum: 1, maximum: MOMENTS_MAX_PER_BEAT },
                    like: { type: 'boolean' },
                    comment: { type: 'string', maxLength: 200 },
                },
            },
        },
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
    thoughts = [], carried = null, threads = [], plans = [], duePlan = null, episode = false, life = null, canSpeak = true, temporal = '',
    feed = [], opened = null, etas = null, purchases = [], unread = [], moments = [], unanswered = [], userTimezone = null,
} = {}) => {
    const p = snapshot.payload || {};
    const lines = [];
    lines.push(`你是「${p.identity?.name || character.displayName}」，正在自己的生活里过日子。`);
    if (p.identity?.persona) lines.push(`你的设定：\n${p.identity.persona}`);
    // 长期记忆：聊天那边的月度总结。没有它，TA 醒来时对你们之间的事只记得最近几十句。
    if (Array.isArray(p.monthlySummaries) && p.monthlySummaries.length) {
        lines.push(
            '你们之间的长期记忆（按月总结，这些都是真实发生过的）：\n'
            + p.monthlySummaries.map(m => `- [${m.month}] ${m.text}`).join('\n'),
        );
    }
    lines.push(`对方是「${p.user?.name || '阿萌'}」。现在是 ${formatLocal(now, p.timezone)}（${p.timezone || '未知时区'}）。`);
    // 两人不在一个时区时，TA 得知道对方那边几点：不然对方下午两点半，TA 问「睡了没」。
    if (userTimezone && userTimezone !== p.timezone) {
        lines.push(`对方那边现在是 ${formatLocal(now, userTimezone)}（${userTimezone}）。问候、问 ta 睡没睡、在不在上课，都按 ta 那边的时间来。`);
    }
    if (p.sleepWindow) lines.push(`你的作息：${p.sleepWindow.start} 睡，${p.sleepWindow.end} 起。`);
    // 情绪底色：聊天那边每轮情绪评估写出来的叙事。缺了它，心跳里的 TA 永远是出厂情绪。
    if (p.mood) lines.push(`你此刻的情绪底色：\n${p.mood}`);
    // 日常节律：跟聊天日程生成用的是同一份自由文本。没有它，心跳完全不知道 TA 平时在哪、忙什么。
    if (p.dailyRhythm) lines.push(`你平时的生活节律（稳定的框架，不是今天必须逐字照做）：\n${p.dailyRhythm}`);
    // 阿萌的现实安排（她勾选可见的那几个 Apple 日历 / 提醒清单）。
    if (temporal) lines.push(temporal);
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
            + formatRecentMessages(p.recentMessages, p.timezone),
        );
    }
    if (unread.length) {
        // 最后几句是对方说的、你还没回：跟下面那段「对方没回你」正好反过来，别混用。
        const since = formatGap(new Date(unread[0].at ?? now), now);
        lines.push(
            `对方给你发了这些消息，你还没有回（最早一条是${since || '刚才'}发的）：\n`
            + unread.map(m => `- ${m.at ? `${formatLocal(new Date(m.at), p.timezone)} ` : ''}${m.text}`).join('\n')
            + '\n从 ta 发这些消息到现在，你们没有说过话：ta 在等你回。',
        );
    } else if (Array.isArray(p.recentMessages) && p.recentMessages.length) {
        // 只给间隔还不够：模型会拿这段空白自己补剧情，把「她应该洗完了」一路脑补成
        // 「我已经帮她吹完头发了」，然后据此判断「人就在身边，没必要发消息」。
        // 原来这里写死「什么互动都没发生」，结果连 TA 自己的日子也冻住了——说了「我做饭，你来一起吃」，
        // 六七个小时后还是「你不来我就还没做饭」（2026-09-26）。开不开口现在是程序抽的，
        // 那条限制的原始理由已经过期了大半，所以三类分开说：要对方赴约的没发生；自己的日常照常走；
        // 同居的日常同处可能有过。最后一句专堵「所以没必要找 ta」这个漏口。
        lines.push(
            '重要：从上次在聊天里说话到现在，对方没有回你消息。\n'
            + '- 需要对方特意赴约的事一件都没发生（约好出门、约好视频、说好一起做的某件事），'
            + '别把它们当成已经做完了。\n'
            + '- 你自己的日常照常往前走：该做饭就做了，该吃饭就吃了，该睡就睡了。'
            + '对方没回消息不会让你的一天停在原地。叫过对方一起吃而 ta 没出现，那就是你自己吃了。\n'
            + '- 如果你们本来就住在一起，那么日常的同处——一起吃了饭、擦肩而过、各忙各的——'
            + '当然可能发生过，不必当成没有。\n'
            + '无论这段时间你们碰没碰面，都不构成「所以现在没必要找 ta」的理由。'
            + '住在一起的人照样一天发很多条消息：在另一个房间、ta 在洗澡、上班路上，或者只是想说一句。',
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
    // 约好的事：还没到点的只是记着（也是天然的话头）；到点的那件，这一跳就是在做它。
    const upcoming = plans.filter(t => t.id !== duePlan?.id);
    if (upcoming.length) {
        lines.push(
            '你跟别人约好、还没到时间的事（对方并不知道，除非你说起）：\n'
            + upcoming.map(t => `- ${t.title}${t.summary ? `，${t.summary}` : ''}（${formatLocal(new Date(t.dueAt), p.timezone)}）`).join('\n'),
        );
    }
    if (duePlan) {
        lines.push(
            `现在就是你约好的时间：「${duePlan.title}」${duePlan.summary ? `（${duePlan.summary}）` : ''}。`
            + '这一跳你正在做这件事（或者正要出发 / 刚开始），activity 就写它，写现在时。',
        );
    }
    // 阿萌发了新朋友圈：TA 这会儿拿起手机刷到了。回不回应、怎么回应由 TA 定，写在 moments 里。
    if (moments.length) {
        const userName = p.user?.name || '对方';
        lines.push(
            `你刚刷了一下朋友圈，看到${userName}新发的动态：\n`
            + formatMomentsForPrompt(moments, { userName, formatTime: at => formatLocal(new Date(at), p.timezone) })
            + '\n在 moments 里写你的反应：index 填上面的编号；想点赞 like 填 true；想评论就写 comment'
            + '（一两句以内，像真人在朋友圈底下说话，贴着你们的关系和最近的聊天；别复述 ta 写了什么）。'
            + '没什么想回应的就不写那一条。这跟你这一跳在做的事可以同时发生。',
        );
    }
    // 开不开口已经定了，模型不再做判断题，只负责把它说得像这个人会说的话。
    lines.push(
        intent === 'reply'
            ? '现在你拿起手机，看到了 ta 发来的这些消息，要回 ta。\n'
                + '规则：activity 里用第一人称写你这会儿在做什么（40 字以内）；action 填 "message"，text 写你回 ta 的话。\n'
                + '- 先回应 ta 说的内容：ta 问了就答，ta 分享了就接住，ta 情绪不好就先顾着 ta。别当没看见，也别另起一个无关的话头。\n'
                + '- 消息是一段时间以前发的，回的时候要意识到时间过去了（比如 ta 睡前说的晚安，现在你这边已经是早上）；'
                + '可以顺带说一句你这边刚在做什么、为什么现在才回，但只是顺带。\n'
                + '- ta 发了好几条就一起回，不用逐条编号。\n'
                + 'reason 写你心里的想法，对方看不到它。urge 填 "none"。'
            : intent === 'reach_out'
            ? '现在你想起了对方，并且决定跟 ta 说句话。\n'
                + '规则：activity 里用第一人称写你这会儿在做什么（40 字以内）；'
                + 'action 填 "message"，text 写你要说的那句话——'
                + '要贴着你此刻正在做的事和你们之间还没了结的话头，别写成万能问候。'
                // 约定是天然的话头：「周六要去看展」正是能自然说起的事，别让它从 noop 的口子漏掉
                + (plans.length ? '你跟别人约好的事也是很自然的话头（比如跟 ta 说一声你周末要去做什么）。' : '')
                + '真的想不出任何自然的话头时才退回 action="noop"，那说明这一刻确实不合适。'
                + reachOutTimeRule(lastRealInteractionAt(character, snapshot), now)
                + (unanswered.length
                    ? `\n你之前主动发给 ta 的这些，ta 还没回：\n${unanswered.map(u => `- ${formatLocal(new Date(u.at), p.timezone)}：${u.text}`).join('\n')}\n`
                        + 'ta 多半在忙（上课、开会、路上、睡觉），不是没收到，也不是消息发送失败。'
                        + '这次别追问 ta 去哪了、在不在、收没收到、回不回，也别把上面问过的再问一遍；'
                        + '说一件你自己这边新发生的事，或者一句不需要 ta 回的话。'
                    : '')
                + 'reason 写你心里的想法，对方看不到它。urge 填 "none"。'
            : '现在你自己醒了一下，过你自己的日子。\n'
                + '规则：activity 里用第一人称写你这会儿在做什么（40 字以内），'
                + '贴着你当下的时段——在上班就是工作里的事，闲着就是闲着的事。'
                + (canSpeak
                    ? '一般 action 填 "noop"；但如果你心里正放不下 ta、此刻就想说（比如 ta 刚才在难过），'
                        + '那就别等：action 填 "message"，text 写你要说的话。'
                    : '你们刚说过话，这一跳 action 只能填 "noop"；心里想说的话先留着，想过一阵再说就把 urge 填 "later"。')
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
    // 抽中了「这一跳在过自己的私人生活」：做什么也是程序定的，模型只管写得像这个人。
    if (life && intent !== 'reach_out') {
        const circle = (Array.isArray(p.circle) ? p.circle : []).slice(0, 12);
        const known = circle.length
            ? `你私人生活里认识的人：${circle.map(c => `${c.name}${c.relation ? `（${c.relation}）` : ''}`).join('、')}。\n`
            : '';
        // 发朋友圈时同事也会来评论；分组给模型看，它才知道「屏蔽家人」屏蔽的是谁
        const coworkers = (Array.isArray(p.coworkers) ? p.coworkers : []).slice(0, 6);
        const momentCircle = life === 'moment' && (circle.length || coworkers.length)
            ? `能来评论的人（括号里是关系，方括号是分组）：${[...circle, ...coworkers].map(c => `${c.name}${c.relation ? `（${c.relation}）` : ''}[${c.group ?? 'other'}]`).join('、')}。\n`
            : '';
        const foodWhen = () => formatEtaForPrompt(etas.food, now, p.timezone);
        const shipHow = () => formatShipOptions(etas, now, p.timezone);
        const bought = purchases.length && SHOPPING_KINDS.has(life)
            ? `${formatPurchasesForPrompt(purchases, now, p.timezone, p.user?.name || '对方')}\n`
            : '';
        const how = {
            chat: '你刚和一位朋友、家人或老同学聊了几句。kind 填 "chat"；with 写对方的名字，'
                + (circle.length ? '优先从上面认识的人里选；' : '')
                + '是新出现的人就再写 relation（你怎么称呼 ta，比如「发小」「表姐」）和 group'
                + '（friend=朋友 / family=家人 / school=同学 / online=网友 / other=其他）。'
                + 'lines 最多 6 句，who 写说话人的名字，你自己写「我」。聊的是你们之间的事，不是对方。'
                + PLAN_HOW,
            social: '你刚跟朋友有点来往。kind 填 "social"；with 写对方名字'
                + (circle.length ? '（优先从上面认识的人里选，' : '（')
                + '新人再写 relation 和 group）；'
                + 'detail 写你们做了什么——可以是临时出门（少见，得跟你此刻的时段和人设对得上），'
                + '也可以是不用出门的（比如临时约好一起上线打游戏、开着语音各干各的）。'
                + '当场就发生的事写现在时，别写成计划。lines 写约人或者当时说的那几句（最多 6 句，who 写说话人的名字，你自己写「我」）。'
                + PLAN_HOW,
            delivery: '你刚点了外卖。kind 填 "delivery"；with 写店名，detail 写点了什么，value 写实付金额，用你所在地的货币（在美国就是 $18.50 这样，在国内就是 ¥38.50）。'
                + (etas ? `这一单${foodWhen()}送到，提到送达就说这个时间，别自己编。` : ''),
            order: '你刚在网上下了一单。kind 填 "order"；with 写商品名，detail 写规格，value 写价格（用你所在地的货币）。'
                + (etas ? shipHow() : ''),
            moment: '你刚发了一条朋友圈。kind 填 "moment"；detail 写正文。'
                + '再替你通讯录里的亲友写下反应：comments 写 3–5 条评论（who 用上面认识的人的名字，relation 写 TA 是你的谁，语气贴着各自身份）；'
                + 'likes 写点赞数（按你的人缘，一般 5–60）；不想给某些人看就在 hide 里写分组（family / friend / work / school / online / other），被屏蔽的人不能出现在评论里，不屏蔽就省略。',
            xhs: '你刚刷了一会儿小红书首页，下面是你真的刷到的（按顺序）：\n'
                + `${formatFeedForPrompt(feed)}\n`
                + 'kind 填 "xhs"；detail 写你刷的时候心里的反应（第一人称，2–4 句，像自言自语，贴着你的人设和此刻的心情）；'
                + `picks 写你多看了两眼的（最多 ${XHS_MAX_PICKS} 条，一条都不感兴趣就留空）：index 填上面的编号，note 写你为什么停下来看；`
                + '真喜欢的 like 填 true（点赞），想留着以后再看的 fav 填 true（收藏），不用每条都点。'
                + (canSpeak
                    ? `刷到特别想给${p.user?.name || '对方'}看的，可以转发一条给 ta：share 里 index 填编号，text 写一两句你转发时会说的话（像随手丢过去那样，别写成推荐语）；`
                        + '没有想给 ta 看的就省略 share，不是每次都要发。'
                    : '你们刚说过话，这次先别转发给 ta，省略 share。')
                + '只能从上面这些里挑，别编列表里没有的笔记；不评论、不发帖、不搜索。'
                + (opened
                    ? `\n\n${formatDetailForPrompt(opened.index, opened.note, opened.detail)}\n`
                        + '看完之后再写这一跳：detail 要写到你点开看到的东西（正文、评论区里戳到你的那句），'
                        + '别复述，写你的反应；picks / like / fav / share 按你看完之后的想法重新决定。'
                    : ''),
            gift: '你刚给对方买了点东西。kind 填 "gift"；via 填 "net"（网购）或 "food"（给对方点外卖）；'
                + (etas ? `点外卖的话${foodWhen()}到；网购的话${shipHow()}` : '')
                + 'with 写商品名或店名，detail 写买了什么、为什么挑这个，value 写价格（东西送到对方那边，按对方所在地的货币写）；note 可以写一句附言（对方收到时能看到）。'
                + '想不想让对方提前知道是什么由你定：想当惊喜就把 surprise 设为 true，送到之前对方看不到内容，你也别在聊天里说漏。',
        }[life];
        if (life === 'gift') {
            lines.push(
                '这一跳你想到了对方，顺手给对方买了点东西。在 life 里写这一单：\n'
                + bought
                + `${how}\n`
                + '要贴着你的人设、你们的关系和你此刻的时段，价钱和你的日常消费差不多，不要一出手就是大件。activity 要和这件事对得上。',
            );
            return lines.join('\n\n');
        }
        lines.push(
            '这一跳你在过自己的私人生活，跟对方无关。在 life 里写一件你刚做的小事：\n'
            + known
            + momentCircle
            + bought
            + `${how}\n`
            + (life === 'xhs'
                ? '这是你自己的时间：除了 share 那一句，别的地方不要围着对方转；要贴着你此刻的时段和你的人设。'
                : '这是你自己的时间：不要提到对方，不要围着对方转；要贴着你此刻的时段和你的人设。')
            + '也不要在里面做出会改变人生的大事。activity 要和这件事对得上。',
        );
    }
    return lines.join('\n\n');
};

/** chat / social 共用：顺口约了以后的事就写进 plan，时间用说话的说法，由程序去解析。 */
const PLAN_HOW = '如果你们顺口约了以后的事（明天、周末、下周几），就在 plan 里写：what 写做什么、带上对方的名字'
    + '（比如「和林越去看展」），at 写说好的时间，用平常说话的说法（比如「周六下午」「明晚八点」），不要写日期格式。'
    + '没约就省略 plan。';

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

/**
 * 找 ta 说话时的时间感。
 *
 * 模型会抓着上次聊天的最后一幕不放：隔了三小时还问「吃完没」「碗给我」「人呢」。
 * 超过一小时就明说那一幕已经过去了，要接着上次的话就按现在往后推。
 */
export const reachOutTimeRule = (lastContact, now) => {
    const gap = formatGap(lastContact, now);
    if (!lastContact || now.getTime() - lastContact.getTime() < 60 * 60_000) return '';
    return `\n时间感：你们上次聊天是${gap}，那时的场景（在吃饭、洗碗、洗澡、在路上、正要去做什么）早就结束了。`
        + '别问只在那一刻才成立的事（「吃完没」「到家没」「人呢」「洗完没」）。'
        + '想接着上次的话题，就按现在的时间往后推（上次说要考试，现在就问考得怎么样）。';
};

/**
 * 最近的聊天记录。隔了半小时以上就插一行时间：一百来句跨好几天，
 * 不标时间的话模型会把前天的晚安和今早的早安读成连着说的。
 */
const TIME_MARK_GAP_MS = 30 * 60_000;
export const formatRecentMessages = (messages, timezone) => {
    const out = [];
    let previous = null;
    for (const m of messages) {
        const at = m.at ? Date.parse(m.at) : NaN;
        if (Number.isFinite(at) && (previous === null || at - previous >= TIME_MARK_GAP_MS)) {
            out.push(`〔${formatLocal(new Date(at), timezone)}〕`);
        }
        if (Number.isFinite(at)) previous = at;
        out.push(`${m.role === 'user' ? '对方' : '你'}：${m.text}`);
    }
    return out.join('\n');
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
    db, config, runners, scheduleNext, deliver = null, quiet = null, now = () => new Date(), rng = Math.random, xhs = null,
    chatBusy = () => false,
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

    // 昨天拼的日程不拿来过今天
    const snapshot = withTodaySchedule(getSnapshot(db, character.charId), now());
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
    // 阿萌发了还没回的消息：有的话这一跳先读消息、回她。
    const unread = unreadFromUser(db, character.charId, snapshot);
    // TA 主动发了、阿萌还没回的：连发多了就别再追（概率打折 + 提示词里列出来）。
    const unanswered = unread.length ? [] : unansweredProactive(db, character.charId, lastUserSpokeAt(character, snapshot));
    const userTimezone = snapshot.payload?.userTimezone || getSetting(db, 'timezone') || null;
    // 刚聊过 / 刚发过：这一跳不开口，但照样醒、照样过自己的日子。
    const hush = speakBlock(db, { character, snapshot, now: startedAt, owed: unread.length > 0 })
        // 连发三条没回：这一跳不开口（生活照过），等 ta 回了再说。
        || (unanswered.length >= UNANSWERED_BACKOFF.length - 1 ? 'unanswered' : null)
        // 即时回复正在跑：这一轮就是在回她，心跳别抢着插一句。
        || (chatBusy(character.charId) ? 'chat_turn_running' : null);
    // 开不开口由程序抽签，不再让模型做判断题——它总能为沉默找到理由（设计 3.3）。
    const { intent } = decideIntent({
        snapshot,
        now: startedAt,
        timezone,
        minutesSinceContact: lastContact ? (startedAt.getTime() - lastContact.getTime()) / 60_000 : null,
        carried,
        canSpeak: !hush,
        owed: unread.length > 0,
        unanswered: unanswered.length,
        rng,
    });
    // 只回看最近 12 小时：更早的那些，今天的聊天多半已经盖过去了。
    const thoughts = recentThoughts(db, character.charId, {
        since: new Date(startedAt.getTime() - 12 * 60 * 60_000),
    });
    // 手头正在推进的事：先把久没动静的收掉，再交给模型接着做。试跑期不动库，只是看看。
    if (!shadow) {
        closeStaleThreads(db, character.charId, startedAt);
        closePassedPlans(db, character.charId, startedAt);
    }
    const openThreads = listOpenThreads(db, character.charId);
    // 约定（有时间的）和「正在推进的事」分开：约定不给工作往来抄 id，到点了这一跳就去做它。
    const threads = openThreads.filter(t => !isPlanThread(t));
    const plans = openThreads.filter(isPlanThread);
    const duePlan = plans.find(t => isPlanDue(t, startedAt)) ?? null;
    // 阿萌的现实安排：每天同步一次的缓存，按可见性裁过再进提示词（不调模型、不现读）。
    const temporal = formatTemporalForPrompt(
        veilForCharacter(
            listTemporalItems(db, { from: new Date(startedAt.getTime() - 3600_000).toISOString() }),
            readVisibility(getSetting(db, 'temporal_visibility')),
        ),
        startedAt,
        timezone,
        snapshot.payload?.user?.name || '对方',
    );
    // 这一跳要不要写一段工作往来：同样由程序抽签，抽中了才要求模型写。
    const { kind: sideKind } = decideEpisode({
        snapshot, now: startedAt, timezone, intent, threads, rng,
    });
    // 约定到点了：过自己日子的这一跳就是去赴约，不再抽别的事（抽签照样抽，保持随机序列不变）。
    const pickedLife = sideKind === 'life' ? pickLifeKind(localMinutesOf(startedAt, timezone), rng) : null;
    const wantsEpisode = sideKind === 'work' && !(duePlan && intent === 'live');
    let lifeKind = duePlan && intent === 'live' ? 'social' : pickedLife;
    // 逛小红书：先真的刷一次首页再叫模型。角色没开小红书、服务没起来、没刷到东西，
    // 这一跳就退回发朋友圈（xhs 本来就是从朋友圈那份里分出来的）。
    let feed = [];
    let xhsSkipped = null;
    if (lifeKind === 'xhs') {
        if (snapshot.payload?.xhsEnabled !== true) {
            xhsSkipped = 'xhs_disabled_for_character';
        } else {
            const fetched = await fetchFeed(xhs);
            feed = fetched.notes;
            xhsSkipped = fetched.error ?? null;
        }
        if (!feed.length) lifeKind = 'moment';
    }
    // 买东西：送达时刻由程序先抽好写进提示词，落地时同一个时刻带去投喂站；最近买过的也给 TA 看，别重复下单。
    const shopping = SHOPPING_KINDS.has(lifeKind);
    const etas = shopping ? pickEtas(startedAt, timezone, rng) : null;
    const purchases = shopping ? recentPurchases(db, character.charId, startedAt) : [];
    // 阿萌的新朋友圈：回她消息的那一跳专心回消息，别的跳顺手刷一下。
    const moments = intent === 'reply' ? [] : unseenMoments(db, character.charId, snapshot);
    const promptFor = opened => buildPrompt(character, snapshot, startedAt, intent, {
        thoughts, carried: hush || intent === 'reply' ? null : carried, threads, plans, duePlan, episode: wantsEpisode, life: lifeKind, canSpeak: !hush, temporal, feed, opened,
        etas, purchases, unread: intent === 'reply' ? unread : [], moments,
        unanswered: intent === 'reach_out' ? unanswered : [], userTimezone,
    });
    const firstPass = await runner.run({
        charId: character.charId,
        credRef: character.credRef,
        system: promptFor(null),
        user: '现在要做什么？只按 schema 回一个 JSON。',
        schema: HEARTBEAT_SCHEMA,
        timeoutMs: config.heartbeatTimeoutMs,
    });
    // 逛小红书：多看了两眼的第一条，程序替 TA 点开看正文和评论区，看完再把这一跳重写一遍（第二次调模型）。
    // 点不点由程序定——让模型自己决定「要不要点开」，它多半说算了。点不开、第二次写坏了，都退回第一次的结果。
    let result = firstPass;
    let opened = null;
    if (firstPass.ok && lifeKind === 'xhs') {
        const first = withXhsFeed(firstPass.output?.life ?? null, feed)?.picks?.[0] ?? null;
        const fetched = first ? await fetchDetail(xhs, first) : null;
        if (fetched?.detail) {
            opened = { index: feed.findIndex(note => note.noteId === first.noteId) + 1, note: first, detail: fetched.detail };
            const secondPass = await runner.run({
                charId: character.charId,
                credRef: character.credRef,
                system: promptFor(opened),
                user: '你刚点开看完了。把这一跳写完，只按 schema 回一个 JSON。',
                schema: HEARTBEAT_SCHEMA,
                timeoutMs: config.heartbeatTimeoutMs,
            });
            if (secondPass.ok && secondPass.output?.life?.kind === 'xhs') result = secondPass;
            else opened = null;
        }
    }
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

    // 不能开口的一跳，模型还是写了 message：不发，当成「想说但先留着」，下一跳再兑现。
    const modelOutput = hush && result.output.action === 'message'
        ? { ...result.output, action: 'noop', urge: 'later' }
        : result.output;
    // 没被要求写的 episode 一律不收：写不写由程序抽签定，模型自己加戏不算数。
    const episode = wantsEpisode ? modelOutput.episode ?? null : null;
    // 生活里的聊天对象不能是阿萌本人：那不是「自己的时间」，也会在通讯录里凭空多出一个她。
    const userName = String(snapshot.payload?.user?.name ?? '').trim();
    const rawLife = lifeKind ? withXhsFeed(modelOutput.life ?? null, feed) : null;
    const lifeChecked = withEta(withPlanTime(
        rawLife && !((rawLife.kind === 'chat' || rawLife.kind === 'social') && userName && rawLife.with === userName) ? rawLife : null,
        startedAt,
        timezone,
    ), etas);
    // 点开看过的那条也带上：前端小红书 App 另记一条「查看详情」，跟手动刷新时一样
    const lifeDraft = lifeChecked?.kind === 'xhs' && opened
        ? {
            ...lifeChecked,
            opened: {
                noteId: opened.note.noteId,
                title: opened.detail.fullTitle || opened.note.title,
                author: opened.note.author || '',
                desc: opened.detail.desc.slice(0, 300),
                comments: opened.detail.comments.length,
            },
        }
        : lifeChecked;
    // 逛小红书时转发给阿萌：只有这一跳能开口才发。不能开口的就不发、也不留着——刷到的东西过了就过了。
    const xhsShare = lifeDraft?.kind === 'xhs' && lifeDraft.share && !hush ? lifeDraft.share : null;
    let life = lifeDraft?.kind === 'xhs' && lifeDraft.share && !xhsShare
        ? (({ share: _held, ...rest }) => rest)(lifeDraft)
        : lifeDraft;
    // 转发了就算这一跳开了口：冷却、每日上限照常算。模型另写的那句 message 让位给转发时配的话，只发一条。
    const output = xhsShare ? { ...modelOutput, action: 'message', text: xhsShare.text } : modelOutput;
    // 惊喜礼物不写进起居注的那一句里（阿萌翻得到），买了什么留在 episode.life。
    const veiled = veilSurprise(output, life, userName);
    recordModelRun(db, {
        jobUuid: job.uuid,
        charId: character.charId,
        runtime: character.runtime,
        startedAt: startedAt.toISOString(),
        durationMs,
        ok: true,
        outcome: output.action,
        reason: veiled.reason,
        // activity 是「这次醒来我做了什么」，起居注列的就是它。
        activity: veiled.activity,
        shadow,
        // 抽中了开口、模型却退回 noop 的次数值得盯：多了说明提示词还是在劝它闭嘴。
        intent,
        // 开了口就不再欠着；没开口的「等会儿」留给下一跳兑现。上一跳欠下的，这一跳不能开口时继续欠着。
        urge: output.action === 'message' ? 'none' : (hush && carried ? 'later' : output.urge),
        // 这一跳为什么没开口（审计用）；outcome 不是 skipped，界面不会当成「被拦下」显示。
        skipGate: hush,
        // 不能开口时模型写下的那句也留着，排查时能看到 TA 本来想说什么。
        proposedText: result.output.action === 'message' ? result.output.text : null,
        episode: episode ?? (life ? { life } : null),
        // 抽中了逛小红书却没刷成（退回了朋友圈）：原因留在试跑记录里，排查「怎么从来不刷」时看得到
        ...(xhsSkipped ? { skipGate: hush || `xhs:${xhsSkipped}`.slice(0, 120) } : {}),
    });

    // 影子期到此为止：不写 outbox、不推送、不执行工具（设计 4.3 第 9 步）。
    if (shadow || !deliver) {
        return { ok: true, shadow, intent, action: output.action, activity: output.activity, durationMs };
    }

    // 刷过的朋友圈：看过就记下（回没回应都一样），回应了的静默送去手机写进朋友圈。
    if (moments.length) {
        markMomentsSeen(db, character.charId, moments.map(post => post.id), startedAt);
        const reactions = resolveMomentReactions(result.output.moments, moments);
        if (reactions.length) {
            await deliver({
                messageId: `hb:${job.uuid}:moments`,
                charId: character.charId,
                jobUuid: job.uuid,
                kind: 'job_result',
                notify: false,
                payload: { type: 'moment_reaction', createdAt: startedAt.toISOString(), reactions },
            });
        }
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
    // 到点的约定：这一跳写完就收掉（不管模型写没写好——时间过了，这件事就算去过了）。
    if (duePlan) completeThread(db, duePlan.id, startedAt);
    // 新约的事：落成一条带时间的 thread，之后每跳都记得，到点那一跳去做。
    if (life?.plan?.dueAt) {
        applyThread(db, character.charId, {
            title: life.plan.what, summary: `约在${life.plan.at}`, status: 'open', dueAt: life.plan.dueAt,
        }, startedAt);
    }
    // 逛小红书时想点赞 / 收藏的，真的去做（影子期不做：上面已经返回了）。
    if (life?.kind === 'xhs' && life.picks?.length) {
        life = { ...life, picks: await applyXhsActions(xhs, life.picks) };
    }
    // 私人生活里的小事：落进查手机里对应的 App（联系人聊天 / 外卖 / 淘宝 / 朋友圈），同样静默。
    let lifeDelivered = false;
    if (life) {
        await deliver({
            messageId: `hb:${job.uuid}:life`,
            charId: character.charId,
            jobUuid: job.uuid,
            kind: 'job_result',
            notify: false,
            payload: { type: 'life_episode', createdAt: startedAt.toISOString(), activity: output.activity, life },
        });
        lifeDelivered = true;
    }
    if (output.action !== 'message') {
        return { ok: true, shadow, intent, action: output.action, activity: output.activity, workDelivered, lifeDelivered, durationMs };
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
            // 转发的那条小红书：前端在这句话后面接一张卡片（跟聊天里 [[XHS_SHARE]] 同一种）
            ...(xhsShare ? { xhsNote: toCardNote(xhsShare.note) } : {}),
        },
    });
    return { ok: true, shadow: false, intent, action: 'message', activity: output.activity, delivered: true, workDelivered, lifeDelivered, durationMs };
};
