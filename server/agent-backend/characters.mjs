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
 * 心跳开关与频率的换代规则见设计 3.3：开启 / 关闭 / 改频率都要 `heartbeat_generation + 1`，
 * 并把该角色所有 pending 心跳作废。**关闭也要 +1** 是关键——只把 enabled 置 0 的话，
 * 已经排在队列里的那一跳还会照跑一次，看起来就像「关了还说话」。
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

    // 暂停 / 恢复不换代（设计 3.3 的表最后一行）：恢复时旧链还能接着用。
    if (input.heartbeatPaused !== undefined) {
        sets.push('heartbeat_paused = ?', 'heartbeat_paused_at = ?');
        values.push(input.heartbeatPaused || null, input.heartbeatPaused ? nowIso : null);
    }

    const enabledChanged = input.heartbeatEnabled !== undefined
        && (input.heartbeatEnabled ? 1 : 0) !== existing.heartbeat_enabled;
    const everyMinChanged = input.heartbeatEveryMin !== undefined
        && Number(input.heartbeatEveryMin) !== existing.heartbeat_every_min;
    const bumpGeneration = enabledChanged || everyMinChanged;
    if (bumpGeneration) sets.push('heartbeat_generation = heartbeat_generation + 1');

    if (sets.length === 0) return toCharacter(existing);
    values.push(nowIso, charId);
    // 换代和作废旧心跳必须一起成或一起不成，否则会留下一条认不出代次的孤儿心跳。
    db.exec('BEGIN');
    try {
        db.prepare(`UPDATE characters SET ${sets.join(', ')}, updated_at = ? WHERE char_id = ?`).run(...values);
        if (bumpGeneration) cancelPendingHeartbeats(db, charId, nowIso);
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    return toCharacter(getCharacter(db, charId));
};

/** 作废这个角色所有还没跑的心跳。换代时调用，旧链就此断掉，不会复活。 */
export const cancelPendingHeartbeats = (db, charId, nowIso = new Date().toISOString()) =>
    db.prepare(
        `UPDATE jobs SET status = 'cancelled', updated_at = ?
          WHERE char_id = ? AND kind = 'heartbeat' AND status = 'pending'`,
    ).run(nowIso, charId).changes;

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
