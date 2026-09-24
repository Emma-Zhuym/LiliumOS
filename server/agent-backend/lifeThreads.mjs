/**
 * 「正在推进的事」：角色手头最多三件，跨心跳接着做。
 *
 * 每一跳原本都是失忆的——上一跳写了「领口还要改」，下一跳完全不知道，所以「事情的发展」
 * 永远连不上。这张表只存一句话（标题 + 最新进展），够让下一跳接得上就行；来龙去脉留在
 * 已经生成、已经送到手机上的工作往来里，需要细节回去翻那些（设计 4.5）。
 */

import { randomUUID } from 'node:crypto';

export const MAX_OPEN_THREADS = 3;
/** 30 天没动静的事视为不了了之，静默收掉：不通知，也不算「做完」。 */
export const STALE_THREAD_MS = 30 * 24 * 60 * 60 * 1000;
/** 给模型看的 id 只取前 8 位：整条 uuid 让模型照抄很容易抄错。 */
export const SHORT_ID_LENGTH = 8;

const toThread = row => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    updatedAt: row.updated_at,
});

export const listOpenThreads = (db, charId) =>
    db.prepare(
        `SELECT * FROM life_threads WHERE char_id = ? AND status = 'open' ORDER BY updated_at DESC`,
    ).all(charId).map(toThread);

export const closeStaleThreads = (db, charId, now = new Date()) => {
    const cutoff = new Date(now.getTime() - STALE_THREAD_MS).toISOString();
    return db.prepare(
        `UPDATE life_threads SET status = 'done', updated_at = ?
          WHERE char_id = ? AND status = 'open' AND updated_at < ?`,
    ).run(now.toISOString(), charId, cutoff).changes;
};

/**
 * 应用模型给出的一条进展。
 *
 * - 带 id 且对得上一件还开着的事：更新进展（`done` 就收尾）；
 * - 对不上（id 抄错了、事已经收了、根本没带）：当成开新的一件——**绝不覆盖已经收尾的历史**；
 * - 开新的时手上已经三件了：把最久没动的那件收掉腾位置（`done`，不是删除）；
 * - 「新的一件」本身就写着 done：没有什么可收的，忽略。
 * 返回落库后的那件事，忽略时返回 null。
 */
export const applyThread = (db, charId, input, now = new Date()) => {
    const nowIso = now.toISOString();
    const status = input?.status === 'done' ? 'done' : 'open';
    const title = String(input?.title ?? '').trim().slice(0, 40);
    const summary = String(input?.summary ?? '').trim().slice(0, 200);
    const shortId = String(input?.id ?? '').trim().slice(0, 64);

    if (shortId) {
        const row = db.prepare(
            `SELECT * FROM life_threads WHERE char_id = ? AND status = 'open' AND id LIKE ? ESCAPE '\\'`,
        ).get(charId, `${shortId.replace(/[\\%_]/g, m => `\\${m}`)}%`);
        if (row) {
            db.prepare(
                `UPDATE life_threads SET title = ?, summary = ?, status = ?, updated_at = ? WHERE id = ?`,
            ).run(title || row.title, summary || row.summary, status, nowIso, row.id);
            return toThread(db.prepare('SELECT * FROM life_threads WHERE id = ?').get(row.id));
        }
    }

    if (!title || status === 'done') return null;
    const open = db.prepare(
        `SELECT id FROM life_threads WHERE char_id = ? AND status = 'open' ORDER BY updated_at ASC`,
    ).all(charId);
    for (const stale of open.slice(0, Math.max(0, open.length - (MAX_OPEN_THREADS - 1)))) {
        db.prepare(`UPDATE life_threads SET status = 'done', updated_at = ? WHERE id = ?`).run(nowIso, stale.id);
    }
    const id = randomUUID();
    db.prepare(
        `INSERT INTO life_threads (id, char_id, title, summary, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?)`,
    ).run(id, charId, title, summary, nowIso, nowIso);
    return toThread(db.prepare('SELECT * FROM life_threads WHERE id = ?').get(id));
};
