/**
 * 劲儿系统（docs/spec-character-drives.md 第 5 节）：角色身上九股会涨会落的劲儿。
 *
 * 不是性格——性格在人设里。这里是「身体里此刻的状态」：很久没说话就更想她、被工作折腾了就压着火、
 * 她失约了就有点别扭。程序拿它给抽签加权（开不开口、过日子做哪类事），写给模型的只有一两句感受，
 * 永远不出现数字、不写「你应该做什么」。
 *
 * 三条从参考项目借来的规矩（只借思路，代码自己写；出处见 docs/ideas.md 那一节）：
 * - 模型只给事件标签，数值由代码定（LMC-5「模型提议、代码决定」、Drivesoid 的固定标签表）
 * - 涨幅按剩余空间缩放、同一标签 15 分钟内重复打折、负面的要有原话作证（Drivesoid / 欲望攻略）
 * - 只有真做完才落（欲望攻略「工具证据」）：心跳真发出了消息、真写出了那件生活小事
 *
 * 数值是时间的纯函数：读的时候按经过的时间往基线回，不需要单独的定时器。
 */

export const DRIVES = ['miss', 'curious', 'reminisce', 'social', 'stress', 'sulk', 'concern', 'desire', 'tired'];

/** 默认基线（还没有脾气读数时用）。 */
export const DEFAULT_BASELINE = {
    miss: 0.35, curious: 0.3, reminisce: 0.25, social: 0.3, stress: 0.15, sulk: 0.05, concern: 0.1, desire: 0.2, tired: 0.2,
};

/** 往基线回的快慢（小时，越小回得越快）。负面的回得慢一点，但别扭有 24 小时硬封顶。 */
const HALF_LIFE_H = {
    miss: 10, curious: 6, reminisce: 8, social: 8, stress: 8, sulk: 6, concern: 8, desire: 4, tired: 5,
};

/** 别扭最多一天就消（阿萌 2026-10-14 定）：距最后一次有原话作证满 24 小时，强制回基线。 */
export const SULK_MAX_MS = 24 * 60 * 60 * 1000;
/**
 * 你们此刻在不在一块（心跳每跳判断一次，存在状态里，6 小时内有效）。阿萌 2026-10-19：
 * 同居的晚上「想你」该回落、异地异国该涨；她上课他上班那几个小时也算分开，但只是几个小时，不该跟隔着半个地球一样涨。
 * - together：就在一块（同居在家、他来看她那几天）——不涨，往下回
 * - today：各忙各的，今天之内会见到——慢慢涨
 * - far：好几天见不到（异地、异国、出差）——涨得快
 * - unknown：看不出来——中间速度
 */
export const APARTNESS = ['together', 'today', 'far', 'unknown'];
const APARTNESS_TTL_MS = 6 * 60 * 60 * 1000;
/** 不说话时「想你」的基线每小时爬多少、最多爬多少（攻略的「慢地板」）。together 是负的：在一块时往下回。 */
const MISS_DRIFT = {
    together: { perHour: -0.02, max: -0.15 },
    today: { perHour: 0.015, max: 0.2 },
    far: { perHour: 0.045, max: 0.35 },
    unknown: { perHour: 0.03, max: 0.28 },
};
/**
 * 性欲（界面上叫「念想」）照攻略的做法：基线压得低、亲密留尾迹、有不应期、早上有小脉冲、累和上班压它。
 * - 分开时被撩到（intimate）：往上冲一截，4 小时半衰慢慢退
 * - 在一块的亲密：当作满足了，落到四成，之后 3 小时不应期（这段时间不再往上推，早上的脉冲也不算）
 */
const DESIRE_REFRACTORY_MS = 3 * 60 * 60 * 1000;
const DESIRE_MORNING = 0.1;

/** 撒娇 / 亲密时「想你」怎么变：在一块是满足了，分开时是更想见面。 */
const AFFECTION_MISS = { together: -0.10, today: 0.03, far: 0.08, unknown: 0 };

/** 这一刻算哪种：心跳判断过、还没过期就用它，否则 unknown。 */
export const apartnessOf = (state, now = new Date()) => {
    const a = state?.apartness;
    return a && APARTNESS.includes(a.value) && now.getTime() - Date.parse(a.at) < APARTNESS_TTL_MS ? a.value : 'unknown';
};
/** 同一标签 15 分钟内重复，每次 ×0.7（Drivesoid）。 */
const HABITUATION_MS = 15 * 60_000;
const HABITUATION = 0.7;
/** 一个事件对一股劲儿最多推这么多。 */
const EVENT_CAP = 0.2;

/** 负面标签：没有原话就不收（攻略的教训：小模型把「我！去！看！看！」判成压力，天天积成假账）。 */
export const NEGATIVE_LABELS = new Set(['cold', 'dismissive', 'conflict', 'broken_promise', 'pressing']);

/**
 * 标签 → 各股劲儿的增减。chat 开头的来自聊天里副 API 的评估（她做了什么），
 * self 开头的来自心跳里 TA 自己的经历。
 */
export const LABEL_EFFECTS = {
    // 她这边
    affectionate: { miss: -0.10, desire: 0.05, sulk: -0.10 },
    intimate: { desire: 0.15, miss: -0.10 },
    vulnerable: { concern: 0.15 },
    reassuring: { sulk: -0.30, stress: -0.10 },
    sharing: { curious: 0.05, miss: -0.05 },
    // 轻的（冷淡、不当回事）单独一次只让他心里有点堵；重的（吵架、失约）一次就够他主动提（阿萌 2026-10-19）
    cold: { sulk: 0.06, miss: 0.05 },
    dismissive: { sulk: 0.07 },
    conflict: { sulk: 0.15, stress: 0.05 },
    broken_promise: { sulk: 0.15 },
    pressing: { stress: 0.08 },
    concern_fact: { concern: 0.12 },
    neutral: {},
    // TA 自己这边（心跳 selfEvents）
    work_trouble: { stress: 0.12, tired: 0.05 },
    work_win: { stress: -0.08 },
    friend_fun: { social: -0.10, stress: -0.05 },
    tired_day: { tired: 0.15 },
};
export const CHAT_LABELS = ['affectionate', 'intimate', 'vulnerable', 'reassuring', 'sharing', 'cold', 'dismissive', 'conflict', 'broken_promise', 'pressing', 'concern_fact', 'neutral'];
export const SELF_LABELS = ['work_trouble', 'work_win', 'friend_fun', 'tired_day'];

/** 真做完了：按比例往下落（乘性），之后两跳内这股不再加权。 */
export const SATISFY = {
    message: { miss: 0.5 },
    reach_her_side: { concern: 0.6 },
    grievance_said: { sulk: 0.6 },
    chat: { social: 0.5 },
    social: { social: 0.45 },
    moment: { curious: 0.7, social: 0.85 },
    xhs: { curious: 0.55 },
    gift: { miss: 0.75 },
};

const clamp01 = v => Math.max(0, Math.min(1, v));

export const freshState = (baseline = DEFAULT_BASELINE, now = new Date()) => ({
    values: { ...baseline },
    baseline: { ...baseline },
    updatedAt: now.toISOString(),
    labels: {},
    sulkEvidence: null,
});

/** 疲惫的基线随一天的时段走：早上低，深夜高（角色那边的钟）。 */
const tiredBaseFor = (base, localHour) => {
    if (localHour >= 23 || localHour < 2) return clamp01(base + 0.25);
    if (localHour >= 20) return clamp01(base + 0.12);
    if (localHour < 10) return clamp01(base - 0.08);
    return base;
};

/**
 * 时间往前走：每股按半衰期往（当下的）基线回。
 * silenceHours = 离上次真聊天多久；localHour = 角色那边几点；在不在一块看状态里心跳上次的判断。
 */
export const evolve = (state, now = new Date(), { silenceHours = 0, localHour = 12, busy = false } = {}) => {
    const drift = MISS_DRIFT[apartnessOf(state, now)];
    const refractory = state.desireRefractoryUntil && now.getTime() < Date.parse(state.desireRefractoryUntil);
    const tiredOver = Math.max(0, (state.values.tired ?? 0) - (state.baseline.tired ?? DEFAULT_BASELINE.tired));
    const dtH = Math.max(0, (now.getTime() - Date.parse(state.updatedAt)) / 3_600_000);
    const values = {};
    for (const key of DRIVES) {
        let base = state.baseline[key] ?? DEFAULT_BASELINE[key];
        if (key === 'miss') {
            const moved = drift.perHour * silenceHours;
            base = clamp01(base + (drift.perHour >= 0 ? Math.min(drift.max, moved) : Math.max(drift.max, moved)));
        }
        if (key === 'tired') base = tiredBaseFor(base, localHour);
        if (key === 'desire') {
            // 早上有个小脉冲（不应期里不算）；累了、在上班时往下压
            if (!refractory && localHour >= 6 && localHour < 9) base += DESIRE_MORNING;
            base -= 0.5 * tiredOver + (busy ? 0.1 : 0);
            base = clamp01(base);
        }
        const current = state.values[key] ?? base;
        const factor = Math.pow(0.5, dtH / HALF_LIFE_H[key]);
        values[key] = clamp01(base + (current - base) * factor);
    }
    let sulkEvidence = state.sulkEvidence;
    if (sulkEvidence && now.getTime() - Date.parse(sulkEvidence.at) >= SULK_MAX_MS) {
        values.sulk = state.baseline.sulk ?? DEFAULT_BASELINE.sulk;
        sulkEvidence = null;
    }
    return { ...state, values, updatedAt: now.toISOString(), sulkEvidence };
};

/**
 * 吃进一个事件标签。返回 { state, changes }，changes 每项进劲儿账。
 * sensitivity：脾气读数的敏感度倍数（还没有脾气读数时都是 1）。
 */
export const applyLabel = (state, { label, quote = '', source = 'chat', now = new Date(), sensitivity = {} }) => {
    const table = LABEL_EFFECTS[label];
    if (!table) return { state, changes: [], rejected: 'unknown_label' };
    // 撒娇 / 亲密对「想你」的作用看你们此刻在不在一块
    const apart = apartnessOf(state, now);
    const togetherIntimacy = label === 'intimate' && apart === 'together';
    const refractory = state.desireRefractoryUntil && now.getTime() < Date.parse(state.desireRefractoryUntil);
    let effects = label === 'affectionate' || label === 'intimate'
        ? { ...table, miss: AFFECTION_MISS[apart] }
        : table;
    // 在一块的亲密不往上冲（下面当作满足处理）；不应期里性欲不再往上推
    if (togetherIntimacy || (refractory && (effects.desire ?? 0) > 0)) effects = { ...effects, desire: 0 };
    const cleanQuote = String(quote ?? '').trim().slice(0, 120);
    if (NEGATIVE_LABELS.has(label) && !cleanQuote) return { state, changes: [], rejected: 'no_quote' };
    const last = state.labels?.[label];
    const repeats = last && now.getTime() - Date.parse(last.at) < HABITUATION_MS ? last.repeats + 1 : 0;
    const damp = Math.pow(HABITUATION, repeats);
    const values = { ...state.values };
    const changes = [];
    for (const [key, raw] of Object.entries(effects)) {
        const before = values[key] ?? 0;
        const scaled = raw * damp * (sensitivity[key] ?? 1);
        // 涨按剩余空间缩放，落按当前值缩放：满了不会再顶，空了不会落成负的
        const delta = Math.max(-EVENT_CAP, Math.min(EVENT_CAP, scaled >= 0 ? scaled * (1 - before) * 1.6 : scaled * before * 1.6));
        const after = clamp01(before + delta);
        if (Math.abs(after - before) < 0.001 || !raw) continue;
        values[key] = after;
        changes.push({ drive: key, delta: after - before, valueAfter: after, label, source, reason: cleanQuote || label });
    }
    if (togetherIntimacy) {
        const before = values.desire ?? 0;
        values.desire = clamp01(before * 0.4);
        if (Math.abs(values.desire - before) >= 0.001) {
            changes.push({ drive: 'desire', delta: values.desire - before, valueAfter: values.desire, label, source, reason: 'together' });
        }
    }
    const sulkUp = changes.some(c => c.drive === 'sulk' && c.delta > 0);
    const sulkReset = label === 'reassuring';
    return {
        state: {
            ...state,
            ...(togetherIntimacy ? { desireRefractoryUntil: new Date(now.getTime() + DESIRE_REFRACTORY_MS).toISOString() } : {}),
            values,
            labels: { ...(state.labels ?? {}), [label]: { at: now.toISOString(), repeats } },
            sulkEvidence: sulkReset ? null : sulkUp ? { at: now.toISOString(), quote: cleanQuote, label } : state.sulkEvidence,
        },
        changes,
    };
};

/** 真做完了一件事：对应的劲儿按比例往下落。 */
export const satisfy = (state, what, { source = 'heartbeat' } = {}) => {
    const table = SATISFY[what];
    if (!table) return { state, changes: [] };
    const values = { ...state.values };
    const changes = [];
    for (const [key, factor] of Object.entries(table)) {
        const before = values[key] ?? 0;
        const after = clamp01(before * factor);
        if (Math.abs(after - before) < 0.001) continue;
        values[key] = after;
        changes.push({ drive: key, delta: after - before, valueAfter: after, label: `satisfy:${what}`, source, reason: what });
    }
    const sulkEvidence = what === 'grievance_said' ? null : state.sulkEvidence;
    return { state: { ...state, values, sulkEvidence }, changes };
};

const above = (state, key) => (state.values[key] ?? 0) - (state.baseline[key] ?? DEFAULT_BASELINE[key]);

/**
 * 开口的概率乘多少。想你、挂心推高；累、别扭压低。封在 0.5–1.6，闸门和上限照旧在外面管。
 */
export const chanceFactor = state => {
    if (!state) return 1;
    const f = 1 + 1.2 * above(state, 'miss') + 0.8 * above(state, 'concern') - 0.8 * above(state, 'tired') - 0.6 * above(state, 'sulk');
    return Math.max(0.5, Math.min(1.6, f));
};

/** 生活小事各类的权重乘多少：社交看社交、刷手机看好奇、给她买东西看想你。 */
export const lifeWeightFactors = state => {
    if (!state) return null;
    const v = key => state.values[key] ?? 0;
    return {
        chat: 0.6 + v('social'),
        social: 0.6 + v('social'),
        moment: 0.7 + 0.6 * v('curious'),
        xhs: 0.5 + v('curious'),
        gift: 0.6 + v('miss'),
        delivery: 1,
        order: 1,
    };
};

/** 高出基线这么多才算「有感觉」，写进提示词。别扭门槛低一点：冷淡一次就该有点堵。 */
const FEEL_AT = 0.15;
const FEEL_AT_FOR = { sulk: 0.08 };
const feelAt = key => FEEL_AT_FOR[key] ?? FEEL_AT;

/**
 * 给模型看的感受：最强的一两股，一句话一股。别扭、挂心带上作证的原话。
 * 返回 { text, top }，top 是最强那股的名字（发消息时推送要不要藏预览看它）。
 */
export const formatFeelings = (state, { userName = 'ta' } = {}) => {
    if (!state) return { text: '', top: null };
    const phrases = {
        miss: () => `你有点想${userName}了。`,
        curious: () => '你有点坐不住，想看看外面在发生什么。',
        reminisce: () => '你脑子里时不时冒出以前的事。',
        social: () => '你想找朋友说说话。',
        stress: () => '工作上的事压得你有点烦。',
        sulk: () => `你心里还有点堵${state.sulkEvidence?.quote ? `：${userName}说过「${state.sulkEvidence.quote}」` : ''}。`,
        concern: () => `你有点挂心${userName}。`,
        desire: () => `你对${userName}有点念想。`,
        tired: () => '你有点累了。',
    };
    const strong = DRIVES
        .map(key => ({ key, over: above(state, key) }))
        .filter(item => item.over >= feelAt(item.key))
        .sort((a, b) => b.over - a.over)
        .slice(0, 2);
    if (!strong.length) return { text: '', top: null };
    return {
        text: `你此刻身上的感觉（只是感觉，怎么表现、表不表现由你的性格定；嘴上说的可以跟心里不一样）：\n${strong.map(item => `- ${phrases[item.key]()}`).join('\n')}`,
        top: strong[0].key,
    };
};

/** 别扭到一定程度、又有原话作证时，开口的缘由里可以有「把不满说出来」。 */
export const grievanceOf = state => (
    // 一次失约 / 吵架就够（+0.2）；冷淡、不当回事单独一次够不着（+0.1 上下）
    state && above(state, 'sulk') >= 0.15 && state.sulkEvidence?.quote ? state.sulkEvidence : null
);

/** 心跳判断完「此刻在不在一块」，存进状态。不认识的值不存。 */
export const withApartness = (state, value, now = new Date()) => (
    APARTNESS.includes(value) && value !== 'unknown' ? { ...state, apartness: { value, at: now.toISOString() } } : state
);

/** 给手机看的摘要：最强的一两股和档位，不给精确数值。 */
export const summarizeForPhone = state => {
    if (!state) return [];
    return DRIVES
        .map(key => ({ drive: key, over: above(state, key) }))
        .filter(item => item.over >= feelAt(item.drive))
        .sort((a, b) => b.over - a.over)
        .slice(0, 2)
        .map(item => ({ drive: item.drive, level: item.over >= 0.35 ? 'high' : 'mid' }));
};

// ── 存储 ───────────────────────────────────────────────────────

export const loadState = (db, charId, now = new Date()) => {
    const row = db.prepare('SELECT state_json FROM drive_state WHERE char_id = ?').get(charId);
    if (!row) return freshState(DEFAULT_BASELINE, now);
    try {
        const parsed = JSON.parse(row.state_json);
        return { ...freshState(DEFAULT_BASELINE, now), ...parsed, values: { ...DEFAULT_BASELINE, ...parsed.values } };
    } catch {
        return freshState(DEFAULT_BASELINE, now);
    }
};

export const saveState = (db, charId, state) => {
    db.prepare(
        `INSERT INTO drive_state (char_id, state_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(char_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
    ).run(charId, JSON.stringify(state), state.updatedAt);
};

export const writeLedger = (db, charId, changes, now = new Date()) => {
    const insert = db.prepare(
        `INSERT INTO drive_ledger (char_id, at, drive, delta, value_after, source, label, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of changes) {
        insert.run(charId, now.toISOString(), c.drive, Math.round(c.delta * 1000) / 1000, Math.round(c.valueAfter * 1000) / 1000, c.source, c.label, String(c.reason ?? '').slice(0, 200));
    }
};

/** 劲儿账只留 90 天。 */
export const pruneLedger = (db, now = new Date()) => {
    db.prepare('DELETE FROM drive_ledger WHERE at < ?').run(new Date(now.getTime() - 90 * 24 * 3600_000).toISOString());
};

/**
 * 手机送来的事件（聊天里副 API 评估给的标签）。同一个标签 + 同一句原话 30 分钟内只收一次，
 * 免得重发、补跑把同一件事记两遍。返回收下了几个。
 */
export const ingestChatEvents = (db, { charId, events = [], now = new Date(), silenceHours = 0, localHour = 12 }) => {
    let state = evolve(loadState(db, charId, now), now, { silenceHours, localHour });
    let accepted = 0;
    const seen = db.prepare(
        `SELECT 1 FROM drive_ledger WHERE char_id = ? AND label = ? AND reason = ? AND at >= ? LIMIT 1`,
    );
    for (const event of Array.isArray(events) ? events.slice(0, 5) : []) {
        const label = String(event?.label ?? '');
        if (!CHAT_LABELS.includes(label) || label === 'neutral') continue;
        const quote = String(event?.quote ?? '').trim().slice(0, 120);
        if (seen.get(charId, label, quote || label, new Date(now.getTime() - 30 * 60_000).toISOString())) continue;
        const { state: next, changes } = applyLabel(state, { label, quote, source: 'chat', now });
        if (!changes.length) continue;
        state = next;
        writeLedger(db, charId, changes, now);
        accepted += 1;
    }
    saveState(db, charId, state);
    return accepted;
};
