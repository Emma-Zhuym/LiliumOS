/**
 * 角色在后端的登记。
 *
 * 任务表的 char_id 是外键，**先登记角色才能给它排任务**——这样删角色时，它名下
 * 待触发的任务会被一起清掉（amsg 那边吃过「角色删了、云端还给它建门牌」的亏）。
 *
 * Phase 1a/1b 只需要登记本身；心跳字段留着，1c 再用。
 */

const FIELDS = {
    displayName: 'display_name',
    runtime: 'runtime',
    credRef: 'cred_ref',
    heartbeatEnabled: 'heartbeat_enabled',
    heartbeatEveryMin: 'heartbeat_every_min',
    dailyModelBudget: 'daily_model_budget',
    messageCooldownMin: 'message_cooldown_min',
};

export const getCharacter = (db, charId) =>
    db.prepare('SELECT * FROM characters WHERE char_id = ?').get(charId) ?? null;

export const characterExists = (db, charId) =>
    Boolean(db.prepare('SELECT 1 FROM characters WHERE char_id = ?').get(charId));

export const listCharacters = db =>
    db.prepare('SELECT * FROM characters ORDER BY display_name').all().map(toCharacter);

export const toCharacter = row => row && ({
    charId: row.char_id,
    displayName: row.display_name,
    runtime: row.runtime,
    credRef: row.cred_ref,
    heartbeatEnabled: row.heartbeat_enabled === 1,
    heartbeatEveryMin: row.heartbeat_every_min,
    heartbeatGeneration: row.heartbeat_generation,
    dailyModelBudget: row.daily_model_budget,
    messageCooldownMin: row.message_cooldown_min,
    lastUserInteractionAt: row.last_user_interaction_at,
    heartbeatPaused: row.heartbeat_paused,
    updatedAt: row.updated_at,
});

/**
 * 新建或更新角色。只写传进来的字段，没传的保持原样。
 *
 * 心跳开关与频率的换代规则（关闭也要 +1）在 1c 实现心跳时一并加进来，
 * 现在这里不碰 heartbeat_generation，免得留下一个只加一半的实现。
 */
export const upsertCharacter = (db, input, now = new Date()) => {
    const charId = String(input.charId || '').trim();
    if (!charId) {
        throw Object.assign(new Error('缺少 charId'), { code: 'BAD_REQUEST', status: 400 });
    }
    const nowIso = now.toISOString();
    const existing = getCharacter(db, charId);
    if (!existing) {
        db.prepare(
            `INSERT INTO characters (char_id, display_name, runtime, cred_ref, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
        ).run(
            charId,
            String(input.displayName || charId).slice(0, 60),
            input.runtime === 'codex' ? 'codex' : 'api',
            input.credRef ?? null,
            nowIso,
        );
        return toCharacter(getCharacter(db, charId));
    }
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(FIELDS)) {
        if (input[key] === undefined) continue;
        sets.push(`${column} = ?`);
        values.push(typeof input[key] === 'boolean' ? (input[key] ? 1 : 0) : input[key]);
    }
    if (sets.length === 0) return toCharacter(existing);
    values.push(nowIso, charId);
    db.prepare(`UPDATE characters SET ${sets.join(', ')}, updated_at = ? WHERE char_id = ?`).run(...values);
    return toCharacter(getCharacter(db, charId));
};

/** 在场信号：用服务端收到的时间，忽略客户端自己报的时刻（手机时钟可能跑快）。 */
export const touchPresence = (db, charId, now = new Date()) => {
    const nowIso = now.toISOString();
    const changed = db.prepare(
        `UPDATE characters
            SET last_user_interaction_at = ?, updated_at = ?
          WHERE char_id = ?
            AND (last_user_interaction_at IS NULL OR last_user_interaction_at < ?)`,
    ).run(nowIso, nowIso, charId, nowIso);
    return changed.changes === 1;
};
