/**
 * 手机「机房」App 能改的那几个开关（阿萌 2026-10-20：开关不该只能在 mini 终端里敲命令改）。
 *
 * 只认白名单里的键、只认对应的形状，别的一律拒绝——后端的设置表里还有可见性、看门狗这些，
 * 那些有自己的接口或者根本不该从手机上改。每一项写回去之前都重新拼一份，不把手机送来的对象原样存。
 */

import { getSetting, setSetting } from './db.mjs';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const readJson = (db, key, fallback) => {
    try { return { ...fallback, ...JSON.parse(getSetting(db, key) || '{}') }; } catch { return { ...fallback }; }
};

/** 键 → 怎么从手机送来的值里取出能存的那份（取不出就返回 null = 拒绝）。 */
const WRITERS = {
    // 心跳只试跑不真发
    heartbeatShadow: value => (typeof value === 'boolean' ? ['heartbeat_shadow', JSON.stringify({ enabled: value })] : null),
    // 劲儿试运行（drives.mjs isDriveTrial）
    drivesTrial: value => (typeof value === 'boolean' ? ['drives_trial', JSON.stringify({ enabled: value })] : null),
    // 解析失败时存模型原文（排查用，查完要关）
    captureRawOnError: value => (typeof value === 'boolean' ? ['heartbeat_debug', JSON.stringify({ captureRawOnError: value })] : null),
    quietStart: value => (typeof value === 'string' && HHMM.test(value) ? ['quiet_start', value] : null),
    quietEnd: value => (typeof value === 'string' && HHMM.test(value) ? ['quiet_end', value] : null),
};

export const ADMIN_SETTING_KEYS = Object.keys(WRITERS);

/** 现在的值（给手机显示）。 */
export const readAdminSettings = db => ({
    heartbeatShadow: readJson(db, 'heartbeat_shadow', { enabled: true }).enabled !== false,
    drivesTrial: readJson(db, 'drives_trial', { enabled: true }).enabled !== false,
    captureRawOnError: readJson(db, 'heartbeat_debug', { captureRawOnError: false }).captureRawOnError === true,
    quietStart: getSetting(db, 'quiet_start') || '00:00',
    quietEnd: getSetting(db, 'quiet_end') || '07:00',
});

/**
 * 改其中几项。有一项不认识或形状不对就整批不改（不留半截），抛 400。
 * 返回改完之后的全部值。
 */
export const writeAdminSettings = (db, patch, now = new Date()) => {
    const entries = Object.entries(patch && typeof patch === 'object' ? patch : {});
    if (!entries.length) throw Object.assign(new Error('没有要改的设置'), { code: 'EMPTY', status: 400 });
    const writes = entries.map(([key, value]) => {
        const write = WRITERS[key]?.(value);
        if (!write) throw Object.assign(new Error(`这一项不能从手机上改：${key}`), { code: 'NOT_ALLOWED', status: 400 });
        return write;
    });
    for (const [key, value] of writes) setSetting(db, key, value, now.toISOString());
    return readAdminSettings(db);
};
