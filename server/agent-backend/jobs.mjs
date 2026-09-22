/**
 * 任务队列与调度器。
 *
 * 领取用带条件的 UPDATE + 租约（照抄 amsg 的做法）。本服务目前是单进程，仍然这么做的理由是
 * **崩溃恢复**：断电时留在 running 的行，靠租约过期才能被安全地放回队列，而不是靠猜。
 *
 * 契约见 docs/agent-backend-design.md 第 2.5、4.1 节。
 */

import { randomUUID } from 'node:crypto';

const LEASE_MS = 90 * 1000;
const HEARTBEAT_MS = 30 * 1000;
/** 失败退避：第 1、2、3 次重试分别等这么久。 */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

const iso = date => date.toISOString();

export const createJob = (db, {
    uuid = randomUUID(),
    kind,
    charId = null,
    runAt,
    expiresAt = null,
    missedPolicy = 'catch_up',
    maxAttempts = 3,
    serializeGroup,
    generation = null,
    input = {},
    createdBy,
}, now = new Date()) => {
    const existing = db.prepare('SELECT * FROM jobs WHERE uuid = ?').get(uuid);
    if (existing) return { job: toJob(existing), duplicated: true };
    const nowIso = iso(now);
    db.prepare(
        `INSERT INTO jobs (uuid, kind, char_id, run_at, expires_at, missed_policy, max_attempts,
                           serialize_group, generation, input, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        uuid, kind, charId, runAt, expiresAt, missedPolicy, maxAttempts,
        serializeGroup ?? `${charId ?? 'system'}#${kind}`,
        generation, JSON.stringify(input), createdBy, nowIso, nowIso,
    );
    return { job: toJob(db.prepare('SELECT * FROM jobs WHERE uuid = ?').get(uuid)), duplicated: false };
};

export const toJob = row => row && ({
    id: row.id,
    uuid: row.uuid,
    kind: row.kind,
    charId: row.char_id,
    runAt: row.run_at,
    expiresAt: row.expires_at,
    missedPolicy: row.missed_policy,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    generation: row.generation,
    input: JSON.parse(row.input || '{}'),
    result: row.result ? JSON.parse(row.result) : null,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

export const listJobs = (db, { status = 'all', charId = null, limit = 50 } = {}) => {
    const clauses = [];
    const params = [];
    if (status !== 'all') { clauses.push('status = ?'); params.push(status); }
    if (charId) { clauses.push('char_id = ?'); params.push(charId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
    return db.prepare(`SELECT * FROM jobs ${where} ORDER BY run_at DESC LIMIT ?`).all(...params).map(toJob);
};

export const cancelJob = (db, uuid, now = new Date()) => {
    const changed = db.prepare(
        `UPDATE jobs SET status = 'cancelled', updated_at = ?
          WHERE uuid = ? AND status IN ('pending','running')`,
    ).run(iso(now), uuid);
    return changed.changes > 0;
};

/**
 * 领一条任务。返回 true 表示领到了。
 *
 * 条件里带上读到的 run_at：排期在读和领之间被改过，就不该按旧排期跑。
 * 同分组已有任务持租约时也领不到，保证同一角色同一种任务串行。
 */
export const claim = (db, job, now = new Date()) => {
    const nowIso = iso(now);
    const leaseUntil = iso(new Date(now.getTime() + LEASE_MS));
    const changed = db.prepare(
        `UPDATE jobs
            SET status = 'running', lease_until = ?, attempts = attempts + 1, updated_at = ?
          WHERE id = ? AND status = 'pending' AND run_at = ?
            AND (retry_after IS NULL OR retry_after <= ?)
            AND NOT EXISTS (
                  SELECT 1 FROM jobs busy
                   WHERE busy.serialize_group = jobs.serialize_group AND busy.id <> jobs.id
                     AND busy.status = 'running' AND busy.lease_until > ?)`,
    ).run(leaseUntil, nowIso, job.id, job.runAt, nowIso, nowIso);
    return changed.changes === 1;
};

export const renewLease = (db, jobId, now = new Date()) => {
    const changed = db.prepare(
        `UPDATE jobs SET lease_until = ? WHERE id = ? AND status = 'running' AND lease_until IS NOT NULL`,
    ).run(iso(new Date(now.getTime() + LEASE_MS)), jobId);
    return changed.changes === 1;
};

export const finish = (db, job, { status, result = null, error = null }, now = new Date()) => {
    const nowIso = iso(now);
    if (status === 'failed' && job.attempts < job.maxAttempts) {
        const backoff = BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)];
        db.prepare(
            `UPDATE jobs SET status = 'pending', lease_until = NULL, retry_after = ?,
                             last_error = ?, updated_at = ?
              WHERE id = ?`,
        ).run(iso(new Date(now.getTime() + backoff)), error, nowIso, job.id);
        return 'retry';
    }
    db.prepare(
        `UPDATE jobs SET status = ?, lease_until = NULL, result = ?, last_error = ?, updated_at = ?
          WHERE id = ?`,
    ).run(status, result ? JSON.stringify(result) : null, error, nowIso, job.id);
    return status;
};

/**
 * 启动时收拾上次没跑完的行：还能重试的放回队列，已经用光次数的记失败。
 * 心跳的 max_attempts 是 1，所以崩溃过的心跳一律落在 failed，由下一跳接续（设计 4.2）。
 */
export const recoverStaleLeases = (db, now = new Date()) => {
    const nowIso = iso(now);
    const requeued = db.prepare(
        `UPDATE jobs SET status = 'pending', lease_until = NULL, updated_at = ?
          WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until < ?
            AND attempts < max_attempts`,
    ).run(nowIso, nowIso).changes;
    const failed = db.prepare(
        `UPDATE jobs SET status = 'failed', lease_until = NULL, last_error = 'lease_lost', updated_at = ?
          WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until < ?`,
    ).run(nowIso, nowIso).changes;
    return { requeued, failed };
};

/** 安静时段只拦跟角色有关的任务；看门狗这类系统任务照常跑（设计 4.1）。 */
export const inQuietWindow = (now, { start, end, timezone }) => {
    const local = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
    }).format(now);
    const [hour, minute] = local.split(':').map(Number);
    const minutes = hour * 60 + minute;
    const toMinutes = value => {
        const [h, m] = String(value).split(':').map(Number);
        return h * 60 + m;
    };
    const from = toMinutes(start);
    const to = toMinutes(end);
    // 跨午夜的区间（22:00–07:00）要按「或」判断，别写成单纯的区间比较。
    return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
};

/**
 * 一轮巡逻。返回这轮的处理计数，方便测试和日志。
 *
 * handlers 是 `{ [kind]: async (job, ctx) => result }`。handler 抛错即这次失败，
 * 由 finish 按 max_attempts 决定重试还是终结。
 */
export const runTick = async (db, { handlers, quiet, now = new Date(), logger = console }) => {
    const nowIso = iso(now);
    const summary = { picked: 0, done: 0, failed: 0, expired: 0, skipped: 0 };
    const due = db.prepare(
        `SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ?
          ORDER BY run_at LIMIT 20`,
    ).all(nowIso).map(toJob);

    for (const job of due) {
        if (quiet.active && job.charId) { summary.skipped += 1; continue; }
        if (job.expiresAt && job.expiresAt < nowIso) {
            db.prepare(`UPDATE jobs SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'`)
                .run(nowIso, job.id);
            summary.expired += 1;
            continue;
        }
        if (!claim(db, job, now)) continue;
        summary.picked += 1;

        const handler = handlers[job.kind];
        const beat = setInterval(() => {
            try { renewLease(db, job.id); } catch { /* 续租失败下一轮自然被回收 */ }
        }, HEARTBEAT_MS);
        try {
            if (!handler) throw new Error(`没有注册这种任务的处理器：${job.kind}`);
            const result = await handler({ ...job, attempts: job.attempts + 1 });
            finish(db, { ...job, attempts: job.attempts + 1 }, { status: 'done', result }, new Date());
            summary.done += 1;
        } catch (error) {
            const message = String(error?.message || error).slice(0, 500);
            const outcome = finish(
                db,
                { ...job, attempts: job.attempts + 1 },
                { status: 'failed', error: message },
                new Date(),
            );
            if (outcome !== 'retry') summary.failed += 1;
            logger.warn?.(`[agent] 任务失败 ${job.kind} ${job.uuid}：${message}`);
        } finally {
            clearInterval(beat);
        }
    }
    return summary;
};
