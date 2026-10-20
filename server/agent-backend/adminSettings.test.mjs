/**
 * 机房 App 的开关（adminSettings.mjs）和配套的状态字段。内存库，跟真库隔离。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getSetting, openDb } from './db.mjs';
import { upsertCharacter } from './characters.mjs';
import { readAdminSettings, writeAdminSettings } from './adminSettings.mjs';
import { createRouter } from './server.mjs';
import { createXhsLoginProbe, parseXhsLogin } from './xhsFeed.mjs';

test('开关：默认值；白名单里的能改，形状不对或不认识的整批拒绝', () => {
    const db = openDb(':memory:');
    assert.deepEqual(readAdminSettings(db), { heartbeatShadow: true, drivesTrial: true, captureRawOnError: false, quietStart: '00:00', quietEnd: '07:00' });
    const next = writeAdminSettings(db, { heartbeatShadow: false, drivesTrial: false, quietEnd: '06:30' });
    assert.equal(next.heartbeatShadow, false);
    assert.equal(next.drivesTrial, false);
    assert.equal(next.quietEnd, '06:30');
    assert.equal(getSetting(db, 'heartbeat_shadow'), JSON.stringify({ enabled: false }));
    assert.throws(() => writeAdminSettings(db, { drivesTrial: true, temporal_visibility: {} }), /不能从手机上改/);
    assert.equal(readAdminSettings(db).drivesTrial, false, '有一项不行就整批不改');
    assert.throws(() => writeAdminSettings(db, { quietStart: '25:00' }), /不能从手机上改/);
    assert.throws(() => writeAdminSettings(db, { heartbeatShadow: 'false' }), /不能从手机上改/);
    assert.throws(() => writeAdminSettings(db, {}), /没有要改的/);
});

test('路由：GET / POST /settings；GET /characters 带上下一跳几点', () => {
    const db = openDb(':memory:');
    upsertCharacter(db, { charId: 'lumi', displayName: '露米', runtime: 'api', credRef: 'lumi' });
    db.prepare(
        `INSERT INTO jobs (uuid, kind, char_id, run_at, status, created_by, created_at, updated_at)
         VALUES ('h1', 'heartbeat', 'lumi', '2026-10-20T20:00:00.000Z', 'pending', 'test', ?, ?)`,
    ).run(new Date().toISOString(), new Date().toISOString());
    const routes = createRouter({ db, config: {} });
    assert.equal(routes['GET /settings'].handle({}).settings.heartbeatShadow, true);
    assert.equal(routes['POST /settings'].handle({ body: { settings: { heartbeatShadow: false } } }).settings.heartbeatShadow, false);
    const [lumi] = routes['GET /characters'].handle({}).characters;
    assert.equal(lumi.nextHeartbeatAt, '2026-10-20T20:00:00.000Z');
});

test('小红书登录：读得出没登录；查一次要开浏览器，所以先报缓存、过期了后台再查', async () => {
    assert.equal(parseXhsLogin({ content: [{ type: 'text', text: '❌ 未登录，请扫码' }] }), 'need_login');
    assert.equal(parseXhsLogin({ content: [{ type: 'text', text: '✅ 已登录\n用户名: 阿萌' }] }), 'logged_in');
    let clock = 0;
    let calls = 0;
    const xhs = { callTool: async () => { calls += 1; return { content: [{ type: 'text', text: '✅ 已登录' }] }; } };
    const probe = createXhsLoginProbe(xhs, { ttlMs: 1000, now: () => clock });
    assert.equal(probe.peek().state, 'checking', '第一次先报在查');
    await probe.check();
    assert.equal(probe.peek().state, 'logged_in');
    assert.equal(calls, 1, '没过期不再查');
    clock = 2000;
    probe.peek();
    await probe.check();
    assert.equal(calls, 2, '过期了再查一次');
    const down = createXhsLoginProbe({ callTool: async () => { throw new Error('ECONNREFUSED'); } });
    await down.check();
    assert.equal(down.peek().state, 'unreachable');
});
