/**
 * 话兜：TA 过日子时攒下、还没跟阿萌说的话（docs/spec-character-drives.md 4.2）。
 *
 * 心跳原来开口时只看得到上一轮对话，于是每次找她都是接话头，从不分享自己的日常。
 * 真人是攒话的：今天被同事气到了、刷到一个好笑的，想着「等会儿跟她说」。
 * 这里就是那个「等会儿」——过日子的那一跳顺手写一句 tellLater 进来，开口的那一跳拿出来。
 *
 * 查手机的草稿箱读的也是这里：没发出去的那几句。
 *
 * 2026-10-19 返工（阿萌：草稿箱里一堆过时了也没说出来的话，很怪）。实测一个角色四天攒了 37 句、只说出口 2 句，
 * 草稿箱里挂着「点了热汤待会儿喝」「六点四十五到家」这种早就过去的事，还有「得跟她说一声……」这种写给自己的备忘。
 * 现在：每句有自己的保质期（等会儿的事几小时、今天的事到今天结束、闲话两天）；写给自己的备忘、
 * 跟还没说的某句差不多的不收；聊天里已经说过的划掉。
 */

import { randomUUID } from 'node:crypto';

/** 最长的保质期：过两天说也不奇怪的闲话。再久说出来像翻旧账。 */
export const POCKET_TTL_MS = 48 * 60 * 60 * 1000;
/** 「等会儿」的事：过了这么久就没意义了（热汤凉了、外卖到了、会开完了）。 */
export const POCKET_SOON_MS = 3 * 60 * 60 * 1000;
/** 「今天」的事最多放这么久（按角色那边的今天结束算，但不超过它）。 */
export const POCKET_TODAY_MAX_MS = 18 * 60 * 60 * 1000;
/** 同时最多攒这么多；再多就丢最旧的那句。 */
export const MAX_UNSAID = 5;
export const POCKET_TEXT_MAX = 120;
export const POCKET_FRESHNESS = ['soon', 'today', 'days'];

const toItem = row => ({
    id: row.id,
    charId: row.char_id,
    text: row.text,
    kind: row.kind,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    saidAt: row.said_at ?? null,
});

const isoOf = value => (value instanceof Date ? value : new Date(value)).toISOString();

const SOON_WORDS = /等会儿|待会儿?|一会儿|马上|这就|现在|正在|刚(?:刚|才)?(?:点|下单|买)|到家|路上|开完会/;
const TODAY_WORDS = /今天|今晚|今早|今儿|中午|下午|晚上|晚饭|午饭|早饭|夜宵|这会儿/;

/**
 * 字面上看得出来的保质期：说了「等会儿」的只能放几小时，说了「今天 / 今晚」的放到今天。
 * 模型给的档和这里取更短的那个——它常把「待会儿喝」标成能放两天。
 */
export const freshnessFromText = text => (SOON_WORDS.test(text) ? 'soon' : TODAY_WORDS.test(text) ? 'today' : 'days');

const shorter = (a, b) => (POCKET_FRESHNESS.indexOf(a) <= POCKET_FRESHNESS.indexOf(b) ? a : b);

/** 某时区里「今天还剩多久」。认不出时区就按 UTC。 */
const msUntilLocalMidnight = (now, timeZone) => {
    let parts;
    try {
        parts = new Intl.DateTimeFormat('en-US', {
            timeZone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric',
        }).formatToParts(now);
    } catch {
        parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric',
        }).formatToParts(now);
    }
    const get = type => Number(parts.find(p => p.type === type)?.value ?? 0);
    const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000;
    return 24 * 60 * 60 * 1000 - elapsed;
};

/** 这一档能放多久。today 至少放三小时（深夜写的「今晚」不至于转眼就没）。 */
export const ttlFor = (freshness, now, timeZone) => {
    if (freshness === 'soon') return POCKET_SOON_MS;
    if (freshness === 'today') {
        return Math.min(POCKET_TODAY_MAX_MS, Math.max(POCKET_SOON_MS, msUntilLocalMidnight(now, timeZone)));
    }
    return POCKET_TTL_MS;
};

/**
 * 写给自己的备忘、或者要跟别人说的话，不是「想跟 ta 说的那句」。
 * 实测：「得跟她说一声——别等我吃晚饭」「跟萌宝吐槽一下老徐」「周二跟昂哥吐槽一下……」。
 * 用「她 / 他」称呼对方、通篇没有「你」的，也是在心里自言自语，草稿箱里读着很怪。
 */
export const isSelfNote = (text, userName = '') => {
    const t = String(text ?? '');
    if (/(?:得|要|记得|顺便|回头|到时候)?(?:跟|和|给)[^，。,\s]{0,6}(?:说一声|说一下|讲一下|吐槽一下|提一嘴|提一下)/.test(t)) return true;
    // 只认「她」：「我得提醒他别太晚，老子还有人要陪」说的是别人，正是想跟 ta 说的话
    if (/(?:提醒|告诉|通知)(?:她|ta|TA)/.test(t)) return true;
    if (/^(?:跟|和)[^，。,\s]{1,6}(?:说|吐槽|讲)/.test(t)) return true;
    const name = String(userName ?? '').trim();
    const mentionsHerInThirdPerson = /她|(?<![a-z])ta(?![a-z])/i.test(t) || (name.length >= 2 && t.includes(name));
    return mentionsHerInThirdPerson && !t.includes('你');
};

/** 中文按两字一组、英文按词，粗略比两句话说的是不是一件事。 */
const grams = text => {
    const out = new Set();
    const t = String(text ?? '').toLowerCase();
    for (const word of t.match(/[a-z0-9]{2,}/g) ?? []) out.add(word);
    const han = t.replace(/[^一-鿿]/g, '');
    for (let i = 0; i < han.length - 1; i += 1) out.add(han.slice(i, i + 2));
    return out;
};

/** a 有多少落在 b 里（0–1）。 */
export const coverage = (a, b) => {
    const ga = grams(a);
    if (!ga.size) return 0;
    const gb = grams(b);
    let hit = 0;
    for (const g of ga) if (gb.has(g)) hit += 1;
    return hit / ga.size;
};

/** 跟还没说的某句差不多（「下周六 rank」攒了两遍）就不再攒。 */
const SAME_TOPIC = 0.5;
/** 聊天里说过的话盖住了这句的大半，就算说过了。 */
const ALREADY_SAID = 0.45;

/** 没说过、没过期的，最早的在前。旧数据也按字面保质期再筛一遍（返工前存的都是两天）。 */
export const listUnsaid = (db, charId, now = new Date(), { limit = MAX_UNSAID, userName = '' } = {}) => db.prepare(
    `SELECT * FROM pocket_items
      WHERE char_id = ? AND said_at IS NULL AND expires_at > ?
      ORDER BY created_at ASC, rowid ASC`,
).all(charId, isoOf(now)).map(toItem)
    .filter(item => isFresh(item, now) && !isSelfNote(item.text, userName))
    .slice(0, limit);

/** 按字面保质期看还新不新鲜（入库时已经按这个定过 expires_at；这里兜住返工前的旧行）。 */
const isFresh = (item, now) => {
    const created = Date.parse(item.createdAt);
    const literal = freshnessFromText(item.text);
    const cap = literal === 'soon' ? POCKET_SOON_MS : literal === 'today' ? POCKET_TODAY_MAX_MS : POCKET_TTL_MS;
    return now.getTime() - created < cap;
};

/**
 * 攒一句。空的、写给自己的备忘、跟还没说的某句差不多的不收；超了名额把最旧的那句当作过期。
 * freshness 是模型给的档（soon / today / days），跟字面看出来的取更短的。
 * 返回新条目，没收就返回 null。
 */
export const addPocketItem = (db, {
    charId, text, kind = 'share', sourceJobUuid = null, now = new Date(), freshness = 'today', timeZone = 'UTC', userName = '',
}) => {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, POCKET_TEXT_MAX);
    if (!clean || isSelfNote(clean, userName)) return null;
    const at = isoOf(now);
    const unsaid = listUnsaid(db, charId, now, { limit: 50, userName });
    if (unsaid.some(item => item.text === clean || coverage(clean, item.text) >= SAME_TOPIC)) return null;
    const asked = POCKET_FRESHNESS.includes(freshness) ? freshness : 'today';
    const ttl = ttlFor(shorter(asked, freshnessFromText(clean)), new Date(at), timeZone);
    const id = randomUUID();
    const expiresAt = new Date(new Date(at).getTime() + ttl).toISOString();
    db.prepare(
        `INSERT INTO pocket_items (id, char_id, text, kind, source_job_uuid, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, charId, clean, kind === 'grievance' ? 'grievance' : 'share', sourceJobUuid, at, expiresAt);
    // 超出名额：最旧的那几句就当过去了（过期，不删，排查时还能看到）
    const overflow = unsaid.length + 1 - MAX_UNSAID;
    if (overflow > 0) {
        const expire = db.prepare('UPDATE pocket_items SET expires_at = ? WHERE id = ?');
        for (const item of unsaid.slice(0, overflow)) expire.run(at, item.id);
    }
    return toItem(db.prepare('SELECT * FROM pocket_items WHERE id = ?').get(id));
};

/** 说出口了：之后开口不再拿它，草稿箱也不再显示。 */
export const markSaid = (db, id, now = new Date()) => {
    db.prepare('UPDATE pocket_items SET said_at = ? WHERE id = ? AND said_at IS NULL').run(isoOf(now), id);
};

/**
 * 聊天里其实已经说过了：TA 在私聊里（本地回复、mini 回复、心跳消息都算）攒下这句之后说的话，
 * 盖住了这句的大半，就划掉。messages 是快照里的 recentMessages（role=char 的才算 TA 说的）。
 * 返回划掉了几句。
 */
export const settleSaidFromMessages = (db, charId, messages = [], now = new Date()) => {
    const said = (Array.isArray(messages) ? messages : [])
        .filter(m => m?.role === 'char' && m.text && m.at)
        .map(m => ({ at: Date.parse(m.at), text: String(m.text) }))
        .filter(m => Number.isFinite(m.at));
    if (!said.length) return 0;
    const open = db.prepare(
        'SELECT * FROM pocket_items WHERE char_id = ? AND said_at IS NULL AND expires_at > ?',
    ).all(charId, isoOf(now)).map(toItem);
    let settled = 0;
    for (const item of open) {
        const created = Date.parse(item.createdAt);
        const hit = said.find(m => m.at >= created && coverage(item.text, m.text) >= ALREADY_SAID);
        if (hit) {
            markSaid(db, item.id, new Date(hit.at));
            settled += 1;
        }
    }
    return settled;
};

/**
 * 给手机草稿箱：每个角色还没说、还没过时的那几句。charId 为空时列所有角色的。
 * snapshotsFor(charId) 给出那个角色的快照：先拿它的聊天记录把已经说过的划掉，再按她的名字筛备忘。
 */
export const listPocketForPhone = (db, { charId = null, now = new Date(), snapshotsFor = () => null } = {}) => {
    const charIds = charId
        ? [charId]
        : db.prepare('SELECT DISTINCT char_id FROM pocket_items WHERE said_at IS NULL AND expires_at > ?').all(isoOf(now)).map(r => r.char_id);
    return charIds.flatMap(id => {
        const payload = snapshotsFor(id)?.payload ?? null;
        if (payload?.recentMessages) settleSaidFromMessages(db, id, payload.recentMessages, now);
        return listUnsaid(db, id, now, { limit: 50, userName: payload?.user?.name ?? '' })
            .reverse()
            .slice(0, MAX_UNSAID)
            .map(({ charId: cid, text, kind, createdAt, expiresAt }) => ({ charId: cid, text, kind, createdAt, expiresAt }));
    });
};
