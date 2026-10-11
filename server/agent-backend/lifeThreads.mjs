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
/**
 * 约定（带 due_at 的那种）「到点」的窗口：约定时刻前后各这么久里醒来，这一跳就去做这件事。
 * 心跳 30–90 分钟一跳，±45 分钟基本碰得上；过了窗口还没碰上的算错过了，静默收掉。
 */
export const PLAN_DUE_WINDOW_MS = 45 * 60 * 1000;
/** 约定和「正在推进的事」各算各的名额：约一次饭不该把手上的工作挤掉。 */
export const MAX_OPEN_PLANS = 3;

const toThread = row => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    updatedAt: row.updated_at,
    // 迁移 9 之前的行没有这一列的值：null = 没有时间的「正在推进的事」
    dueAt: row.due_at ?? null,
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
    // 约定：带一个绝对时刻（程序解析好的，不是模型写的字）。没有就是普通的「正在推进的事」。
    const dueAt = input?.dueAt ? new Date(input.dueAt) : null;
    const isPlan = Boolean(dueAt && !Number.isNaN(dueAt.getTime()));
    // 两类各管各的：工作往来抄来的 id 只对得上普通的事，约定也只挤约定的名额。
    const kindClause = isPlan ? 'due_at IS NOT NULL' : 'due_at IS NULL';

    if (shortId) {
        const row = db.prepare(
            `SELECT * FROM life_threads WHERE char_id = ? AND status = 'open' AND ${kindClause} AND id LIKE ? ESCAPE '\\'`,
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
        `SELECT id FROM life_threads WHERE char_id = ? AND status = 'open' AND ${kindClause} ORDER BY updated_at ASC`,
    ).all(charId);
    const limit = isPlan ? MAX_OPEN_PLANS : MAX_OPEN_THREADS;
    for (const stale of open.slice(0, Math.max(0, open.length - (limit - 1)))) {
        db.prepare(`UPDATE life_threads SET status = 'done', updated_at = ? WHERE id = ?`).run(nowIso, stale.id);
    }
    const id = randomUUID();
    db.prepare(
        `INSERT INTO life_threads (id, char_id, title, summary, status, created_at, updated_at, due_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(id, charId, title, summary, nowIso, nowIso, isPlan ? dueAt.toISOString() : null);
    return toThread(db.prepare('SELECT * FROM life_threads WHERE id = ?').get(id));
};

/** 这件事是不是约定（有时间的那种）。 */
export const isPlanThread = thread => Boolean(thread?.dueAt);

/** 约定到点了没有：落在约定时刻前后 PLAN_DUE_WINDOW_MS 之内。 */
export const isPlanDue = (thread, now = new Date()) =>
    isPlanThread(thread) && Math.abs(Date.parse(thread.dueAt) - now.getTime()) <= PLAN_DUE_WINDOW_MS;

/**
 * 过了窗口还开着的约定：那一跳没碰上（mini 睡着、恰好隔得久），静默收掉，
 * 不然「你和林越约了周六下午」会在周日、周一一直挂在提示词里，像是还没到。
 */
export const closePassedPlans = (db, charId, now = new Date()) =>
    db.prepare(
        `UPDATE life_threads SET status = 'done', updated_at = ?
          WHERE char_id = ? AND status = 'open' AND due_at IS NOT NULL AND due_at < ?`,
    ).run(now.toISOString(), charId, new Date(now.getTime() - PLAN_DUE_WINDOW_MS).toISOString()).changes;

/** 这一跳做完了约好的那件事：收尾。 */
export const completeThread = (db, id, now = new Date()) =>
    db.prepare(`UPDATE life_threads SET status = 'done', updated_at = ? WHERE id = ? AND status = 'open'`)
        .run(now.toISOString(), id).changes;

/** 列约定时默认看的窗口：往前一周（日历上还能看到刚做过的），往后两个月。 */
export const PLANS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const PLANS_LOOKAHEAD_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * 所有角色的约定（带 due_at 的那种），给手机的日历和聊天用。按时间正序。
 * status 为 open 是还没到；done 是到点做了或过了窗口收掉的——对日历来说都是「那天有这件事」。
 */
export const listPlans = (db, { from = null, to = null, now = new Date() } = {}) => {
    const fromIso = from && Number.isFinite(Date.parse(from)) ? new Date(from).toISOString()
        : new Date(now.getTime() - PLANS_LOOKBACK_MS).toISOString();
    const toIso = to && Number.isFinite(Date.parse(to)) ? new Date(to).toISOString()
        : new Date(now.getTime() + PLANS_LOOKAHEAD_MS).toISOString();
    return db.prepare(
        `SELECT * FROM life_threads WHERE due_at IS NOT NULL AND due_at >= ? AND due_at <= ? ORDER BY due_at ASC LIMIT 200`,
    ).all(fromIso, toIso).map(row => ({ ...toThread(row), charId: row.char_id }));
};
