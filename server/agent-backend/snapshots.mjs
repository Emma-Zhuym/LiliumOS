/**
 * 角色近况快照（设计 3.4）。
 *
 * 快照是「最近的样子」，不是记忆：每个角色只留最新的一份，旧的直接被盖掉。
 * 两台设备同时上传时按 built_at 比大小，晚到的旧快照会被拒收（409），
 * 免得平板上那份两小时前的近况把手机刚传的盖回去。
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

const MAX_RECENT_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 500;

/**
 * 收下前先规整一遍。这里只做两件与安全有关的事：
 * 1. 边界必须是**确认过**的（没有 confirmedAt 就丢掉）——没确认的「关系设定」
 *    一旦进了提示词，角色会把它当成事实说出口。
 * 2. 推测出来的未完事项一律按未确认处理，前端传 true 也改回 false。
 */
export const normalizeSnapshotPayload = payload => {
    const source = payload && typeof payload === 'object' ? payload : {};
    const out = { ...source };

    if (Array.isArray(source.boundaries)) {
        out.boundaries = source.boundaries
            .filter(item => item && typeof item.text === 'string' && item.confirmedAt)
            .map(item => ({
                text: String(item.text).slice(0, MAX_MESSAGE_CHARS),
                kind: item.kind || 'preference',
                confirmedAt: item.confirmedAt,
                source: item.source || 'settings',
            }));
    }

    if (Array.isArray(source.openThreads)) {
        out.openThreads = source.openThreads
            .filter(item => item && typeof item.text === 'string')
            .map(item => ({
                text: String(item.text).slice(0, MAX_MESSAGE_CHARS),
                source: item.source === 'user_said' || item.source === 'char_said' ? item.source : 'inferred',
                // 推测的永远是未确认；这条由服务端强制，不信前端。
                confirmed: item.source === 'inferred' ? false : item.confirmed === true,
                messageId: item.messageId ?? null,
            }));
    }

    // 私人生活里认识的人（circle）和同事（coworkers，只用于朋友圈评论）：只收名字、称呼、分组，最多 20 个。
    for (const key of ['circle', 'coworkers']) {
        if (!Array.isArray(source[key])) continue;
        out[key] = source[key]
            .filter(item => item && typeof item.name === 'string' && item.name.trim())
            .slice(0, 20)
            .map(item => ({
                name: String(item.name).trim().slice(0, 40),
                ...(item.relation ? { relation: String(item.relation).slice(0, 20) } : {}),
                ...(item.group ? { group: String(item.group).slice(0, 12) } : {}),
            }));
    }

    if (Array.isArray(source.recentMessages)) {
        out.recentMessages = source.recentMessages
            .slice(-MAX_RECENT_MESSAGES)
            .map(item => ({
                role: item?.role === 'user' ? 'user' : 'char',
                at: item?.at ?? null,
                text: String(item?.text ?? '').slice(0, MAX_MESSAGE_CHARS),
            }));
    }

    return out;
};

export const putSnapshot = (db, {
    charId,
    schemaVersion = SNAPSHOT_SCHEMA_VERSION,
    builtAt,
    payload,
    sourceDevice = null,
}, now = new Date()) => {
    if (!builtAt || !Number.isFinite(Date.parse(builtAt))) {
        throw Object.assign(new Error('缺少合法的 builtAt'), { code: 'BAD_REQUEST', status: 400 });
    }
    const existing = db.prepare('SELECT built_at FROM char_snapshots WHERE char_id = ?').get(charId);
    if (existing && Date.parse(builtAt) < Date.parse(existing.built_at)) {
        throw Object.assign(new Error('这份快照比库里那份旧，已拒收'), {
            code: 'STALE_SNAPSHOT', status: 409,
        });
    }
    const normalized = normalizeSnapshotPayload(payload);
    db.prepare(
        `INSERT INTO char_snapshots (char_id, schema_version, built_at, payload, source_device, received_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(char_id) DO UPDATE SET
            schema_version = excluded.schema_version,
            built_at       = excluded.built_at,
            payload        = excluded.payload,
            source_device  = excluded.source_device,
            received_at    = excluded.received_at`,
    ).run(charId, schemaVersion, builtAt, JSON.stringify(normalized), sourceDevice, now.toISOString());
    return { charId, builtAt, receivedAt: now.toISOString() };
};

export const getSnapshot = (db, charId) => {
    const row = db.prepare('SELECT * FROM char_snapshots WHERE char_id = ?').get(charId);
    if (!row) return null;
    let payload = {};
    try {
        payload = JSON.parse(row.payload);
    } catch {
        // 存坏了当没有：心跳会因为「没有快照」这道闸安静跳过，比拿半份近况去猜好。
        return null;
    }
    return {
        charId: row.char_id,
        schemaVersion: row.schema_version,
        builtAt: row.built_at,
        receivedAt: row.received_at,
        sourceDevice: row.source_device,
        payload,
    };
};

/** 列表只报「有没有、多新」，不回读正文：近况里有聊天内容，没必要在接口上到处散。 */
export const listSnapshotMeta = db =>
    db.prepare('SELECT char_id, schema_version, built_at, received_at FROM char_snapshots').all().map(row => ({
        charId: row.char_id,
        schemaVersion: row.schema_version,
        builtAt: row.built_at,
        receivedAt: row.received_at,
    }));
