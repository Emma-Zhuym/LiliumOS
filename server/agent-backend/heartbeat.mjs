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

/** 心跳最晚执行时间：过了就 expired，mini 睡醒后不会补跑一堆旧心跳（设计 4.1）。 */
export const HEARTBEAT_TTL_MS = 15 * 60 * 1000;
/** 「阿萌正在和这个角色聊天」的判定窗口。 */
export const ACTIVE_CHAT_WINDOW_MS = 20 * 60 * 1000;
/** 开启心跳后第一跳的延迟（设计 3.3）。 */
export const FIRST_BEAT_DELAY_MS = 3 * 60 * 1000;

const MINUTE = 60_000;

/**
 * ±20% 的确定性抖动。
 *
 * 用 charId + 代次 + 名义时刻算哈希，所以看起来随机，但同一跳重算永远是同一个结果——
 * 重试时不会因为「又摇了一次骰子」而长出第二条心跳链。
 */
export const jitterRatio = (charId, generation, nominalRunAt) => {
    const digest = createHash('sha256')
        .update(`${charId}:${generation}:${nominalRunAt}`)
        .digest();
    // 取两字节映射到 [-0.2, 0.2]。
    const unit = ((digest[0] << 8) | digest[1]) / 0xffff;
    return (unit - 0.5) * 0.4;
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
} = {}) => {
    const everyMin = effectiveEveryMin(character, { everyMinOverride });
    const nominal = new Date(now.getTime() + everyMin * MINUTE);
    const ratio = jitterRatio(character.charId, character.heartbeatGeneration, nominal.toISOString());
    let runAt = new Date(nominal.getTime() + everyMin * MINUTE * ratio);
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

    const lastMessage = lastChatMessageAt(db, character.charId);
    if (lastMessage && now.getTime() - Date.parse(lastMessage) < character.messageCooldownMin * MINUTE) {
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
}) => {
    db.prepare(
        `INSERT INTO model_runs (job_uuid, char_id, runtime, started_at, duration_ms, ok, outcome,
                                 shadow, reason, proposed_text, proposed_tool, proposed_args_summary,
                                 skip_gate, error, activity, raw_output, intent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        jobUuid, charId, runtime, startedAt, durationMs, ok ? 1 : 0, outcome,
        shadow ? 1 : 0, truncate(reason, 500), truncate(proposedText, 2000), proposedTool,
        truncate(proposedArgsSummary, 500), skipGate, truncate(error, 500),
        truncate(activity, 200), truncate(rawOutput, 2000), intent,
    );
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
export const messageChance = ({ availability, minutesSinceContact }) => {
    const base = availability === 'busy' ? 0.08
        : availability === 'offline' ? 0.02
            : availability === 'online' ? 0.25
                : 0.15;
    const hours = (minutesSinceContact ?? 0) / 60;
    const gapBoost = hours >= 12 ? 3 : hours >= 6 ? 2.5 : hours >= 3 ? 1.8 : hours >= 1 ? 1 : 0.4;
    // 封顶 0.6：再高就成了「每隔两跳必找你一次」，那是另一种不自然。
    return Math.min(0.6, Math.max(0, base * gapBoost));
};

/**
 * 决定这一跳的意图。reach_out = 去说句话；live = 过自己的日子。
 * rng 可注入，测试里钉死。
 */
export const decideIntent = ({ snapshot, now, timezone, minutesSinceContact, rng = Math.random }) => {
    const slot = currentSlot(snapshot, now, timezone);
    const availability = slot?.availability ?? null;
    const chance = messageChance({ availability, minutesSinceContact });
    return {
        intent: rng() < chance ? 'reach_out' : 'live',
        chance,
        slot: slot ? { title: slot.title ?? slot.activity ?? '', availability } : null,
    };
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
    },
};

/**
 * 拼提示词。「什么时候该说话」写死在这里，不交给模型自由发挥——
 * 没话找话是主动消息最容易翻车的地方（设计 4.3 第 4 步）。
 */
export const buildPrompt = (character, snapshot, now = new Date(), intent = 'live') => {
    const p = snapshot.payload || {};
    const lines = [];
    lines.push(`你是「${p.identity?.name || character.displayName}」，正在自己的生活里过日子。`);
    if (p.identity?.persona) lines.push(`你的设定：\n${p.identity.persona}`);
    lines.push(`对方是「${p.user?.name || '阿萌'}」。现在是 ${formatLocal(now, p.timezone)}（${p.timezone || '未知时区'}）。`);
    if (p.sleepWindow) lines.push(`你的作息：${p.sleepWindow.start} 睡，${p.sleepWindow.end} 起。`);
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
    // 开不开口已经定了，模型不再做判断题，只负责把它说得像这个人会说的话。
    lines.push(
        intent === 'reach_out'
            ? '现在你想起了对方，并且决定跟 ta 说句话。\n'
                + '规则：activity 里用第一人称写你这会儿在做什么（40 字以内）；'
                + 'action 填 "message"，text 写你要说的那句话——'
                + '要贴着你此刻正在做的事和你们之间还没了结的话头，别写成万能问候。'
                + '真的想不出任何自然的话头时才退回 action="noop"，那说明这一刻确实不合适。'
                + 'reason 写你心里的想法，对方看不到它。'
            : '现在你自己醒了一下，过你自己的日子，不必联系对方。\n'
                + '规则：activity 里用第一人称写你这会儿在做什么（40 字以内），'
                + '贴着你当下的时段——在上班就是工作里的事，闲着就是闲着的事。'
                + 'action 填 "noop"。'
                + 'reason 写你心里的想法，对方看不到它。',
    );
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
    db, config, runners, scheduleNext, quiet = null, now = () => new Date(), rng = Math.random,
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
    // 开不开口由程序抽签，不再让模型做判断题——它总能为沉默找到理由（设计 3.3）。
    const { intent } = decideIntent({
        snapshot,
        now: startedAt,
        timezone,
        minutesSinceContact: lastContact ? (startedAt.getTime() - lastContact.getTime()) / 60_000 : null,
        rng,
    });
    const result = await runner.run({
        charId: character.charId,
        credRef: character.credRef,
        system: buildPrompt(character, snapshot, startedAt, intent),
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
    });

    // 影子期到此为止：不写 outbox、不推送、不执行工具（设计 4.3 第 9 步）。
    // 真实执行是 1d，要动这里先把 heartbeat_shadow 关掉，并且补上 4.3.1 的保质期。
    return { ok: true, shadow, intent, action: output.action, activity: output.activity, durationMs };
};
