/**
 * 话兜：TA 过日子时攒下、还没跟阿萌说的话（docs/spec-character-drives.md 4.2）。
 *
 * 心跳原来开口时只看得到上一轮对话，于是每次找她都是接话头，从不分享自己的日常。
 * 真人是攒话的：今天被同事气到了、刷到一个好笑的，想着「等会儿跟她说」。
 * 这里就是那个「等会儿」——过日子的那一跳顺手写一句 tellLater 进来，开口的那一跳拿出来。
 *
 * 查手机的草稿箱读的也是这里：没发出去的那几句。
 */

import { randomUUID } from 'node:crypto';

/** 两天还没说出口的，就过去了：过时的话再说像翻旧账。 */
export const POCKET_TTL_MS = 48 * 60 * 60 * 1000;
/** 同时最多攒这么多；再多就丢最旧的那句。 */
export const MAX_UNSAID = 5;
export const POCKET_TEXT_MAX = 120;

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

/** 没说过、没过期的，最早的在前。 */
export const listUnsaid = (db, charId, now = new Date(), { limit = MAX_UNSAID } = {}) => db.prepare(
    `SELECT * FROM pocket_items
      WHERE char_id = ? AND said_at IS NULL AND expires_at > ?
      ORDER BY created_at ASC, rowid ASC LIMIT ?`,
).all(charId, isoOf(now), limit).map(toItem);

/**
 * 攒一句。空的、和还没说的某句一字不差的不收；超了名额把最旧的那句当作过期。
 * 返回新条目，没收就返回 null。
 */
export const addPocketItem = (db, { charId, text, kind = 'share', sourceJobUuid = null, now = new Date() }) => {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, POCKET_TEXT_MAX);
    if (!clean) return null;
    const at = isoOf(now);
    const unsaid = listUnsaid(db, charId, now, { limit: 50 });
    if (unsaid.some(item => item.text === clean)) return null;
    const id = randomUUID();
    const expiresAt = new Date(new Date(at).getTime() + POCKET_TTL_MS).toISOString();
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

/** 给手机草稿箱：每个角色还没说的那几句。charId 为空时列所有角色的。 */
export const listPocketForPhone = (db, { charId = null, now = new Date() } = {}) => {
    const rows = charId
        ? db.prepare(
            `SELECT * FROM pocket_items WHERE char_id = ? AND said_at IS NULL AND expires_at > ?
              ORDER BY created_at DESC LIMIT ?`,
        ).all(charId, isoOf(now), MAX_UNSAID)
        : db.prepare(
            `SELECT * FROM pocket_items WHERE said_at IS NULL AND expires_at > ?
              ORDER BY created_at DESC LIMIT 100`,
        ).all(isoOf(now));
    return rows.map(row => {
        const { charId: id, text, kind, createdAt } = toItem(row);
        return { charId: id, text, kind, createdAt };
    });
};
