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
    ACTIVE_CHAT_WINDOW_MS, buildPrompt, checkGates, speakBlock, createHeartbeatHandler, heartbeatUuid, inSleepWindow,
    BREAK_COOLDOWN_MIN, currentSlot, decideIntent, formatGap, inBreakWindow, upcomingBreakStarts, jitterRatio, lastRealInteractionAt, listModelRuns, messageChance,
    nextRunAt, recordModelRun, shouldCaptureRaw, decideEpisode, episodeChance, isWorkSlot, lifeChance, pickLifeKind,
} from './heartbeat.mjs';
import { chatCompletionsUrl, createApiRunner, extractContentText, parseEpisode, parseHeartbeatOutput, parseLife } from './runner.mjs';
import { applyThread, closeStaleThreads, listOpenThreads } from './lifeThreads.mjs';

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

test('10 分钟内聊过：照样醒，只是这一跳不开口；过了窗口就能开口', () => {
    const db = freshDb();
    seedCharacter(db);
    // 在场信号写的是服务端时间，5 分钟前刚聊过。
    db.prepare('UPDATE characters SET last_user_interaction_at = ? WHERE char_id = ?')
        .run(new Date(AT.getTime() - 5 * 60_000).toISOString(), CHAR);
    const character = toCharacter(db.prepare('SELECT * FROM characters WHERE char_id = ?').get(CHAR));
    const snapshot = { receivedAt: AT.toISOString(), payload: { timezone: 'America/Chicago' } };
    assert.equal(checkGates(db, { character, snapshot, now: AT }), null, '不再整跳拦下');
    assert.equal(speakBlock(db, { character, snapshot, now: AT }), 'active_chat');
    assert.equal(ACTIVE_CHAT_WINDOW_MS, 10 * 60_000);

    const later = new Date(AT.getTime() + ACTIVE_CHAT_WINDOW_MS);
    assert.equal(speakBlock(db, { character, snapshot, now: later }), null);
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

test('离上一条主动消息太近：照样醒，只是不开口', () => {
    const db = freshDb();
    const character = seedCharacter(db, { messageCooldownMin: 90 });
    const snapshot = { receivedAt: AT.toISOString(), payload: { timezone: 'America/Chicago' } };
    enqueue(db, {
        messageId: 'm1', charId: CHAR, kind: 'chat_message', payload: { text: '在吗' },
    }, new Date(AT.getTime() - 30 * 60_000));
    assert.equal(checkGates(db, { character, snapshot, now: AT }), null);
    assert.equal(speakBlock(db, { character, snapshot, now: AT }), 'message_cooldown');
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
    assert.ok(gapMin >= 45 && gapMin <= 135, `90 分钟 ±50% 应落在 45–135，实际 ${gapMin}`);

    const fast = nextRunAt(character, { now: AT, everyMinOverride: 2 });
    const fastGap = (fast.getTime() - AT.getTime()) / 60_000;
    assert.ok(fastGap >= 1 && fastGap <= 3, `提速后应在 2 分钟上下（±50%），实际 ${fastGap}`);
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

const runHandler = async (db, { runner, job, now = AT, scheduled = [], rng = () => 0.99, deliver = null }) => {
    const handler = createHeartbeatHandler({
        db,
        config: { heartbeatTimeoutMs: 1000 },
        runners: { api: runner },
        scheduleNext: (character, at) => scheduled.push({ charId: character.charId, at }),
        now: () => now,
        rng,
        deliver,
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

test('提示词写死「这段时间什么都没发生」：否则角色会把约定脑补成已完成', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const snapshot = {
        receivedAt: '2026-09-23T02:00:00.000Z',
        payload: {
            identity: { name: '陈照' },
            user: { name: '阿萌' },
            timezone: 'America/Chicago',
            lastInteraction: { userAt: '2026-09-23T02:00:00.000Z' },
            recentMessages: [{ role: 'user', at: '2026-09-23T02:00:00.000Z', text: '我去洗澡了' }],
        },
    };
    const prompt = buildPrompt(character, snapshot, new Date('2026-09-23T03:00:00.000Z'));
    assert.ok(prompt.includes('没有发生过任何互动'), '必须说明这段时间没有互动');
    assert.ok(prompt.includes('已经做完了'), '必须禁止把说好的事当成做完了');
    assert.ok(prompt.includes('还没兑现的约定'), '久等的约定应该成为开口的理由');
});

test('正文是 thinking + text 数组时，只取 text 那块', () => {
    const content = [
        { type: 'thinking', thinking: '她刚说去洗澡……' },
        { type: 'text', text: '{"action":"noop","activity":"在客厅等着","reason":"等她出来"}' },
    ];
    const text = extractContentText(content);
    assert.ok(!text.includes('她刚说去洗澡'), 'thinking 块不该混进正文');
    const parsed = parseHeartbeatOutput(text);
    assert.equal(parsed.ok, true, `应能解析：${text}`);
    assert.equal(parsed.output.activity, '在客厅等着');
});

test('正文是字符串或 {text} 对象时也照样取得到', () => {
    assert.equal(extractContentText('直接是字符串'), '直接是字符串');
    assert.equal(extractContentText({ text: '包一层' }), '包一层');
    assert.equal(extractContentText(null), '');
});

test('开口概率：忙的时候低、闲的时候高，越久没说话越高', () => {
    const busy = messageChance({ availability: 'busy', minutesSinceContact: 120 });
    const free = messageChance({ availability: 'online', minutesSinceContact: 120 });
    assert.ok(free > busy, `闲着应该比忙着更容易开口：${free} vs ${busy}`);

    // 有空时约 40%；刚说完话略低，久了略高，但不大起大落。
    assert.equal(free, 0.4);
    const justTalked = messageChance({ availability: 'online', minutesSinceContact: 10 });
    const longGap = messageChance({ availability: 'online', minutesSinceContact: 8 * 60 });
    assert.ok(justTalked >= 0.25 && justTalked < free, `刚聊完不该压太狠：${justTalked}`);
    assert.ok(longGap > free && longGap <= 0.6, `隔久了略高：${longGap}`);

    // 封顶，避免变成「每两跳必找你一次」。
    assert.ok(messageChance({ availability: 'online', minutesSinceContact: 3 * 24 * 60 }) <= 0.6);
    // 睡着时几乎不开口（真正拦截由 sleeping 闸做，这里只是别再加码）。
    assert.ok(messageChance({ availability: 'offline', minutesSinceContact: 600 }) < 0.1);
});

test('当前时段按日程取，取的是已经开始的最后一段', () => {
    const snapshot = {
        payload: {
            timezone: 'America/Chicago',
            todaySchedule: [
                { start: '09:00', title: '上班', availability: 'busy' },
                { start: '18:00', title: '在家', availability: 'online' },
                { start: '23:00', title: '睡觉', availability: 'offline' },
            ],
        },
    };
    // 芝加哥时间 19:00。
    const slot = currentSlot(snapshot, new Date('2026-09-24T00:00:00.000Z'), 'America/Chicago');
    assert.equal(slot.title, '在家');
});

test('抽签决定开不开口：rng 钉死就能复现', () => {
    const snapshot = {
        payload: {
            timezone: 'America/Chicago',
            todaySchedule: [{ start: '09:00', title: '上班', availability: 'busy' }],
        },
    };
    const args = { snapshot, now: new Date('2026-09-23T18:00:00.000Z'), timezone: 'America/Chicago', minutesSinceContact: 240 };
    assert.equal(decideIntent({ ...args, rng: () => 0 }).intent, 'reach_out');
    assert.equal(decideIntent({ ...args, rng: () => 0.99 }).intent, 'live');
});

test('抽中开口时，提示词让模型去说话而不是再判断一次', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const snapshot = {
        receivedAt: AT.toISOString(),
        payload: { identity: { name: '露米' }, user: { name: '阿萌' }, timezone: 'America/Chicago' },
    };
    const reach = buildPrompt(character, snapshot, AT, 'reach_out');
    assert.ok(reach.includes('决定跟 ta 说句话'), '抽中开口就不该再问「要不要」');
    assert.ok(!reach.includes('沉默是默认选项'));

    const live = buildPrompt(character, snapshot, AT, 'live');
    assert.ok(live.includes('过你自己的日子'), '没抽中就安心过日子');
});

test('意图会记进账，好对照模型最后给了什么', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db);
    const runner = {
        run: async () => ({ ok: true, output: { action: 'noop', activity: '在忙', reason: '没什么' } }),
    };
    // rng=0 必定抽中开口，但模型退回了 noop——这种落差要看得见。
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration), rng: () => 0 });
    const run = listModelRuns(db)[0];
    assert.equal(run.intent, 'reach_out');
    assert.equal(run.outcome, 'noop');
});

test('关掉影子后，message 会真的落信箱并带保质期', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db);
    const sent = [];
    const runner = {
        run: async () => ({ ok: true, output: { action: 'message', activity: '想你了', reason: '很久没说话', text: '在干嘛' } }),
    };
    const result = await runHandler(db, {
        runner, job: jobFor(character.heartbeatGeneration, 'hb:one'), rng: () => 0, deliver: async entry => sent.push(entry),
    });
    assert.equal(result.delivered, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'chat_message');
    assert.equal(sent[0].messageId, 'hb:hb:one', '以任务 uuid 为幂等键');
    assert.equal(sent[0].payload.source, 'heartbeat');
    assert.ok(sent[0].payload.staleAfter > sent[0].payload.createdAt, '要带保质期');
});

test('影子期仍然不发：开关是最后一道闸', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db);
    const sent = [];
    const runner = {
        run: async () => ({ ok: true, output: { action: 'message', activity: '想你了', reason: '', text: '在干嘛' } }),
    };
    await runHandler(db, {
        runner, job: jobFor(character.heartbeatGeneration), rng: () => 0, deliver: async entry => sent.push(entry),
    });
    assert.equal(sent.length, 0);
});

test('上一跳说了「等会儿找 ta」，下一跳不抽签直接去找，并且记得自己想过什么', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db);
    const prompts = [];
    let call = 0;
    const runner = {
        run: async ({ system }) => {
            prompts.push(system);
            call += 1;
            return call === 1
                ? { ok: true, output: { action: 'noop', activity: '在开会', reason: '她在难过，忙完哄她', urge: 'later' } }
                : { ok: true, output: { action: 'noop', activity: '散会了', reason: '', urge: 'none' } };
        },
    };
    // rng=0.99 本来必定抽不中；第二跳仍然要是 reach_out。
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'a'), rng: () => 0.99 });
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'b'), rng: () => 0.99 });
    const [second, first] = listModelRuns(db);
    assert.equal(first.intent, 'live');
    assert.equal(first.urge, 'later');
    assert.equal(second.intent, 'reach_out', '「等会儿」由程序兑现');
    assert.ok(prompts[1].includes('她在难过，忙完哄她'), '下一跳看得到上一跳的心声');
    assert.ok(prompts[1].includes('在开会'));
});

test('念头之后聊过天，就不再欠着', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    recordModelRun(db, {
        charId: CHAR, runtime: 'api', startedAt: new Date(AT.getTime() - 60 * 60_000).toISOString(),
        ok: true, outcome: 'noop', reason: '等会儿找她', urge: 'later',
    });
    const { pendingUrge } = await import('./heartbeat.mjs');
    assert.ok(pendingUrge(db, character.charId, { since: new Date(AT.getTime() - 2 * 60 * 60_000) }));
    assert.equal(pendingUrge(db, character.charId, { since: new Date(AT.getTime() - 10 * 60_000) }), null);
});

test('情绪底色进提示词；没抽中也允许放不下的时候直接开口', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const prompt = buildPrompt(character, { payload: { timezone: 'America/Chicago', mood: '有点委屈，想被哄' } }, AT, 'live');
    assert.ok(prompt.includes('有点委屈，想被哄'));
    assert.ok(prompt.includes('别等'));
    assert.ok(prompt.includes('"later"'));
});

test('urge 解析：未知值一律当 none', () => {
    const later = parseHeartbeatOutput('{"action":"noop","activity":"a","reason":"b","urge":"later"}');
    assert.equal(later.output.urge, 'later');
    const junk = parseHeartbeatOutput('{"action":"noop","activity":"a","reason":"b","urge":"maybe"}');
    assert.equal(junk.output.urge, 'none');
});

test('试跑记录不算 TA 的经历：既不进回看，也不留「等会儿」', async () => {
    const db = freshDb();
    seedCharacter(db);
    recordModelRun(db, {
        charId: CHAR, runtime: 'api', startedAt: new Date(AT.getTime() - 30 * 60_000).toISOString(),
        ok: true, outcome: 'noop', activity: '试跑里的事', reason: '等会儿找她', urge: 'later', shadow: true,
    });
    const { pendingUrge, recentThoughts } = await import('./heartbeat.mjs');
    assert.equal(pendingUrge(db, CHAR), null);
    assert.equal(recentThoughts(db, CHAR, { since: new Date(AT.getTime() - 60 * 60_000) }).length, 0);
});

test('日常节律进提示词：跟聊天日程生成用的是同一份文本', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const prompt = buildPrompt(
        character,
        { payload: { timezone: 'America/Chicago', dailyRhythm: '周二周四必须到公司开会，其余时间较自由' } },
        AT,
        'live',
    );
    assert.ok(prompt.includes('周二周四必须到公司开会'));
});

// ── 午休 / 下班这类「有空」的空档 ──────────────────────────────────────────
// 芝加哥时间的一天：9 点上班（忙）→ 12 点午休（有空）→ 13 点下午（忙）→ 18 点下班（有空）
const WORKDAY = [
    { start: '09:00', end: '12:00', title: '上班', availability: 'busy' },
    { start: '12:00', end: '13:00', title: '午休', availability: 'online' },
    { start: '13:00', end: '18:00', title: '下午工作', availability: 'busy' },
    { start: '18:00', end: '', title: '下班回家', availability: 'online' },
];
const chicago = (h, m = 0) => new Date(Date.UTC(2026, 8, 23, h + 5, m));   // 9 月是 CDT，UTC-5
const workdaySnapshot = { payload: { timezone: 'America/Chicago', todaySchedule: WORKDAY } };

test('空档：午休开始后 90 分钟内算，忙的时段和过了太久都不算', () => {
    assert.equal(inBreakWindow(workdaySnapshot, chicago(12, 20), 'America/Chicago'), true);
    assert.equal(inBreakWindow(workdaySnapshot, chicago(11, 30), 'America/Chicago'), false, '还在上班');
    assert.equal(inBreakWindow(workdaySnapshot, chicago(14, 0), 'America/Chicago'), false, '下午又忙了');
    assert.equal(inBreakWindow(workdaySnapshot, chicago(19, 45), 'America/Chicago'), false, '下班后整晚不能都当空档');
    assert.equal(inBreakWindow({ payload: {} }, chicago(12, 20), 'America/Chicago'), false, '没日程就不认');
});

test('空档：没有从忙转闲，但标题写着午休，也认', () => {
    const lazy = { payload: { todaySchedule: [
        { start: '10:00', title: '打游戏', availability: 'online' },
        { start: '12:00', title: '午休吃饭', availability: 'online' },
    ] } };
    assert.equal(inBreakWindow(lazy, chicago(12, 10), 'America/Chicago'), true);
    assert.equal(inBreakWindow(lazy, chicago(10, 30), 'America/Chicago'), false, '一直闲着的时段不算空档');
});

test('空档：列出今天还没到的空档开头，升序', () => {
    const starts = upcomingBreakStarts(workdaySnapshot, chicago(11, 20), 'America/Chicago');
    assert.deepEqual(starts.map(date => date.toISOString()), [chicago(12).toISOString(), chicago(18).toISOString()]);
    assert.equal(upcomingBreakStarts(workdaySnapshot, chicago(12, 5), 'America/Chicago').length, 1, '已经开始的不再算');
    assert.deepEqual(upcomingBreakStarts({ payload: {} }, chicago(11), 'America/Chicago'), []);
});

test('排下一跳：自然下一跳会错过午休，就挪进午休开头几分钟内', () => {
    const character = { charId: CHAR, heartbeatGeneration: 1, heartbeatEveryMin: 90 };
    const now = chicago(11, 20);                       // 自然下一跳约在 12:32–13:08，已经过了午休开头
    const breakStarts = upcomingBreakStarts(workdaySnapshot, now, 'America/Chicago');
    const runAt = nextRunAt(character, { now, breakStarts });
    const afterStart = (runAt.getTime() - chicago(12).getTime()) / 60_000;
    assert.ok(afterStart >= 3 && afterStart <= 10, `应落在午休开头 3–10 分钟内，实际 ${afterStart}`);
    assert.equal(nextRunAt(character, { now, breakStarts }).getTime(), runAt.getTime(), '同样输入必须同样结果，否则重试会长出两条链');
});

test('排下一跳：空档离得远就不动，试跑提速时也不被日程改写', () => {
    const character = { charId: CHAR, heartbeatGeneration: 1, heartbeatEveryMin: 90 };
    const now = chicago(9, 10);                        // 午休在近 3 小时后，自然下一跳 10:22–10:58，远不到
    const plain = nextRunAt(character, { now });
    assert.equal(nextRunAt(character, { now, breakStarts: upcomingBreakStarts(workdaySnapshot, now, 'America/Chicago') }).getTime(), plain.getTime());

    const soon = chicago(11, 50);
    const fast = nextRunAt(character, { now: soon, everyMinOverride: 2, breakStarts: [chicago(12)] });
    assert.ok((fast.getTime() - soon.getTime()) / 60_000 < 3, '提速试跑不该被挪去午休');
});

test('闸门：午休里冷却缩短，上午那条不再挡住午休', () => {
    const db = freshDb();
    const character = seedCharacter(db, { messageCooldownMin: 90 });
    const snapshot = { receivedAt: chicago(12, 20).toISOString(), payload: { timezone: 'America/Chicago', todaySchedule: WORKDAY } };
    // 上午 11:20 发过一条：午休 12:20 距它 60 分钟——平时 90 分钟冷却会挡，午休里只要 30。
    enqueue(db, { messageId: 'am', charId: CHAR, kind: 'chat_message', payload: { text: '早' } }, chicago(11, 20));
    assert.equal(speakBlock(db, { character, snapshot, now: chicago(12, 20) }), null);
    // 而 12:35 距午休里刚发的 12:20 那条只有 15 分钟：冷却仍然生效，不会连发。
    enqueue(db, { messageId: 'noon', charId: CHAR, kind: 'chat_message', payload: { text: '吃饭了吗' } }, chicago(12, 20));
    assert.equal(speakBlock(db, { character, snapshot, now: chicago(12, 35) }), 'message_cooldown');
    assert.ok(BREAK_COOLDOWN_MIN < 90);
});

test('闸门：不在空档时冷却照旧', () => {
    const db = freshDb();
    const character = seedCharacter(db, { messageCooldownMin: 90 });
    const snapshot = { receivedAt: chicago(15).toISOString(), payload: { timezone: 'America/Chicago', todaySchedule: WORKDAY } };
    enqueue(db, { messageId: 'm', charId: CHAR, kind: 'chat_message', payload: { text: '在吗' } }, chicago(14, 0));
    assert.equal(speakBlock(db, { character, snapshot, now: chicago(15) }), 'message_cooldown');
});

test('开口概率：空档里更高，也不罚「刚说过话」', () => {
    const normal = messageChance({ availability: 'online', minutesSinceContact: 40 });
    const inBreak = messageChance({ availability: 'online', minutesSinceContact: 40, inBreak: true });
    assert.ok(inBreak > normal, `空档 ${inBreak} 应高于平时 ${normal}`);
    assert.equal(inBreak, 0.5);
    assert.ok(messageChance({ availability: 'online', minutesSinceContact: 600, inBreak: true }) <= 0.6, '封顶不变');
});

test('抽签：午休里的意图会带上 inBreak 标记', () => {
    const chosen = decideIntent({
        snapshot: workdaySnapshot, now: chicago(12, 15), timezone: 'America/Chicago', minutesSinceContact: 30, rng: () => 0.3,
    });
    assert.equal(chosen.inBreak, true);
    assert.equal(chosen.intent, 'reach_out', '0.3 < 0.5 该开口；上班时 0.15×0.75 就开不了口');
    const busy = decideIntent({
        snapshot: workdaySnapshot, now: chicago(10), timezone: 'America/Chicago', minutesSinceContact: 30, rng: () => 0.3,
    });
    assert.equal(busy.intent, 'live');
});

test('排下一跳：60 分钟一跳落在 30–90 之间，而且真的散开，不是每次都差不多', () => {
    const character = { charId: CHAR, heartbeatGeneration: 1, heartbeatEveryMin: 60 };
    const gaps = [];
    for (let step = 0; step < 200; step += 1) {
        const now = new Date(AT.getTime() + step * 7 * 60_000);
        gaps.push((nextRunAt(character, { now }).getTime() - now.getTime()) / 60_000);
    }
    assert.ok(gaps.every(gap => gap >= 30 - 1e-6 && gap <= 90 + 1e-6), `越界：${Math.min(...gaps)}–${Math.max(...gaps)}`);
    assert.ok(Math.min(...gaps) < 38 && Math.max(...gaps) > 82, '200 次里应该既有很短的也有很长的');
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    assert.ok(Math.abs(mean - 60) < 4, `平均应接近 60，实际 ${mean}`);
});

test('新角色默认平均 60 分钟一跳、每日预算 24 次', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    assert.equal(character.heartbeatEveryMin, 60);
    assert.equal(character.dailyModelBudget, 24);
});

// ── 工作往来（episode）与「正在推进的事」 ────────────────────────────────────
const EPISODE = {
    channel: 'group', with: '美术组日常',
    lines: [{ who: '小林', text: '第二版出了，看下？' }, { who: '我', text: '配色顺眼了，领口还要改。' }],
    thread: { title: '角色设计修改', summary: '配色通过，领口待改', status: 'open' },
};

test('episode 解析：规整合法的，写坏的只丢这一段不连累整条输出', () => {
    const ok = parseEpisode(EPISODE);
    assert.equal(ok.channel, 'group');
    assert.equal(ok.lines.length, 2);
    assert.equal(ok.thread.status, 'open');
    assert.equal(parseEpisode({ ...EPISODE, channel: 'wechat' }), null, '不认识的渠道');
    assert.equal(parseEpisode({ ...EPISODE, lines: [{ who: '', text: '' }] }), null, '没有可用的句子');
    assert.equal(parseEpisode({ ...EPISODE, thread: { title: '' } }).thread, undefined, '事项写坏了只丢事项');
    assert.equal(parseEpisode({ ...EPISODE, subject: '不该出现' }).subject, undefined, '只有邮件才有主题');
    assert.equal(parseEpisode({ ...EPISODE, channel: 'email', subject: '排期确认' }).subject, '排期确认');
    assert.equal(parseEpisode({ ...EPISODE, lines: Array.from({ length: 20 }, () => ({ who: 'a', text: 'b' })) }).lines.length, 8);

    const whole = parseHeartbeatOutput(JSON.stringify({ action: 'noop', activity: '开会', reason: '', episode: { channel: 'bad' } }));
    assert.equal(whole.ok, true, 'episode 坏了整跳仍然成立');
    assert.equal(whole.output.episode, undefined);
    assert.equal(parseHeartbeatOutput(JSON.stringify({ action: 'noop', activity: 'a', reason: '', episode: EPISODE })).output.episode.with, '美术组日常');
});

test('正在推进的事：最多三件，第四件把最久没动的收掉；对不上的 id 当新事，不覆盖已收尾的', () => {
    const db = freshDb();
    seedCharacter(db);
    const t = minutes => new Date(AT.getTime() + minutes * 60_000);
    const a = applyThread(db, CHAR, { title: 'A', summary: 'a1', status: 'open' }, t(0));
    applyThread(db, CHAR, { title: 'B', summary: 'b1', status: 'open' }, t(1));
    applyThread(db, CHAR, { title: 'C', summary: 'c1', status: 'open' }, t(2));
    assert.equal(listOpenThreads(db, CHAR).length, 3);
    applyThread(db, CHAR, { title: 'D', summary: 'd1', status: 'open' }, t(3));
    const open = listOpenThreads(db, CHAR);
    assert.deepEqual(open.map(x => x.title).sort(), ['B', 'C', 'D'], 'A 最久没动，被收掉');
    assert.equal(db.prepare('SELECT status FROM life_threads WHERE id = ?').get(a.id).status, 'done', '是收掉不是删除');

    // 用 8 位短 id 接着写
    const b = open.find(x => x.title === 'B');
    const updated = applyThread(db, CHAR, { id: b.id.slice(0, 8), title: 'B', summary: 'b2', status: 'open' }, t(4));
    assert.equal(updated.id, b.id);
    assert.equal(updated.summary, 'b2');
    // 收尾
    applyThread(db, CHAR, { id: b.id.slice(0, 8), title: 'B', summary: '搞定', status: 'done' }, t(5));
    assert.equal(listOpenThreads(db, CHAR).some(x => x.title === 'B'), false);
    // 已经收尾的 id 再来：当新事开，不复活旧的
    const again = applyThread(db, CHAR, { id: b.id.slice(0, 8), title: 'B2', summary: '又来了', status: 'open' }, t(6));
    assert.notEqual(again.id, b.id);
    // 新的一件本身就写着 done：没什么可收的
    assert.equal(applyThread(db, CHAR, { title: 'Z', summary: '', status: 'done' }, t(7)), null);
});

test('正在推进的事：30 天没动静就静默收掉', () => {
    const db = freshDb();
    seedCharacter(db);
    applyThread(db, CHAR, { title: '旧事', summary: '', status: 'open' }, new Date(AT.getTime() - 31 * 24 * 3600_000));
    applyThread(db, CHAR, { title: '新事', summary: '', status: 'open' }, new Date(AT.getTime() - 3600_000));
    assert.equal(closeStaleThreads(db, CHAR, AT), 1);
    assert.deepEqual(listOpenThreads(db, CHAR).map(x => x.title), ['新事']);
});

test('抽签：工作时段概率高，别的时段留一点；找阿萌的那一跳不写，offline 不写', () => {
    assert.equal(isWorkSlot({ availability: 'busy', title: '发呆' }), true);
    assert.equal(isWorkSlot({ availability: 'online', title: '下午在公司开会' }), true);
    assert.equal(isWorkSlot({ availability: 'online', title: '打游戏' }), false);
    assert.ok(episodeChance({ workish: true, hasThreads: false }) > episodeChance({ workish: false, hasThreads: false }) * 3);
    assert.ok(episodeChance({ workish: true, hasThreads: true }) > episodeChance({ workish: true, hasThreads: false }), '手头有事更该接着写');
    assert.ok(episodeChance({ workish: true, hasThreads: true }) <= 0.85);

    const args = { snapshot: workdaySnapshot, now: chicago(10), timezone: 'America/Chicago', rng: () => 0.3 };
    assert.equal(decideEpisode({ ...args, intent: 'live' }).wanted, true);
    assert.equal(decideEpisode({ ...args, intent: 'reach_out' }).wanted, false);
    const night = { payload: { todaySchedule: [{ start: '00:00', title: '睡觉', availability: 'offline' }] } };
    assert.equal(decideEpisode({ ...args, snapshot: night, intent: 'live', rng: () => 0 }).wanted, false);
});

test('提示词：手头有事就列出来（带短 id），抽中了才附上写作要求，找阿萌那一跳永远没有', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const snapshot = { payload: { timezone: 'America/Chicago' } };
    const threads = [{ id: 'abcdef1234567890', title: '角色设计修改', summary: '领口待改' }];
    const withEpisode = buildPrompt(character, snapshot, AT, 'live', { threads, episode: true });
    assert.ok(withEpisode.includes('角色设计修改') && withEpisode.includes('abcdef12') && !withEpisode.includes('abcdef1234'));
    assert.ok(withEpisode.includes('episode'));
    assert.ok(withEpisode.includes('不要在里面做出辞职'));
    assert.ok(!buildPrompt(character, snapshot, AT, 'live', { threads, episode: false }).includes('这一跳你正好在处理工作'));
    assert.ok(buildPrompt(character, snapshot, AT, 'live', { threads, episode: false }).includes('角色设计修改'), '不写 episode 也要让 TA 知道手头有事');
    assert.ok(!buildPrompt(character, snapshot, AT, 'reach_out', { threads, episode: true }).includes('这一跳你正好在处理工作'));
});

test('真实执行：抽中且写出 episode → 记事项、静默送去手机；下一跳能接着写这件事', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db, { todaySchedule: WORKDAY });
    const sent = [];
    const prompts = [];
    const runner = { run: async ({ system }) => {
        prompts.push(system);
        return { ok: true, output: { action: 'noop', activity: '在看第二版稿子', reason: '', urge: 'none', episode: parseEpisode(EPISODE) } };
    } };
    // 芝加哥 10 点：上班时段；rng 0.99 抽不中开口，但 0.99 也抽不中 episode——所以给 0.3：live + 抽中工作往来。
    let call = 0;
    const rng = () => (call++ === 0 ? 0.99 : 0.1);   // 第一次给意图（不开口），第二次给 episode（抽中）
    const result = await runHandler(db, {
        runner, job: jobFor(character.heartbeatGeneration, 'w1'), now: chicago(10), rng, deliver: async entry => sent.push(entry),
    });
    assert.equal(result.workDelivered, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].messageId, 'hb:w1:work');
    assert.equal(sent[0].kind, 'job_result');
    assert.equal(sent[0].notify, false, '静默：不按门铃');
    assert.equal(sent[0].payload.type, 'work_episode');
    assert.equal(sent[0].payload.episode.with, '美术组日常');
    assert.equal(sent[0].payload.episode.thread, undefined, '事项走顶层 thread，不重复挂在 episode 上');
    assert.equal(sent[0].payload.thread.title, '角色设计修改');
    assert.equal(listOpenThreads(db, CHAR).length, 1);
    assert.equal(listModelRuns(db)[0].episode.channel, 'group', '审计里留了一份');

    // 下一跳：提示词里带着这件事，并且用短 id 接着写
    call = 0;
    await runHandler(db, {
        runner, job: jobFor(character.heartbeatGeneration, 'w2'), now: chicago(11), rng, deliver: async entry => sent.push(entry),
    });
    assert.ok(prompts[1].includes('角色设计修改') && prompts[1].includes('领口待改'));
});

test('episode：没被要求写就不收；试跑期不落库不送出', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db, { todaySchedule: WORKDAY });
    const sent = [];
    const runner = { run: async () => ({ ok: true, output: { action: 'noop', activity: 'x', reason: '', urge: 'none', episode: parseEpisode(EPISODE) } }) };
    // rng 恒 0.99：意图不开口、episode 也抽不中 → 模型自己加的 episode 不算数
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'n1'), now: chicago(10), rng: () => 0.99, deliver: async e => sent.push(e) });
    assert.equal(sent.length, 0);
    assert.equal(listOpenThreads(db, CHAR).length, 0);

    // 试跑期：抽中了也只记审计
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: true }));
    let call = 0;
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'n2'), now: chicago(10), rng: () => (call++ === 0 ? 0.99 : 0.1), deliver: async e => sent.push(e) });
    assert.equal(sent.length, 0);
    assert.equal(listOpenThreads(db, CHAR).length, 0);
    assert.equal(listModelRuns(db)[0].episode.with, '美术组日常');
});

// ── 实测里丢过的三种输出（库里 raw_output 抓到的原样） ─────────────────────────
test('解析：消息正文写成 message 而不是 text，照样收（实测丢过两条想发的话）', () => {
    const result = parseHeartbeatOutput('```json\n{\n  "action": "message",\n  "activity": "刚醒，还赖在床上看手机。",\n  "reason": "隔了十个小时没说话。",\n  "message": "早安宝宝☀️ 昨晚睡得好不好？"\n}\n```');
    assert.equal(result.ok, true);
    assert.equal(result.output.action, 'message');
    assert.equal(result.output.text, '早安宝宝☀️ 昨晚睡得好不好？');
    assert.equal(parseHeartbeatOutput('{"action":"message","activity":"a","reason":"","content":"睡了没？"}').output.text, '睡了没？');
    assert.equal(parseHeartbeatOutput('{"action":"message","activity":"a","reason":"","text":"","message":"  "}').ok, false, '空话仍然不算');
});

test('解析：值里有没转义的英文引号，整段 JSON 作废了，也把内容抠回来', () => {
    const raw = '```json\n{\n  "activity": "站在书房门口，手搭在门把上",\n  "reason": "她发了个"蹭"过来，我说了先来领一个。现在七点四十五，我想进去看看她。",\n  "action": "noop",\n  "urge": "none"\n}\n```';
    assert.throws(() => JSON.parse(raw.replace(/```(json)?/g, '')), '前提：确实是坏 JSON');
    const result = parseHeartbeatOutput(raw);
    assert.equal(result.ok, true);
    assert.equal(result.output.action, 'noop');
    assert.equal(result.output.activity, '站在书房门口，手搭在门把上');
    assert.ok(result.output.reason.includes('"蹭"'), '引号原样保住');
    assert.ok(result.output.reason.endsWith('看看她。'));
    assert.equal(result.output.urge, 'none');
});

test('解析：想说的话里有引号、又是 message 键，也抠得回来', () => {
    const result = parseHeartbeatOutput('{"action":"message","activity":"在阳台喝酒","reason":"想起她说"困了"","message":"睡了没？说好的"二十分钟"到了"}');
    assert.equal(result.ok, true);
    assert.equal(result.output.text, '睡了没？说好的"二十分钟"到了');
});

test('解析：抠回来的也要过关——不认识的 action、要发消息却没有正文，仍然算失败', () => {
    assert.equal(parseHeartbeatOutput('{"action":"sleep","activity":"a","reason":"含"引号""}').ok, false);
    assert.equal(parseHeartbeatOutput('{"action":"message","activity":"a","reason":"含"引号""}').ok, false);
    assert.equal(parseHeartbeatOutput('完全不是 JSON 的一段话').ok, false);
});

test('解析：坏 JSON 里带 episode 时，不让嵌套的 text 冒充消息正文', () => {
    const result = parseHeartbeatOutput('{"action":"noop","activity":"开会","reason":"他说"晚点"","episode":{"channel":"group","with":"组","lines":[{"who":"小林","text":"看下"}]}}');
    assert.equal(result.ok, true);
    assert.equal(result.output.action, 'noop');
    assert.equal(result.output.text, undefined);
    assert.equal(result.output.episode, undefined, '嵌套结构读不准，宁可丢');
});

// ── 私人生活里的小事（life） ─────────────────────────────────────────────────
test('life 解析：四种小事各自的必填项，写坏只丢这一段', () => {
    const chat = parseLife({ kind: 'chat', with: '老周', relation: '发小', group: 'friend', lines: [{ who: '老周', text: '周末打球？' }, { who: '我', text: '行' }] });
    assert.equal(chat.with, '老周');
    assert.equal(chat.group, 'friend');
    assert.equal(parseLife({ kind: 'chat', with: '老周', lines: [] }), null, '聊天没有句子');
    assert.equal(parseLife({ kind: 'chat', with: '老周', group: 'boss', lines: [{ who: '我', text: 'a' }] }).group, undefined, '不认识的分组丢掉');
    assert.deepEqual(parseLife({ kind: 'delivery', with: '麻辣烫', detail: '加麻加辣', value: '¥32' }), { kind: 'delivery', with: '麻辣烫', detail: '加麻加辣', value: '¥32' });
    assert.equal(parseLife({ kind: 'order', detail: '没有商品名' }), null);
    assert.deepEqual(parseLife({ kind: 'moment', detail: '今天的云很好看' }), { kind: 'moment', detail: '今天的云很好看' });
    assert.equal(parseLife({ kind: 'moment' }), null);
    assert.equal(parseLife({ kind: 'dance', detail: 'x' }), null);
    const whole = parseHeartbeatOutput(JSON.stringify({ action: 'noop', activity: 'a', reason: '', life: { kind: 'bad' } }));
    assert.equal(whole.ok, true);
    assert.equal(whole.output.life, undefined);
});

test('抽签：下班时段多半是生活，上班时段多半是工作；两者共用一次抽签', () => {
    assert.ok(lifeChance({ workish: false }) > lifeChance({ workish: true }) * 4);
    const evening = { payload: { todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] } };
    const at = chicago(20);
    const pick = roll => decideEpisode({ snapshot: evening, now: at, timezone: 'America/Chicago', intent: 'live', rng: () => roll }).kind;
    assert.equal(pick(0.05), 'work', '下班后偶尔也回工作消息');
    assert.equal(pick(0.3), 'life');
    assert.equal(pick(0.9), 'life', '下班后不找她的跳，基本都在过自己的日子');
    assert.equal(decideEpisode({ snapshot: evening, now: at, timezone: 'America/Chicago', intent: 'reach_out', rng: () => 0.3 }).kind, null);
});

test('生活里做什么由程序定：饭点外卖多，别的时候聊天为主，四种都会出现', () => {
    const count = minutes => {
        const seen = {};
        for (let i = 0; i < 100; i += 1) {
            const kind = pickLifeKind(minutes, () => (i + 0.5) / 100);
            seen[kind] = (seen[kind] ?? 0) + 1;
        }
        return seen;
    };
    const dinner = count(18 * 60 + 30);
    const night = count(22 * 60);
    assert.ok(dinner.delivery > night.delivery * 2);
    assert.deepEqual(Object.keys(night).sort(), ['chat', 'delivery', 'moment', 'order']);
    assert.ok(night.chat >= 40);
});

test('提示词：生活那段写明是自己的时间、不提对方，并列出认识的人', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const snapshot = { payload: { timezone: 'America/Chicago', circle: [{ name: '老周', relation: '发小' }] } };
    const prompt = buildPrompt(character, snapshot, AT, 'live', { life: 'chat' });
    assert.ok(prompt.includes('不要提到对方'));
    assert.ok(prompt.includes('老周（发小）'));
    assert.ok(prompt.includes('kind 填 "chat"'));
    assert.ok(buildPrompt(character, snapshot, AT, 'live', { life: 'delivery' }).includes('kind 填 "delivery"'));
    assert.ok(!buildPrompt(character, snapshot, AT, 'reach_out', { life: 'chat' }).includes('私人生活'));
});

test('真实执行：抽中生活 → 静默送去手机；聊天对象是阿萌本人就丢掉', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db, { todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] });
    const sent = [];
    const life = { kind: 'chat', with: '老周', relation: '发小', lines: [{ who: '老周', text: '周末打球？' }, { who: '我', text: '行' }] };
    const runner = { run: async () => ({ ok: true, output: { action: 'noop', activity: '和老周约球', reason: '', urge: 'none', life } }) };
    // rng：意图（不开口）→ 抽签（0.3 落在生活）→ 做什么（0.1 → 聊天）
    const seq = rolls => { let i = 0; return () => rolls[i++] ?? 0.99; };
    const result = await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'l1'), now: chicago(20), rng: seq([0.99, 0.3, 0.1]), deliver: async e => sent.push(e) });
    assert.equal(result.lifeDelivered, true);
    assert.equal(sent[0].messageId, 'hb:l1:life');
    assert.equal(sent[0].notify, false);
    assert.equal(sent[0].payload.type, 'life_episode');
    assert.equal(sent[0].payload.life.with, '老周');
    assert.equal(listModelRuns(db)[0].episode.life.kind, 'chat');

    const selfChat = { run: async () => ({ ok: true, output: { action: 'noop', activity: 'x', reason: '', urge: 'none', life: { ...life, with: '阿萌' } } }) };
    await runHandler(db, { runner: selfChat, job: jobFor(character.heartbeatGeneration, 'l2'), now: chicago(20), rng: seq([0.99, 0.3, 0.1]), deliver: async e => sent.push(e) });
    assert.equal(sent.length, 1, '和阿萌的「聊天」不算私人生活');
});

test('刚聊过的一跳：抽签不开口、提示词写明只能 noop；模型硬写了 message 也不发，留成「等会儿」', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db, { todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] });
    db.prepare('UPDATE characters SET last_user_interaction_at = ? WHERE char_id = ?')
        .run(new Date(chicago(20).getTime() - 3 * 60_000).toISOString(), CHAR);
    const sent = [];
    const prompts = [];
    const runner = { run: async ({ system }) => {
        prompts.push(system);
        return { ok: true, output: { action: 'message', activity: '在沙发上刷手机', reason: '', urge: 'none', text: '还在吗' } };
    } };
    // rng 0：平时必定开口；这里因为刚聊过，概率被压成 0
    const result = await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'q1'), now: chicago(20), rng: () => 0, deliver: async e => sent.push(e) });
    assert.equal(result.intent, 'live');
    assert.equal(result.action, 'noop');
    assert.equal(sent.filter(e => e.kind === 'chat_message').length, 0, '不发消息');
    assert.ok(prompts[0].includes('只能填 "noop"'));
    assert.ok(!prompts[0].includes('那就别等'));
    const run = listModelRuns(db)[0];
    assert.equal(run.outcome, 'noop');
    assert.equal(run.skipGate, 'active_chat');
    assert.equal(run.urge, 'later', '想说的话留到下一跳');
    assert.equal(run.proposedText, '还在吗', '留底：TA 本来想说什么');
});

test('刚聊过的一跳照样写自己的事（这里是生活小事）', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db, { todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] });
    db.prepare('UPDATE characters SET last_user_interaction_at = ? WHERE char_id = ?')
        .run(new Date(chicago(20).getTime() - 3 * 60_000).toISOString(), CHAR);
    const sent = [];
    const runner = { run: async () => ({ ok: true, output: { action: 'noop', activity: '点外卖', reason: '', urge: 'none', life: { kind: 'delivery', with: '麻辣烫' } } }) };
    const seq = [0.5, 0.3, 0.9];     // 意图（被压成 0，不开口）→ 抽中生活 → 外卖以外的某种
    let i = 0;
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'q2'), now: chicago(20), rng: () => seq[i++] ?? 0.5, deliver: async e => sent.push(e) });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.type, 'life_episode');
});

test('刚聊过时，上一跳欠下的「等会儿」继续欠着，不在这一跳强行兑现', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db);
    recordModelRun(db, { charId: CHAR, runtime: 'api', startedAt: new Date(AT.getTime() - 2 * 60_000).toISOString(), ok: true, outcome: 'noop', reason: '等会儿找她', urge: 'later' });
    db.prepare('UPDATE characters SET last_user_interaction_at = ? WHERE char_id = ?')
        .run(new Date(AT.getTime() - 5 * 60_000).toISOString(), CHAR);
    const runner = { run: async () => ({ ok: true, output: { action: 'noop', activity: 'x', reason: '', urge: 'none' } }) };
    const result = await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'q3'), rng: () => 0.99 });
    assert.equal(result.intent, 'live');
    assert.equal(listModelRuns(db)[0].urge, 'later');
});
