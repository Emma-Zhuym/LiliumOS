/**
 * 开口的那一跳：这次为什么想起 ta（docs/spec-character-drives.md 4.3、4.4）。
 *
 * 原来 reach_out 只看得到上一轮对话，规则又写「贴着还没了结的话头」，于是 TA 每次找阿萌
 * 都是接上次的话，从不说自己的日子。其实 TA 的日子都在库里（model_runs.episode），只是没递过来。
 *
 * 跟这个后端别处一样：缘由由程序抽，模型只负责说得像这个人。让模型自己挑，它永远挑接话头。
 */

/** 缘由的初始权重。没有对应内容的那一项归零，其余按比例重分。 */
export const REACH_REASON_WEIGHTS = [
    ['grievance', 0.30],
    ['pocket', 0.35],
    ['own_life', 0.20],
    ['her_side', 0.15],
    ['thread', 0.30],
];

const LIFE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const LINE_MAX = 90;

const clip = (value, max = LINE_MAX) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const firstLines = (lines, count = 2) => (Array.isArray(lines) ? lines : [])
    .slice(0, count)
    .map(line => `${line.who}：${line.text}`)
    .join(' / ');

const WORK_CHANNEL = { group: '工作群里', dm: '私聊里', email: '邮件里' };

/**
 * 一件事压成一行。礼物不写（那是给阿萌的，惊喜得藏住）；认不出的也不写。
 */
export const summarizeEpisode = episode => {
    if (!episode || typeof episode !== 'object') return null;
    const life = episode.life;
    if (life && typeof life === 'object') {
        const detail = clip(life.detail || firstLines(life.lines));
        switch (life.kind) {
            case 'chat': return life.with ? clip(`跟${life.with}聊了几句：${detail}`) : null;
            case 'social': return life.with ? clip(`跟${life.with}${detail ? `：${detail}` : '有点来往'}`) : null;
            case 'delivery': return clip(`点了外卖${life.with ? `（${life.with}）` : ''}${life.detail ? `：${life.detail}` : ''}`);
            case 'order': return clip(`网上买了${life.with || '点东西'}${life.detail ? `（${life.detail}）` : ''}`);
            case 'moment': return detail ? clip(`发了条朋友圈：${detail}`) : null;
            case 'xhs': return detail ? clip(`刷了会儿小红书：${detail}`) : null;
            default: return null;
        }
    }
    if (episode.channel && episode.with) {
        const gist = episode.thread?.summary || firstLines(episode.lines);
        return clip(`工作上，${WORK_CHANNEL[episode.channel] || ''}和${episode.with}${episode.subject ? `（${episode.subject}）` : ''}：${gist}`);
    }
    return null;
};

/**
 * 最近一天 TA 自己过的事（只看动过脑、不是试跑的那些），最早的在前。
 * 原来能回看的只有 40 字的 activity，「跟谁聊了什么、买了什么、刷到什么」全丢了。
 */
export const recentLife = (db, charId, now = new Date(), { limit = 6 } = {}) => db.prepare(
    `SELECT started_at, episode FROM model_runs
      WHERE char_id = ? AND ok = 1 AND shadow = 0 AND episode IS NOT NULL AND started_at >= ?
      ORDER BY id DESC LIMIT ?`,
).all(charId, new Date(now.getTime() - LIFE_LOOKBACK_MS).toISOString(), limit * 2)
    .map(row => {
        let episode = null;
        try { episode = JSON.parse(row.episode); } catch { /* 截断的 JSON 就跳过 */ }
        const text = summarizeEpisode(episode);
        return text ? { at: row.started_at, text } : null;
    })
    .filter(Boolean)
    .slice(0, limit)
    .reverse();

const clockIn = (at, timeZone) => {
    try {
        return new Intl.DateTimeFormat('zh-CN', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(at));
    } catch {
        return new Date(at).toISOString().slice(11, 16);
    }
};

/**
 * 阿萌那边、mini 看得到的东西里，能让 TA 想起她的几件。
 * 日历只取已经按可见性裁过的；只给看「有安排」的那些不用（说不出具体的事，像在查岗）。
 * 账本只取近两天的支出，转账、待入账都不算。
 */
export const herSideCues = ({ temporalItems = [], finance = null, now = new Date(), userTimeZone = 'UTC', userName = 'ta' }) => {
    const nowMs = now.getTime();
    const cues = [];
    for (const item of temporalItems) {
        if (item.veiled || !item.title) continue;
        if (item.kind === 'event' && item.startAt && !item.allDay) {
            const start = Date.parse(item.startAt);
            const end = Date.parse(item.endAt ?? item.startAt);
            if (start > nowMs && start - nowMs <= 12 * 3600_000) {
                cues.push(`${userName} ${clockIn(item.startAt, userTimeZone)} 有「${clip(item.title, 30)}」`);
            } else if (end <= nowMs && nowMs - end <= 3 * 3600_000) {
                cues.push(`${userName}刚结束「${clip(item.title, 30)}」`);
            }
        } else if (item.kind === 'reminder' && !item.completed && item.dueAt) {
            const due = Date.parse(item.dueAt);
            if (due >= nowMs - 6 * 3600_000 && due - nowMs <= 12 * 3600_000) {
                cues.push(`${userName}今天有件事要做：「${clip(item.title, 30)}」`);
            }
        }
    }
    const recent = Array.isArray(finance?.recent) ? finance.recent : [];
    const spend = recent.find(t => t.type === 'expense' && !t.pending && t.merchant
        && Date.parse(t.date) >= nowMs - 2 * 24 * 3600_000);
    if (spend) cues.push(`${userName}前两天在「${clip(spend.merchant, 24)}」花了 ${spend.amount} ${spend.currency}`);
    return cues;
};

/**
 * 抽「这次为什么想起 ta」。没有内容的缘由不参与；连发了没回时不接话头（别追着上一轮问）。
 * rng 可注入，测试钉死。返回 { kind, item }，kind=thread 时 item 为 null。
 */
export const pickReachReason = ({ pocket = [], ownLife = [], herSide = [], unanswered = 0, grievance = null, rng = Math.random }) => {
    const pools = {
        // 别扭有原话作证时（drives.mjs grievanceOf）：心跳可以主动提（阿萌 2026-10-14 定）
        grievance: grievance && unanswered === 0 ? grievance : null,
        pocket: pocket.length ? pocket[0] : null,
        own_life: ownLife.length ? ownLife[ownLife.length - 1 - Math.floor(rng() * Math.min(3, ownLife.length))] : null,
        her_side: herSide.length ? herSide[Math.floor(rng() * herSide.length)] : null,
        thread: unanswered > 0 ? null : true,
    };
    const weights = REACH_REASON_WEIGHTS.filter(([kind]) => pools[kind]);
    const total = weights.reduce((sum, [, w]) => sum + w, 0);
    const roll = rng();
    if (!total) return { kind: 'own_day', item: null };
    // 按千分位累加再比，跟 pickLifeKind 同一个理由：浮点一路相减会在分档边界差一个 ε
    const target = Math.round(roll * total * 1000);
    let acc = 0;
    for (const [kind, w] of weights) {
        acc += Math.round(w * 1000);
        if (target < acc) return { kind, item: kind === 'thread' ? null : pools[kind] };
    }
    const [lastKind] = weights[weights.length - 1];
    return { kind: lastKind, item: lastKind === 'thread' ? null : pools[lastKind] };
};

/** 写给模型的那句缘由。只说「为什么想起」，不规定怎么说。 */
export const formatReachReason = (reason, { formatGap = () => '' } = {}) => {
    if (!reason) return '';
    switch (reason.kind) {
        case 'pocket':
            return `你想起 ta，是因为之前攒着一句想跟 ta 说的话：「${reason.item.text}」`
                + `${formatGap(reason.item.createdAt) ? `（${formatGap(reason.item.createdAt)}想到的）` : ''}。`
                + '就从这件事说起，用你此刻自然的说法，不必照抄那句。';
        case 'own_life':
            return `你想起 ta，是因为你自己这边的这件事想跟 ta 说说：${reason.item.text}。`
                + '从你这边的事说起，像随口跟亲近的人分享，别说成在汇报。';
        case 'her_side':
            return `你想起 ta，是因为想到了 ta 那边的：${reason.item}。`
                + '可以借这个关心一句、或者就这件事聊起来；别像在查岗，也别猜 ta 没说的事。';
        case 'thread':
            return '你想起 ta，是因为你们上次聊的那些还在你心里，想接着说下去。';
        case 'date_day':
            return `今天是你给 ta 安排约会的日子（${reason.item.title}${reason.item.time ? `，${reason.item.time} 开始` : ''}），`
                + '这次找 ta 就是为这个：照你写下的安排开个头——问候 ta、告诉 ta 什么时候见、先做什么。'
                + '留一点悬念，别把整份安排一口气说完。';
        case 'grievance':
            return `你想起 ta，是因为心里还有点堵：ta 说过「${reason.item.quote}」。`
                + '可以把不满说出来，用你自己的方式——别憋着，也别借题发挥吵大；说开了，心里就过去了。';
        default:
            return '你想起 ta，没有特别的缘由，就是想了。说说你此刻在做的事就好。';
    }
};

/**
 * 攒着的话（2026-10-19 阿萌：兑现「等会儿」的时候也看一眼草稿箱，可以一次性多说点不同的东西——
 * 想我的、之前想告诉我的、没发消息这段时间他遇到的，各种乱七八糟的）。
 *
 * 开口的那一跳，除了「为什么想起 ta」那一件，再把还没说的几句话兜、你们没说话这段时间自己遇到的事
 * 一起摆出来。用没用、用几件由模型定；说出口的那几句由心跳发完消息后按字面划掉（settleSaidFromMessages）。
 */
export const CATCH_UP_POCKET = 3;
export const CATCH_UP_LIFE = 3;

export const buildCatchUp = ({ pocket = [], lifeLog = [], lastContact = null, reason = null } = {}) => {
    const usedPocket = reason?.kind === 'pocket' ? reason.item?.id : null;
    const usedLife = reason?.kind === 'own_life' ? reason.item?.text : null;
    const since = lastContact ? lastContact.getTime() : 0;
    return {
        pocket: pocket.filter(item => item.id !== usedPocket).slice(-CATCH_UP_POCKET),
        life: lifeLog
            .filter(item => Date.parse(item.at) > since && item.text !== usedLife)
            .slice(-CATCH_UP_LIFE),
    };
};

/**
 * 写给模型的那段。东西够多、又隔了一阵没说话时，明说「这次就一起说了」——
 * 只写「可以」的话它只会挑一件（凡是交给模型判断要不要做的，它都选省事的那个）。
 * 连发了没回时不鼓励多说：那时候只该说一件自己的事或一句不用回的话。
 */
export const formatCatchUp = (catchUp, { formatGap = () => '', gapMs = 0, unanswered = 0 } = {}) => {
    const lines = [
        ...catchUp.pocket.map(item => `- 之前就想跟 ta 说的：「${item.text}」${formatGap(item.createdAt) ? `（${formatGap(item.createdAt)}想到的）` : ''}`),
        ...catchUp.life.map(item => `- 你们没说话这段时间，你这边：${item.text}`),
    ];
    if (!lines.length) return '';
    const plenty = lines.length >= 2 && gapMs >= 60 * 60 * 1000 && unanswered === 0;
    return '除此之外，你心里还攒着这些没跟 ta 说的：\n'
        + `${lines.join('\n')}\n`
        + (unanswered > 0
            ? 'ta 还没回你上一条，这次只挑其中一件说就好，别一口气倒一堆。'
            : plenty
                ? '隔了一阵没说话，这次就像攒了一肚子话终于拿起手机的人：想 ta 的、之前想说的、这段时间遇到的，'
                    + '挑两三件一起说了，想到哪说到哪，一件一行（会拆成几条消息发出去）；别编号、别列清单，也不用全都说。'
                : '想顺带说的就一起说，一件一行；不想说的就放着。');
};
