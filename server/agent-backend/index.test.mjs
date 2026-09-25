/**
 * Phase 1a / 1b 回归测试。跑：node --test server/agent-backend/
 *
 * 全部用内存库和假的 fetch，不碰真实 Mac mini、不发真推送。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MIGRATIONS, openDb, shouldNotice, clearNotice } from './db.mjs';
import { authenticate, createPairingCode, putPushSubscription, redeemPairingCode, resetPairingFailures, revokeDevice } from './devices.mjs';
import { ack, enqueue, listUnacked } from './outbox.mjs';
import { claim, createJob, finish, inQuietWindow, recoverStaleLeases, runTick, toJob } from './jobs.mjs';
import { createMcpClient, flattenContent } from './mcp.mjs';
import { createHaWatchdogHandler, createTestPingHandler, probeHomeAssistant } from './kinds.mjs';
import { createApp } from './server.mjs';
import { touchPresence, upsertCharacter } from './characters.mjs';

const freshDb = () => openDb(':memory:');

/** 任务表的 char_id 是外键，凡是给角色排任务的用例都要先登记这个角色。 */
const withChar = (db, charId = 'elias') => {
    upsertCharacter(db, { charId, displayName: charId });
    return charId;
};

const pairedDevice = db => {
    resetPairingFailures();
    const { code } = createPairingCode(db);
    const result = redeemPairingCode(db, { code, deviceName: '测试手机' });
    assert.equal(result.ok, true);
    return result;
};

test('迁移可重复执行，不会重复建表', () => {
    const db = freshDb();
    // 跟着迁移条数走：加了新迁移不该把这条测试也一起改成新的数字。
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    assert.doesNotThrow(() => openDb(':memory:'));
});

test('配对码只能用一次，用过即失效', () => {
    const db = freshDb();
    resetPairingFailures();
    const { code } = createPairingCode(db);
    assert.equal(redeemPairingCode(db, { code, deviceName: 'A' }).ok, true);
    const second = redeemPairingCode(db, { code, deviceName: 'B' });
    assert.equal(second.ok, false);
    assert.equal(second.code, 'PAIRING_CODE_INVALID');
});

test('配对码过期后不能再用', () => {
    const db = freshDb();
    resetPairingFailures();
    const { code } = createPairingCode(db, new Date('2026-09-22T00:00:00Z'));
    const later = new Date('2026-09-22T00:11:00Z');
    assert.equal(redeemPairingCode(db, { code, deviceName: 'A' }, later).ok, false);
});

test('钥匙能认出设备，作废后立刻失效', () => {
    const db = freshDb();
    const first = pairedDevice(db);
    const second = pairedDevice(db);
    assert.equal(authenticate(db, `Bearer ${first.deviceToken}`).id, first.deviceId);
    assert.equal(authenticate(db, 'Bearer 乱写的'), null);
    assert.equal(authenticate(db, ''), null);
    assert.equal(revokeDevice(db, second.deviceId).ok, true);
    assert.equal(authenticate(db, `Bearer ${second.deviceToken}`), null);
});

test('不许作废最后一台有效设备', () => {
    const db = freshDb();
    const only = pairedDevice(db);
    const result = revokeDevice(db, only.deviceId);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'LAST_DEVICE');
});

test('信箱幂等：同一个 messageId 只落一条', () => {
    const db = freshDb();
    const first = enqueue(db, { messageId: 'm1', kind: 'system_notice', payload: { text: '嗨' } });
    const again = enqueue(db, { messageId: 'm1', kind: 'system_notice', payload: { text: '嗨' } });
    assert.equal(first.duplicated, false);
    assert.equal(again.duplicated, true);
    assert.equal(listUnacked(db).length, 1);
});

test('ack 之后不再出现在未读列表', () => {
    const db = freshDb();
    const device = pairedDevice(db);
    enqueue(db, { messageId: 'm1', kind: 'system_notice', payload: {} });
    enqueue(db, { messageId: 'm2', kind: 'system_notice', payload: {} });
    assert.equal(ack(db, ['m1'], device.deviceId).acked, 1);
    const rest = listUnacked(db);
    assert.deepEqual(rest.map(m => m.messageId), ['m2']);
    // 重复 ack 不报错，也不会把已读的再数一遍
    assert.equal(ack(db, ['m1'], device.deviceId).acked, 0);
});

test('任务 uuid 幂等', () => {
    const db = freshDb();
    const args = { uuid: 'j1', kind: 'test.ping', runAt: new Date().toISOString(), createdBy: 'cli' };
    assert.equal(createJob(db, args).duplicated, false);
    assert.equal(createJob(db, args).duplicated, true);
});

test('领取：同一条任务只能被领走一次', () => {
    const db = freshDb();
    const { job } = createJob(db, { kind: 'test.ping', runAt: new Date().toISOString(), createdBy: 'cli' });
    assert.equal(claim(db, job), true);
    assert.equal(claim(db, job), false);
});

test('领取：同一分组有任务在跑时领不到', () => {
    const db = freshDb();
    const runAt = new Date().toISOString();
    withChar(db);
    const a = createJob(db, { kind: 'test.ping', charId: 'elias', runAt, createdBy: 'cli' }).job;
    const b = createJob(db, { kind: 'test.ping', charId: 'elias', runAt, createdBy: 'cli' }).job;
    assert.equal(claim(db, a), true);
    assert.equal(claim(db, b), false);
});

test('领取：排期被改过就领不到（避免按旧时间跑）', () => {
    const db = freshDb();
    const { job } = createJob(db, { kind: 'test.ping', runAt: new Date().toISOString(), createdBy: 'cli' });
    db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run('2030-01-01T00:00:00.000Z', job.id);
    assert.equal(claim(db, job), false);
});

test('失败会退避重试，用光次数后才终结', () => {
    const db = freshDb();
    const { job } = createJob(db, {
        kind: 'test.ping', runAt: new Date().toISOString(), createdBy: 'cli', maxAttempts: 2,
    });
    assert.equal(finish(db, { ...job, attempts: 1 }, { status: 'failed', error: 'x' }), 'retry');
    assert.equal(toJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id)).status, 'pending');
    assert.equal(finish(db, { ...job, attempts: 2 }, { status: 'failed', error: 'x' }), 'failed');
});

test('心跳式任务 max_attempts=1：崩溃后记失败而不是重排', () => {
    const db = freshDb();
    withChar(db);
    const { job } = createJob(db, {
        uuid: 'hb1', kind: 'heartbeat', charId: 'elias', runAt: new Date().toISOString(),
        createdBy: 'scheduler', maxAttempts: 1,
    });
    claim(db, job);
    db.prepare('UPDATE jobs SET lease_until = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', job.id);
    const recovered = recoverStaleLeases(db);
    assert.deepEqual(recovered, { requeued: 0, failed: 1 });
    assert.equal(toJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id)).status, 'failed');
});

test('还有重试次数的任务，租约丢了会放回队列', () => {
    const db = freshDb();
    const { job } = createJob(db, {
        kind: 'test.ping', runAt: new Date().toISOString(), createdBy: 'cli', maxAttempts: 3,
    });
    claim(db, job);
    db.prepare('UPDATE jobs SET lease_until = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', job.id);
    assert.deepEqual(recoverStaleLeases(db), { requeued: 1, failed: 0 });
});

test('安静时段判断支持跨午夜', () => {
    const opts = { start: '00:00', end: '07:00', timezone: 'America/Chicago' };
    assert.equal(inQuietWindow(new Date('2026-09-22T08:00:00Z'), opts), true);   // 芝加哥 03:00
    assert.equal(inQuietWindow(new Date('2026-09-22T18:00:00Z'), opts), false);  // 芝加哥 13:00
    const overnight = { start: '22:00', end: '07:00', timezone: 'America/Chicago' };
    assert.equal(inQuietWindow(new Date('2026-09-23T04:00:00Z'), overnight), true); // 芝加哥 23:00
});

test('巡逻：安静时段只拦角色任务，系统任务照跑', async () => {
    const db = freshDb();
    const runAt = new Date(Date.now() - 1000).toISOString();
    withChar(db);
    createJob(db, { uuid: 'c1', kind: 'test.ping', charId: 'elias', runAt, createdBy: 'cli' });
    createJob(db, { uuid: 's1', kind: 'ha.watchdog', runAt, createdBy: 'scheduler' });
    const ran = [];
    const summary = await runTick(db, {
        handlers: {
            'test.ping': async () => { ran.push('char'); return {}; },
            'ha.watchdog': async () => { ran.push('system'); return {}; },
        },
        quiet: { active: true },
        logger: { warn() {} },
    });
    assert.deepEqual(ran, ['system']);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.done, 1);
});

test('巡逻：过了最晚执行时间就作废，不补跑', async () => {
    const db = freshDb();
    withChar(db);
    createJob(db, {
        uuid: 'old', kind: 'heartbeat', charId: 'elias',
        runAt: new Date(Date.now() - 3600_000).toISOString(),
        expiresAt: new Date(Date.now() - 1800_000).toISOString(),
        missedPolicy: 'drop', createdBy: 'scheduler',
    });
    let called = false;
    const summary = await runTick(db, {
        handlers: { heartbeat: async () => { called = true; return {}; } },
        quiet: { active: false },
        logger: { warn() {} },
    });
    assert.equal(called, false);
    assert.equal(summary.expired, 1);
});

test('MCP 客户端：握手一次，之后直接调工具', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push(body.method);
        const result = body.method === 'tools/call'
            ? { content: [{ type: 'text', text: '今天没有日程' }] }
            : { protocolVersion: '2025-06-18' };
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
            headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' },
        });
    };
    const client = createMcpClient({ url: 'http://127.0.0.1:8765/mcp', fetchImpl });
    const first = await client.callTool('calendar_events', { action: 'read' });
    await client.callTool('calendar_events', { action: 'read' });
    assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call', 'tools/call']);
    assert.equal(flattenContent(first), '今天没有日程');
    assert.equal(client.sessionId, 'sess-1');
});

test('MCP 客户端：SSE 响应也能读出结果', async () => {
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        const frame = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { ok: true } })}\n\n`;
        return new Response(frame, { headers: { 'content-type': 'text/event-stream' } });
    };
    const client = createMcpClient({ url: 'http://x/mcp', fetchImpl });
    assert.deepEqual(await client.callTool('t', {}), { ok: true });
});

test('连通测试任务：读日历并写进信箱', async () => {
    const db = freshDb();
    const delivered = [];
    const handler = createTestPingHandler({
        appleEvents: { callTool: async () => ({ content: [{ type: 'text', text: '3 个日程' }] }) },
        deliver: async message => { delivered.push(message); return { messageId: message.messageId }; },
    });
    const result = await handler({ uuid: 'job-1' });
    assert.equal(result.ok, true);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].kind, 'system_notice');
    assert.match(delivered[0].payload.detail, /3 个日程/);
});

test('看门狗：连续失败到阈值才重启，且只通知一次', async () => {
    const db = freshDb();
    const delivered = [];
    const restarts = [];
    const handler = createHaWatchdogHandler({
        db,
        config: { homeAssistantUrl: 'http://ha.local', utmVmName: '' },
        deliver: async message => { delivered.push(message); },
        fetchImpl: async () => { throw new Error('connection refused'); },
        execImpl: async (...args) => { restarts.push(args); },
    });
    assert.deepEqual(await handler(), { ok: false, consecutiveFailures: 1 });
    assert.deepEqual(await handler(), { ok: false, consecutiveFailures: 2 });
    const third = await handler();
    assert.equal(third.notified, true);
    assert.equal(delivered.length, 1);
    // 再挂三次也不会重复通知（阿萌已经知道了）
    await handler(); await handler(); await handler();
    assert.equal(delivered.length, 1);
});

test('看门狗：HA 恢复后清掉通知记号，下次故障能再通知', async () => {
    const db = freshDb();
    assert.equal(shouldNotice(db, 'ha_down'), true);
    assert.equal(shouldNotice(db, 'ha_down'), false);
    clearNotice(db, 'ha_down');
    assert.equal(shouldNotice(db, 'ha_down'), true);
});

test('探活：HA 回 401 也算活着（只是没带令牌）', async () => {
    const ok = await probeHomeAssistant('http://ha.local', async () => new Response('', { status: 401 }));
    assert.equal(ok, true);
    const down = await probeHomeAssistant('http://ha.local', async () => { throw new Error('nope'); });
    assert.equal(down, false);
});

// ─── HTTP 层 ─────────────────────────────────────────

const startTestServer = async () => {
    const db = freshDb();
    const ctx = {
        db,
        config: {
            version: '0.1.0', apiVersion: 1, port: 0, host: '127.0.0.1',
            allowedOrigins: ['https://emma-zhuym.github.io'],
        },
        allowedClientKinds: ['test.ping'],
        buildStatus: async () => ({ version: '0.1.0', capabilities: ['jobs'] }),
    };
    const { createServer } = await import('node:http');
    const server = createServer(createApp(ctx));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/agent/v1`;
    return { db, server, base, config: ctx.config, close: () => new Promise(resolve => server.close(resolve)) };
};

test('HTTP：/health 不需要钥匙，其余接口需要', async t => {
    const app = await startTestServer();
    t.after(() => app.close());
    assert.equal((await fetch(`${app.base}/health`)).status, 200);
    assert.equal((await fetch(`${app.base}/devices`)).status, 401);
    assert.equal((await fetch(`${app.base}/不存在`)).status, 404);
});

test('HTTP：配对后能用钥匙访问', async t => {
    const app = await startTestServer();
    t.after(() => app.close());
    resetPairingFailures();
    const { code } = createPairingCode(app.db);
    const paired = await (await fetch(`${app.base}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceName: '阿萌的 iPhone' }),
    })).json();
    assert.equal(paired.ok, true);
    const auth = { Authorization: `Bearer ${paired.data.deviceToken}` };
    const devices = await (await fetch(`${app.base}/devices`, { headers: auth })).json();
    assert.equal(devices.data.devices[0].name, '阿萌的 iPhone');
});

test('HTTP：客户端不能创建心跳这类任务', async t => {
    const app = await startTestServer();
    t.after(() => app.close());
    resetPairingFailures();
    const { code } = createPairingCode(app.db);
    const paired = await (await fetch(`${app.base}/pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceName: 'x' }),
    })).json();
    const headers = { Authorization: `Bearer ${paired.data.deviceToken}`, 'Content-Type': 'application/json' };
    const denied = await fetch(`${app.base}/jobs`, {
        method: 'POST', headers, body: JSON.stringify({ kind: 'heartbeat', runAt: new Date().toISOString() }),
    });
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).error.code, 'KIND_NOT_ALLOWED');
    const allowed = await fetch(`${app.base}/jobs`, {
        method: 'POST', headers, body: JSON.stringify({ kind: 'test.ping', runAt: new Date().toISOString() }),
    });
    assert.equal(allowed.status, 200);
});

test('HTTP：PUT 的请求体要真读进来（改日历可见性走的就是 PUT）', async t => {
    const app = await startTestServer();
    t.after(() => app.close());
    resetPairingFailures();
    const { code } = createPairingCode(app.db);
    const paired = await (await fetch(`${app.base}/pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceName: 'x' }),
    })).json();
    const headers = { Authorization: `Bearer ${paired.data.deviceToken}`, 'Content-Type': 'application/json' };
    const saved = await (await fetch(`${app.base}/temporal/visibility`, {
        method: 'PUT', headers, body: JSON.stringify({ calendars: { Learning: 'title' }, lists: {} }),
    })).json();
    assert.deepEqual(saved.data.visibility, { calendars: { Learning: 'title' }, lists: {} });
    const read = await (await fetch(`${app.base}/temporal`, { headers })).json();
    assert.deepEqual(read.data.visibility.calendars, { Learning: 'title' });
    // 浏览器要先问过 PUT 能不能发
    const preflight = await fetch(`${app.base}/temporal/visibility`, {
        method: 'OPTIONS', headers: { Origin: 'https://emma-zhuym.github.io' },
    });
    assert.match(preflight.headers.get('access-control-allow-methods'), /PUT/);
});

test('HTTP：只给白名单里的来源回 CORS 头', async t => {
    const app = await startTestServer();
    t.after(() => app.close());
    const allowed = await fetch(`${app.base}/health`, { headers: { Origin: 'https://emma-zhuym.github.io' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://emma-zhuym.github.io');
    const other = await fetch(`${app.base}/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('角色：登记后才能给它排任务', async t => {
    const app = await startTestServer();
    t.after(() => app.close());
    resetPairingFailures();
    const { code } = createPairingCode(app.db);
    const paired = await (await fetch(`${app.base}/pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceName: 'x' }),
    })).json();
    const headers = { Authorization: `Bearer ${paired.data.deviceToken}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ kind: 'test.ping', charId: 'elias', runAt: new Date().toISOString() });

    const denied = await fetch(`${app.base}/jobs`, { method: 'POST', headers, body });
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).error.code, 'UNKNOWN_CHARACTER');

    await fetch(`${app.base}/characters/upsert`, {
        method: 'POST', headers, body: JSON.stringify({ charId: 'elias', displayName: 'Elias' }),
    });
    assert.equal((await fetch(`${app.base}/jobs`, { method: 'POST', headers, body })).status, 200);
});

test('在场信号用服务端时间，且只增不减', () => {
    const db = freshDb();
    withChar(db);
    const later = new Date('2026-09-22T12:00:00.000Z');
    assert.equal(touchPresence(db, 'elias', later), true);
    // 迟到的旧信号不许把时间往回拨
    assert.equal(touchPresence(db, 'elias', new Date('2026-09-22T11:00:00.000Z')), false);
    const row = db.prepare('SELECT last_user_interaction_at AS at FROM characters WHERE char_id = ?').get('elias');
    assert.equal(row.at, later.toISOString());
});

test('MCP 连不上时，错误信息要指出是哪个服务', async () => {
    const client = createMcpClient({
        url: 'http://127.0.0.1:59999/mcp',
        fetchImpl: async () => { throw new Error('fetch failed'); },
    });
    await assert.rejects(
        () => client.callTool('calendar_events', {}),
        /连不上 MCP 服务（http:\/\/127\.0\.0\.1:59999\/mcp，initialize）/,
    );
});

test('连通测试：日历连不上也照送消息，并写明原因', async () => {
    const delivered = [];
    const handler = createTestPingHandler({
        appleEvents: { callTool: async () => { throw new Error('连不上 MCP 服务'); } },
        deliver: async message => { delivered.push(message); },
    });
    const result = await handler({ uuid: 'job-2' });
    assert.equal(result.ok, true);
    assert.equal(result.calendarOk, false);
    assert.equal(delivered.length, 1);
    assert.match(delivered[0].payload.detail, /日历桥接连不上/);
});

test('端口被占用时给出可读提示，而不是崩溃堆栈', async t => {
    const app = await startTestServer();
    t.after(() => app.close());
    const { startServer } = await import('./server.mjs');
    const ctx = {
        db: app.db,
        config: { ...app.config, host: '127.0.0.1', port: app.server.address().port },
        allowedClientKinds: [],
        buildStatus: async () => ({}),
    };
    const fatal = await new Promise(resolve => {
        const second = startServer(ctx, { onFatal: resolve });
        t.after(() => second.close());
    });
    assert.match(fatal, /已被占用/);
});
