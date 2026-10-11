/**
 * 信箱：要告诉阿萌的每一句话先落库，再按设备推送。
 *
 * 送达保证在信箱，不在推送——推送只是「按门铃」。任意一台设备 ack 即视为送达
 * （聊天记录在设备之间由 LiliumOS 自己的备份/同步流转，不归本服务管）。
 */

import { randomUUID } from 'node:crypto';

/** 保留期：已 ack 7 天，全部 28 天。与 amsg 对齐，重装 PWA 也还补得回来。 */
const ACKED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ALL_RETENTION_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * 写一条消息进信箱。
 *
 * `messageId` 由调用方给定时即为幂等键：同一条结果被投递两次（重试、对账补记）不会变成两条。
 */
export const enqueue = (db, {
    messageId = randomUUID(),
    charId = null,
    jobUuid = null,
    kind,
    payload,
    notify = true,
}, now = new Date()) => {
    const existing = db.prepare('SELECT id, message_id FROM outbox WHERE message_id = ?').get(messageId);
    if (existing) return { messageId, id: existing.id, duplicated: true };
    const result = db.prepare(
        `INSERT INTO outbox (message_id, char_id, job_uuid, kind, payload, notify, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(messageId, charId, jobUuid, kind, JSON.stringify(payload), notify ? 1 : 0, now.toISOString());
    return { messageId, id: Number(result.lastInsertRowid), duplicated: false };
};

export const listUnacked = (db, { after = 0, limit = 50 } = {}) =>
    db.prepare(
        `SELECT id, message_id, char_id, job_uuid, kind, payload, created_at
           FROM outbox
          WHERE acked_at IS NULL AND id > ?
          ORDER BY id
          LIMIT ?`,
    ).all(Number(after) || 0, Math.min(Math.max(Number(limit) || 50, 1), 200))
        .map(row => ({
            id: row.id,
            messageId: row.message_id,
            charId: row.char_id,
            jobUuid: row.job_uuid,
            kind: row.kind,
            payload: JSON.parse(row.payload),
            createdAt: row.created_at,
        }));

export const ack = (db, messageIds, deviceId, now = new Date()) => {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return { acked: 0 };
    const statement = db.prepare(
        'UPDATE outbox SET acked_at = ?, acked_by = ? WHERE message_id = ? AND acked_at IS NULL',
    );
    let acked = 0;
    db.exec('BEGIN');
    try {
        for (const messageId of messageIds.slice(0, 200)) {
            acked += statement.run(now.toISOString(), deviceId, String(messageId)).changes;
        }
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    return { acked };
};

export const cleanup = (db, now = new Date()) => {
    const acked = new Date(now.getTime() - ACKED_RETENTION_MS).toISOString();
    const all = new Date(now.getTime() - ALL_RETENTION_MS).toISOString();
    db.prepare('DELETE FROM outbox WHERE acked_at IS NOT NULL AND acked_at < ?').run(acked);
    db.prepare('DELETE FROM outbox WHERE created_at < ?').run(all);
};
