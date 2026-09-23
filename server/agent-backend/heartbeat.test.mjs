/**
 * 心跳的单测（阶段 1c）。
 *
 * 重点全在「该闭嘴的时候闭嘴」：六道闸、代次作废、链子不断。
 * 全部用内存库 + 假时钟 + 假 fetch，不碰真设备、不调真模型、不发真推送。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb, setSetting } from './db.mjs';
import { toCharacter, upsertCharacter } from './characters.mjs';
import { createJob, listJobs } from './jobs.mjs';
import { enqueue } from './outbox.mjs';
import { putSnapshot, normalizeSnapshotPayload } from './snapshots.mjs';
import {
    ACTIVE_CHAT_WINDOW_MS, buildPrompt, checkGates, createHeartbeatHandler, heartbeatUuid, inSleepWindow,
    formatGap, jitterRatio, lastRealInteractionAt, listModelRuns, nextRunAt, recordModelRun, shouldCaptureRaw,
} from './heartbeat.mjs';
import { chatCompletionsUrl, createApiRunner, parseHeartbeatOutput } from './runner.mjs';

const AT = new Date('2026-09-23T20:00:00.000Z');          // 芝加哥时间 15:00，醒着
const CHAR = 'lumi';

const freshDb = () => openDb(':memory:');

const seedCharacter = (db, overrides = {}) => {
    upsertCharacter(db, { charId: CHAR, displayName: '露米', runtime: 'api', credRef: 'lumi' });
    upsertCharacter(db, { charId: CHAR, heartbeatEnabled: true, ...overrides });
    return toCharacter(db.prepare('SELECT * FROM characters WHERE char_id = ?').get(CHAR));
};

const seedSnapshot = (db, payload = {}, at = AT) => putSnapshot(db, {
    charId: CHAR,
    builtAt: new Date(at.getTime() - 60_000).toISOString(),
    payload: {
        identity: { name: '露米', persona: '……' },
        user: { name: '阿萌' },
        timezone: 'America/Chicago',
        sleepWindow: { start: '00:30', end: '08:00' },
        ...payload,
    },
}, at);

const getSnapshotRow = db => ({
    receivedAt: db.prepare('SELECT received_at FROM char_snapshots WHERE char_id = ?').get(CHAR).received_at,
});

test('闸门：全都通过时才返回 null', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db);
    const snapshot = { receivedAt: getSnapshotRow(db).receivedAt, payload: { timezone: 'America/Chicago', sleepWindow: { start: '00:30', end: '08:00' } } };
    assert.equal(checkGates(db, { character, snapshot, now: AT }), null);
});

test('闸门：没有快照就不动脑', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    assert.equal(checkGates(db, { character, snapshot: null, now: AT }), 'no_snapshot');
});

test('闸门：角色在睡觉时安静跳过', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const snapshot = {
        receivedAt: AT.toISOString(),
        payload: { timezone: 'America/Chicago', sleepWindow: { start: '00:30', end: '08:00' } },
    };
    // 芝加哥时间凌晨 3 点，落在 00:30–08:00 里。
    const night = new Date('2026-09-23T08:00:00.000Z');
    assert.equal(checkGates(db, { character, snapshot, now: night }), 'sleeping');
});

test('闸门：阿萌正在聊天时绝不插话', () => {
    const db = freshDb();
    seedCharacter(db);
    // 在场信号写的是服务端时间，10 分钟前刚聊过。
    db.prepare('UPDATE characters SET last_user_interaction_at = ? WHERE char_id = ?')
        .run(new Date(AT.getTime() - 10 * 60_000).toISOString(), CHAR);
    const character = toCharacter(db.prepare('SELECT * FROM characters WHERE char_id = ?').get(CHAR));
    const snapshot = { receivedAt: AT.toISOString(), payload: { timezone: 'America/Chicago' } };
    assert.equal(checkGates(db, { character, snapshot, now: AT }), 'active_chat');

    // 超过窗口就不再拦。
    const later = new Date(AT.getTime() + ACTIVE_CHAT_WINDOW_MS + 60_000);
    assert.equal(checkGates(db, { character, snapshot, now: later }), null);
});

test('闸门：手机时钟跑快也封不死心跳（快照时间夹到 received_at）', () => {
    const character = { charId: CHAR, lastUserInteractionAt: null };
    const snapshot = {
        receivedAt: '2026-09-23T20:00:00.000Z',
        // 手机说「一小时后刚聊过」——不可能，按收到那一刻算。
        payload: { lastInteraction: { userAt: '2026-09-23T21:00:00.000Z' } },
    };
    assert.equal(lastRealInteractionAt(character, snapshot).toISOString(), '2026-09-23T20:00:00.000Z');
});

test('闸门：距上一条主动消息不足冷却时间就跳过', () => {
    const db = freshDb();
    const character = seedCharacter(db, { messageCooldownMin: 90 });
    const snapshot = { receivedAt: AT.toISOString(), payload: { timezone: 'America/Chicago' } };
    enqueue(db, {
        messageId: 'm1', charId: CHAR, kind: 'chat_message', payload: { text: '在吗' },
    }, new Date(AT.getTime() - 30 * 60_000));
    assert.equal(checkGates(db, { character, snapshot, now: AT }), 'message_cooldown');
});

test('闸门：今天动脑次数用完就跳过，skipped 的不算数', () => {
    const db = freshDb();
    const character = seedCharacter(db, { dailyModelBudget: 2 });
    const snapshot = { receivedAt: AT.toISOString(), payload: { timezone: 'America/Chicago' } };
    const runAt = new Date(AT.getTime() - 60 * 60_000).toISOString();
    recordModelRun(db, { charId: CHAR, runtime: 'api', startedAt: runAt, ok: true, outcome: 'noop' });
    recordModelRun(db, { charId: CHAR, runtime: 'api', startedAt: runAt, ok: true, outcome: 'skipped', skipGate: 'sleeping' });
    assert.equal(checkGates(db, { character, snapshot, now: AT }), null, '被闸门拦下的不该占预算');
    recordModelRun(db, { charId: CHAR, runtime: 'api', startedAt: runAt, ok: true, outcome: 'message' });
    assert.equal(checkGates(db, { character, snapshot, now: AT }), 'daily_budget');
});

test('闸门：暂停中的角色一律不动', () => {
    const db = freshDb();
    const character = { ...seedCharacter(db), heartbeatPaused: 'manual' };
    const snapshot = { receivedAt: AT.toISOString(), payload: {} };
    assert.equal(checkGates(db, { character, snapshot, now: AT }), 'paused');
});

test('睡眠窗口支持跨午夜', () => {
    const tz = 'America/Chicago';
    const window = { start: '23:00', end: '07:00' };
    assert.equal(inSleepWindow(new Date('2026-09-24T05:00:00.000Z'), window, tz), true);  // 当地 0:00
    assert.equal(inSleepWindow(new Date('2026-09-23T20:00:00.000Z'), window, tz), false); // 当地 15:00
});

test('抖动是确定性的：同一跳重算结果一样，且落在 ±20% 内', () => {
    const a = jitterRatio(CHAR, 3, '2026-09-23T20:00:00.000Z');
    const b = jitterRatio(CHAR, 3, '2026-09-23T20:00:00.000Z');
    assert.equal(a, b);
    assert.ok(Math.abs(a) <= 0.2, `抖动越界：${a}`);
    assert.notEqual(a, jitterRatio(CHAR, 4, '2026-09-23T20:00:00.000Z'));
});

test('排下一跳：按角色频率走，试跑提速会整体接管', () => {
    const character = { charId: CHAR, heartbeatGeneration: 1, heartbeatEveryMin: 90 };
    const normal = nextRunAt(character, { now: AT });
    const gapMin = (normal.getTime() - AT.getTime()) / 60_000;
    assert.ok(gapMin >= 72 && gapMin <= 108, `90 分钟 ±20% 应落在 72–108，实际 ${gapMin}`);

    const fast = nextRunAt(character, { now: AT, everyMinOverride: 2 });
    const fastGap = (fast.getTime() - AT.getTime()) / 60_000;
    assert.ok(fastGap >= 1.6 && fastGap <= 2.4, `提速后应在 2 分钟上下，实际 ${fastGap}`);
});

test('排下一跳：落在安静时段就推到 quiet_end 之后', () => {
    const character = { charId: CHAR, heartbeatGeneration: 1, heartbeatEveryMin: 60 };
    const quiet = {
        isQuiet: date => date < new Date('2026-09-24T12:00:00.000Z'),
        nextEndAfter: () => new Date('2026-09-24T12:00:00.000Z'),
    };
    const runAt = nextRunAt(character, { now: new Date('2026-09-24T06:00:00.000Z'), quiet });
    assert.ok(runAt >= new Date('2026-09-24T12:00:00.000Z'), '不该排在安静时段里');
});

test('改频率会换代，并把排着的旧心跳作废', () => {
    const db = freshDb();
    const character = seedCharacter(db, { heartbeatEveryMin: 90 });
    createJob(db, {
        uuid: heartbeatUuid(CHAR, character.heartbeatGeneration, AT),
        kind: 'heartbeat', charId: CHAR, runAt: AT.toISOString(),
        generation: character.heartbeatGeneration, maxAttempts: 1, createdBy: 'scheduler',
    });
    const after = upsertCharacter(db, { charId: CHAR, heartbeatEveryMin: 120 });
    assert.equal(after.heartbeatGeneration, character.heartbeatGeneration + 1);
    assert.equal(listJobs(db, { status: 'pending', charId: CHAR }).length, 0);
    assert.equal(listJobs(db, { status: 'cancelled', charId: CHAR }).length, 1);
});

test('关掉心跳也换代：排着的那一跳不会再跑一次', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    createJob(db, {
        uuid: heartbeatUuid(CHAR, character.heartbeatGeneration, AT),
        kind: 'heartbeat', charId: CHAR, runAt: AT.toISOString(),
        generation: character.heartbeatGeneration, maxAttempts: 1, createdBy: 'scheduler',
    });
    const after = upsertCharacter(db, { charId: CHAR, heartbeatEnabled: false });
    assert.equal(after.heartbeatEnabled, false);
    assert.equal(after.heartbeatGeneration, character.heartbeatGeneration + 1);
    assert.equal(listJobs(db, { status: 'pending', charId: CHAR }).length, 0);
});

test('暂停与恢复不换代', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const paused = upsertCharacter(db, { charId: CHAR, heartbeatPaused: 'manual' });
    assert.equal(paused.heartbeatPaused, 'manual');
    assert.equal(paused.heartbeatGeneration, character.heartbeatGeneration);
    const resumed = upsertCharacter(db, { charId: CHAR, heartbeatPaused: null });
    assert.equal(resumed.heartbeatPaused, null);
    assert.equal(resumed.heartbeatGeneration, character.heartbeatGeneration);
});

const runHandler = async (db, { runner, job, now = AT, scheduled = [] }) => {
    const handler = createHeartbeatHandler({
        db,
        config: { heartbeatTimeoutMs: 1000 },
        runners: { api: runner },
        scheduleNext: (character, at) => scheduled.push({ charId: character.charId, at }),
        now: () => now,
    });
    return handler(job);
};

const jobFor = (generation, uuid = 'hb:test') => ({
    uuid, kind: 'heartbeat', charId: CHAR, generation, attempts: 1,
});

test('心跳：先排下一跳，再判断——模型炸了链子也不断', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db);
    const scheduled = [];
    const runner = { run: async () => ({ ok: false, error: 'boom' }) };
    await assert.rejects(
        () => runHandler(db, { runner, job: jobFor(character.heartbeatGeneration), scheduled }),
        /boom/,
    );
    assert.equal(scheduled.length, 1, '模型失败也必须已经排好下一跳');
    assert.equal(listModelRuns(db)[0].outcome, 'error');
});

test('心跳：代次不符的旧心跳直接作废，且不续排', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db);
    const scheduled = [];
    const runner = { run: async () => assert.fail('不该调模型') };
    const result = await runHandler(db, {
        runner, job: jobFor(character.heartbeatGeneration - 1), scheduled,
    });
    assert.equal(result.cancelled, 'stale_generation');
    assert.equal(scheduled.length, 0);
});

test('心跳：闸门命中时连模型都不叫，但会记一条 skipped', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    // 没有快照 → no_snapshot
    const runner = { run: async () => assert.fail('不该调模型') };
    const result = await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration) });
    assert.equal(result.skipped, 'no_snapshot');
    const runs = listModelRuns(db);
    assert.equal(runs[0].outcome, 'skipped');
    assert.equal(runs[0].skipGate, 'no_snapshot');
});

test('心跳影子期：判断照常，但不写信箱、不推送', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db);
    const runner = {
        run: async () => ({ ok: true, output: { action: 'message', activity: '给你留了句话', reason: '很久没说话', text: '在忙吗？' } }),
    };
    const result = await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration) });
    assert.equal(result.shadow, true);
    assert.equal(result.action, 'message');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n, 0, '影子期不许写信箱');
    const run = listModelRuns(db)[0];
    assert.equal(run.shadow, true);
    assert.equal(run.proposedText, '在忙吗？');
});

test('影子开关默认是开的，读坏了也按影子算', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', '不是 JSON');
    const character = seedCharacter(db);
    seedSnapshot(db);
    const runner = { run: async () => ({ ok: true, output: { action: 'noop', activity: '发了会儿呆', reason: '没什么可说的' } }) };
    const result = await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration) });
    assert.equal(result.shadow, true);
});

test('快照：未确认的边界会被丢掉，推测事项强制未确认', () => {
    const normalized = normalizeSnapshotPayload({
        boundaries: [
            { text: '我们是恋人', kind: 'relationship', confirmedAt: '2026-09-01T00:00:00.000Z' },
            { text: '没确认过的设定' },
        ],
        openThreads: [
            { text: '周末看展', source: 'user_said', confirmed: true, messageId: 'm1' },
            { text: '也许想换工作', source: 'inferred', confirmed: true },
        ],
    });
    assert.equal(normalized.boundaries.length, 1);
    assert.equal(normalized.openThreads[1].confirmed, false, '推测的一律算未确认');
});

test('快照：更旧的那份会被拒收', () => {
    const db = freshDb();
    seedCharacter(db);
    putSnapshot(db, { charId: CHAR, builtAt: '2026-09-23T20:00:00.000Z', payload: {} });
    assert.throws(
        () => putSnapshot(db, { charId: CHAR, builtAt: '2026-09-23T18:00:00.000Z', payload: {} }),
        /已拒收/,
    );
});

test('模型输出：掉格式也能解析出来', () => {
    assert.equal(parseHeartbeatOutput('{"action":"noop","activity":"看了会儿书","reason":"没事"}').ok, true);
    const fenced = parseHeartbeatOutput('好的：\n```json\n{"action":"noop","activity":"发呆","reason":"没事"}\n```');
    assert.equal(fenced.ok, true);
    assert.equal(fenced.output.action, 'noop');
    // action=message 但没正文，按解析失败处理，宁可不说话。
    assert.equal(parseHeartbeatOutput('{"action":"message","text":"  "}').ok, false);
    assert.equal(parseHeartbeatOutput('我今天不想说话').ok, false);
});

test('API 运行器：没配凭据就明说，不会去调别的大脑', async () => {
    const runner = createApiRunner({
        config: { secretsDir: '/tmp/definitely-not-here' },
        fetchImpl: async () => assert.fail('不该发请求'),
    });
    const result = await runner.run({ charId: CHAR, credRef: 'lumi', system: '', user: '', schema: {} });
    assert.equal(result.ok, false);
    assert.match(result.error, /还没有配 API 凭据/);
});

test('API 运行器：baseUrl 给到 /v1 或整条地址都认', () => {
    assert.equal(chatCompletionsUrl('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
    assert.equal(
        chatCompletionsUrl('https://api.example.com/v1/chat/completions'),
        'https://api.example.com/v1/chat/completions',
    );
});

test('提示词里的时间用 12 小时制：24 小时制会被模型读成差两小时', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db);
    const snapshot = {
        receivedAt: AT.toISOString(),
        payload: { identity: { name: '露米' }, user: { name: '阿萌' }, timezone: 'America/Chicago' },
    };
    // 芝加哥时间 19:47。
    const prompt = buildPrompt(character, snapshot, new Date('2026-09-23T00:47:00.000Z'));
    assert.ok(prompt.includes('7:47'), `应出现 12 小时制的 7:47：${prompt.slice(0, 200)}`);
    assert.ok(!prompt.includes('19:47'), '不该再出现 24 小时制的 19:47');
});

test('排查开关默认关着，解析失败不留模型原文', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db);
    assert.equal(shouldCaptureRaw(db), false);
    const runner = { run: async () => ({ ok: false, error: '解析不出来', raw: '角色说了一段没格式的话' }) };
    await assert.rejects(() => runHandler(db, { runner, job: jobFor(character.heartbeatGeneration) }));
    assert.equal(listModelRuns(db)[0].rawOutput, null);
});

test('打开排查开关后，解析失败会留一段原文', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_debug', JSON.stringify({ captureRawOnError: true }));
    const character = seedCharacter(db);
    seedSnapshot(db);
    const runner = { run: async () => ({ ok: false, error: '解析不出来', raw: '角色说了一段没格式的话' }) };
    await assert.rejects(() => runHandler(db, { runner, job: jobFor(character.heartbeatGeneration) }));
    assert.equal(listModelRuns(db)[0].rawOutput, '角色说了一段没格式的话');
});

test('起居注要的 activity 会被记下来', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db);
    const runner = {
        run: async () => ({ ok: true, output: { action: 'noop', activity: '给窗台的花浇了水', reason: '没什么可说的' } }),
    };
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration) });
    assert.equal(listModelRuns(db)[0].activity, '给窗台的花浇了水');
});

test('提示词写明上次说话隔了多久：不写的话角色会把旧对话当成刚刚发生', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const at = new Date('2026-09-23T02:19:00.000Z');
    const snapshot = {
        receivedAt: '2026-09-23T01:43:00.000Z',
        payload: {
            identity: { name: '露米' },
            user: { name: '阿萌' },
            timezone: 'America/Chicago',
            lastInteraction: { userAt: '2026-09-23T01:42:00.000Z' },
            recentMessages: [{ role: 'user', at: '2026-09-23T01:42:00.000Z', text: '我去洗澡了' }],
        },
    };
    const prompt = buildPrompt(character, snapshot, at);
    assert.ok(prompt.includes('37 分钟前'), `应写明间隔：${prompt.slice(-400)}`);
    assert.ok(prompt.includes('不是刚刚'), '要说清那些对话不是刚发生的');
});

test('间隔文案：分钟、小时、天', () => {
    const now = new Date('2026-09-23T12:00:00.000Z');
    assert.equal(formatGap(new Date('2026-09-23T11:30:00.000Z'), now), '30 分钟前');
    assert.equal(formatGap(new Date('2026-09-23T09:00:00.000Z'), now), '3 小时前');
    assert.equal(formatGap(new Date('2026-09-23T08:40:00.000Z'), now), '3 小时 20 分钟前');
    assert.equal(formatGap(new Date('2026-09-21T12:00:00.000Z'), now), '2 天前');
    // 刚说完话时不写「0 分钟前」。
    assert.equal(formatGap(new Date('2026-09-23T11:59:30.000Z'), now), '');
});
