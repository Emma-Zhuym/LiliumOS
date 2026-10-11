/**
 * 配对与设备。
 *
 * 设备钥匙只在配对那一次返回给客户端，库里存 SHA-256。配对码同理：只存哈希，
 * 屏幕上显示的那 6 位数字用完即弃。
 */

import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');

/** 配对码有效期与失败锁定。 */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const FAILURE_LIMIT = 5;
const LOCK_MS = 15 * 60 * 1000;

/** 配对失败计数只在内存里：进程重启即清零，单用户场景够用，也不用为它建表。 */
const failures = { count: 0, lockedUntil: 0 };

export const resetPairingFailures = () => {
    failures.count = 0;
    failures.lockedUntil = 0;
};

/** 生成一个 6 位配对码；返回明文供 CLI 显示，库里只留哈希。 */
export const createPairingCode = (db, now = new Date()) => {
    // randomInt 内部做了拒绝采样，取值均匀；别图省事用 randomBytes % 1e6，那样低位更容易出现。
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString();
    db.prepare('DELETE FROM pairing_codes WHERE expires_at <= ?').run(now.toISOString());
    db.prepare('INSERT INTO pairing_codes (code_hash, expires_at) VALUES (?, ?)')
        .run(sha256(code), expiresAt);
    return { code, expiresAt };
};

/**
 * 用配对码换一把设备钥匙。
 *
 * 配对码一次性：领走时在同一条 UPDATE 里标记 used_at，重放同一个码不会再拿到第二把钥匙。
 */
export const redeemPairingCode = (db, { code, deviceName }, now = new Date()) => {
    const nowIso = now.toISOString();
    if (failures.lockedUntil > now.getTime()) {
        return { ok: false, code: 'PAIRING_LOCKED', message: '配对失败次数过多，请稍后再试' };
    }
    const claimed = db.prepare(
        `UPDATE pairing_codes SET used_at = ?
          WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
    ).run(nowIso, sha256(code), nowIso);
    if (claimed.changes === 0) {
        failures.count += 1;
        if (failures.count >= FAILURE_LIMIT) {
            failures.lockedUntil = now.getTime() + LOCK_MS;
            failures.count = 0;
        }
        return { ok: false, code: 'PAIRING_CODE_INVALID', message: '配对码无效或已过期' };
    }
    resetPairingFailures();

    const deviceId = randomUUID();
    const deviceToken = randomBytes(32).toString('base64url');
    db.prepare(
        `INSERT INTO devices (id, name, token_hash, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
    ).run(deviceId, String(deviceName || '未命名设备').slice(0, 60), sha256(deviceToken), nowIso, nowIso);
    return { ok: true, deviceId, deviceToken };
};

/** 认钥匙。返回设备行或 null；顺手刷新 last_seen_at。 */
export const authenticate = (db, authorizationHeader, now = new Date()) => {
    const raw = String(authorizationHeader || '');
    const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
    if (!token) return null;
    const device = db.prepare(
        'SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL',
    ).get(sha256(token));
    if (!device) return null;
    // 走到这里已经按哈希命中了唯一索引；再做一次定长比较，避免将来改成前缀查找时留下计时侧信道。
    const expected = Buffer.from(device.token_hash, 'utf8');
    const actual = Buffer.from(sha256(token), 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), device.id);
    return device;
};

export const listDevices = db =>
    db.prepare(
        `SELECT id, name, push_status, created_at, last_seen_at, revoked_at
           FROM devices ORDER BY created_at`,
    ).all().map(row => ({
        id: row.id,
        name: row.name,
        pushStatus: row.push_status,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at,
    }));

export const putPushSubscription = (db, deviceId, subscription) => {
    const endpoint = String(subscription?.endpoint || '');
    const p256dh = String(subscription?.keys?.p256dh || '');
    const auth = String(subscription?.keys?.auth || '');
    if (!endpoint || !p256dh || !auth) {
        return { ok: false, code: 'BAD_SUBSCRIPTION', message: '推送订阅缺少 endpoint 或密钥' };
    }
    db.prepare(
        `UPDATE devices SET push_endpoint = ?, push_p256dh = ?, push_auth = ?, push_status = 'active'
          WHERE id = ?`,
    ).run(endpoint, p256dh, auth, deviceId);
    return { ok: true };
};

/**
 * 作废一台设备。
 *
 * 不允许作废最后一台仍有效的设备——那样谁都进不来了，只能回 mini 上用 CLI 重新配对。
 */
export const revokeDevice = (db, deviceId, now = new Date()) => {
    const active = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL').get().n;
    if (active <= 1) {
        return { ok: false, code: 'LAST_DEVICE', message: '这是最后一台有效设备，不能作废' };
    }
    const changed = db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(now.toISOString(), deviceId);
    if (changed.changes === 0) {
        return { ok: false, code: 'DEVICE_NOT_FOUND', message: '设备不存在或已作废' };
    }
    return { ok: true };
};
