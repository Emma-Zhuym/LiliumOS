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
    nextRunAt, recordModelRun, shouldCaptureRaw, decideEpisode, episodeChance, isWorkSlot, lifeChance, pickLifeKind, veilSurprise,
    MEALTIME_LIFE_WEIGHTS, OTHER_LIFE_WEIGHTS, HEARTBEAT_SCHEMA, withPlanTime, withXhsFeed, unreadFromUser, formatRecentMessages, withTodaySchedule,
} from './heartbeat.mjs';
import { chatCompletionsUrl, createApiRunner, extractContentText, parseEpisode, parseHeartbeatOutput, parseLife } from './runner.mjs';
import { applyThread, closePassedPlans, closeStaleThreads, isPlanDue, listOpenThreads, listPlans } from './lifeThreads.mjs';
import { feedResult } from './xhsFeed.fixture.mjs';
import { formatMomentsForPrompt, markMomentsSeen, parseMomentReactions, resolveMomentReactions, unseenMoments } from './moments.mjs';

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

const runHandler = async (db, { runner, job, now = AT, scheduled = [], rng = () => 0.99, deliver = null, xhs = null }) => {
    const handler = createHeartbeatHandler({
        db,
        config: { heartbeatTimeoutMs: 1000 },
        runners: { api: runner },
        scheduleNext: (character, at) => scheduled.push({ charId: character.charId, at }),
        now: () => now,
        rng,
        deliver,
        xhs,
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

test('间隔那段三类分开说：要赴约的没发生，自己的日常照常走，碰没碰面都不是不找 ta 的理由', () => {
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
    assert.ok(prompt.includes('对方没有回你消息'), '必须说明这段时间对方没回');
    assert.ok(prompt.includes('别把它们当成已经做完了'), '要对方赴约的事不能脑补成做完了');
    assert.ok(prompt.includes('你自己的日常照常往前走'), '自己的日子不能冻住（「你不来我就还没做饭」）');
    assert.ok(prompt.includes('如果你们本来就住在一起'), '同居与否交给人设判断，不传参数');
    assert.ok(prompt.includes('不构成「所以现在没必要找 ta」的理由'), '堵住「人就在旁边所以不说话」');
    assert.ok(!prompt.includes('没有发生过任何互动'), '旧的一刀切说法不能留着');
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
    assert.deepEqual(
        parseLife({ kind: 'moment', detail: '加班', comments: [{ who: '王总', relation: '领导', text: '辛苦' }, { who: '', text: 'x' }], likes: 12.4, hide: ['family', 'boss'] }),
        { kind: 'moment', detail: '加班', comments: [{ who: '王总', relation: '领导', text: '辛苦' }], likes: 12, hide: ['family'] },
        '朋友圈带亲友评论、赞数、屏蔽分组；坏的丢掉',
    );
    assert.equal(parseLife({ kind: 'moment' }), null);
    assert.equal(parseLife({ kind: 'dance', detail: 'x' }), null);
    assert.deepEqual(
        parseLife({ kind: 'gift', with: '奶茶店', via: 'food', surprise: true, detail: '她爱喝的', value: '¥18', note: '趁热' }),
        { kind: 'gift', with: '奶茶店', via: 'food', surprise: true, detail: '她爱喝的', value: '¥18', note: '趁热' },
    );
    assert.deepEqual(parseLife({ kind: 'gift', with: '围巾', via: 'boat' }), { kind: 'gift', with: '围巾', via: 'net', surprise: false }, '不认识的 via 当网购；没说惊喜就不是');
    // 网购选的配送档：认得的才留；外卖没有这一档
    assert.equal(parseLife({ kind: 'order', with: '青菜', ship: 'same_day' }).ship, 'same_day');
    assert.equal(parseLife({ kind: 'order', with: '书', ship: 'rocket' }).ship, undefined);
    assert.equal(parseLife({ kind: 'delivery', with: '店', ship: 'same_day' }).ship, undefined);
    assert.equal(parseLife({ kind: 'gift', with: '花', via: 'net', ship: 'next_day' }).ship, 'next_day');
    assert.equal(parseLife({ kind: 'gift', with: '奶茶', via: 'food', ship: 'next_day' }).ship, undefined);
    assert.equal(parseLife({ kind: 'gift', detail: '没写买了啥' }), null);
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

test('生活里做什么由程序定：饭点外卖多，别的时候聊天为主，七种都会出现（含给她买东西、社交、逛小红书）', () => {
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
    assert.deepEqual(Object.keys(night).sort(), ['chat', 'delivery', 'gift', 'moment', 'order', 'social', 'xhs']);
    assert.ok(night.chat >= 38);
    assert.ok(night.order > dinner.order, '非饭点网购偏多');
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

test('惊喜礼物：起居注那一句不点破买了什么，episode 里照样留底', async () => {
    assert.deepEqual(
        veilSurprise({ activity: '下单了那只抱枕', reason: '她上次说想要' }, { kind: 'gift', surprise: true }, '阿萌'),
        { activity: '给阿萌准备了点东西', reason: '想给 阿萌 一个惊喜，先不说是什么。' },
    );
    // 不是惊喜、不是礼物的，原样不动
    assert.equal(veilSurprise({ activity: 'a', reason: 'b' }, { kind: 'gift', surprise: false }, '阿萌').activity, 'a');
    assert.equal(veilSurprise({ activity: 'a', reason: 'b' }, { kind: 'order', with: 'x' }, '阿萌').activity, 'a');
    assert.equal(veilSurprise({ activity: 'a', reason: 'b' }, null, '阿萌').reason, 'b');

    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db, { todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] });
    const sent = [];
    const gift = { kind: 'gift', with: '云朵抱枕', via: 'net', surprise: true, detail: '她上次逛街摸了好几次', value: '¥129', note: '抱着睡' };
    const runner = { run: async () => ({ ok: true, output: { action: 'noop', activity: '下单了那只云朵抱枕', reason: '她上次逛街摸了好几次', urge: 'none', life: gift } }) };
    const seq = [0.99, 0.3, 0.76];    // 不开口 → 抽中生活 → 落到 gift（饭点 0.75–0.78 那一档）
    let i = 0;
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'g1'), now: chicago(20), rng: () => seq[i++] ?? 0.99, deliver: async e => sent.push(e) });
    const run = listModelRuns(db)[0];
    assert.equal(run.activity, '给阿萌准备了点东西');
    assert.ok(!run.reason.includes('抱枕'));
    assert.equal(run.episode.life.with, '云朵抱枕', '排查时仍然看得到买了什么');
    assert.equal(sent[0].payload.life.with, '云朵抱枕', '投喂站那一单照常拿到全部内容');
});

// ---- 生活活动 v2（docs/spec-heartbeat-life-v2.md）----

const sumOf = (weights, kinds = null) =>
    Math.round(weights.filter(([kind]) => !kinds || kinds.includes(kind)).reduce((n, [, w]) => n + w, 0) * 1000) / 1000;

test('生活权重：两行各自合计 1.00，购物三项都压在 0.20', () => {
    for (const weights of [MEALTIME_LIFE_WEIGHTS, OTHER_LIFE_WEIGHTS]) {
        assert.equal(sumOf(weights), 1);
        assert.equal(sumOf(weights, ['delivery', 'order', 'gift']), 0.2);
    }
    // 钉死 rng 验分档边界。饭点：chat 0.42 | social 0.58 | delivery 0.71 | order 0.75 | gift 0.78 | moment 0.92 | xhs
    const lunch = 12 * 60;
    const at = r => pickLifeKind(lunch, () => r);
    assert.deepEqual([0, 0.419, 0.42, 0.579, 0.58, 0.709, 0.71, 0.749, 0.75, 0.779, 0.78, 0.919, 0.92, 0.999].map(at),
        ['chat', 'chat', 'social', 'social', 'delivery', 'delivery', 'order', 'order', 'gift', 'gift', 'moment', 'moment', 'xhs', 'xhs']);
    // 其余：chat 0.40 | social 0.57 | delivery 0.61 | order 0.73 | gift 0.77 | moment 0.92 | xhs
    const night = r => pickLifeKind(22 * 60, () => r);
    assert.deepEqual([0.399, 0.4, 0.569, 0.57, 0.609, 0.61, 0.729, 0.73, 0.769, 0.77, 0.919, 0.92, 0.999].map(night),
        ['chat', 'social', 'social', 'delivery', 'delivery', 'order', 'order', 'gift', 'gift', 'moment', 'moment', 'xhs', 'xhs']);
    // 逛小红书是从朋友圈分出去的：两者合起来仍是原来那一份
    assert.equal(sumOf(MEALTIME_LIFE_WEIGHTS, ['moment', 'xhs']), 0.22);
    assert.equal(sumOf(OTHER_LIFE_WEIGHTS, ['moment', 'xhs']), 0.23);
    // 饭点边界：11:00 算、13:30 不算，17:00 算、20:30 不算
    // 同一个 0.65：饭点里是外卖，饭点外是网购
    assert.equal(pickLifeKind(11 * 60, () => 0.65), 'delivery');
    assert.equal(pickLifeKind(10 * 60 + 59, () => 0.65), 'order');
    assert.equal(pickLifeKind(13 * 60 + 30, () => 0.65), 'order');
    assert.equal(pickLifeKind(17 * 60, () => 0.65), 'delivery');
    assert.equal(pickLifeKind(20 * 60 + 29, () => 0.65), 'delivery');
    assert.equal(pickLifeKind(20 * 60 + 30, () => 0.65), 'order');
});

test('social：抽得中，schema 收得下，解析后带 detail；约人那几句可有可无', () => {
    assert.equal(pickLifeKind(22 * 60, () => 0.5), 'social');
    assert.ok(HEARTBEAT_SCHEMA.properties.life.properties.kind.enum.includes('social'));
    assert.deepEqual(HEARTBEAT_SCHEMA.properties.life.properties.plan.required, ['what', 'at']);
    assert.deepEqual(parseLife({ kind: 'social', with: '林越', detail: '临时约好上线打两把' }),
        { kind: 'social', with: '林越', detail: '临时约好上线打两把' });
    const withLines = parseLife({ kind: 'social', with: '林越', detail: '开着语音各干各的', lines: [{ who: '林越', text: '上号？' }, { who: '我', text: '来' }], group: 'friend' });
    assert.equal(withLines.lines.length, 2);
    assert.equal(withLines.group, 'friend');
    assert.equal(parseLife({ kind: 'social', with: '林越' }), null, '没写做了什么就不算');
    assert.equal(parseLife({ kind: 'social', detail: 'x' }), null);
});

test('提示词：social 写明当场发生、可以不出门；chat 和 social 都教怎么写 plan', () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const snapshot = { payload: { timezone: 'America/Chicago', circle: [{ name: '林越', relation: '大学同学' }] } };
    const social = buildPrompt(character, snapshot, AT, 'live', { life: 'social' });
    assert.ok(social.includes('kind 填 "social"'));
    assert.ok(social.includes('上线打游戏'));
    assert.ok(social.includes('别写成计划'));
    assert.ok(social.includes('plan'));
    assert.ok(buildPrompt(character, snapshot, AT, 'live', { life: 'chat' }).includes('「周六下午」'));
    assert.ok(!buildPrompt(character, snapshot, AT, 'live', { life: 'delivery' }).includes('plan 里写'));
});

test('plan 解析：认得出的带上 dueAt，认不出的整条 plan 丢掉，life 其余照常', () => {
    const life = { kind: 'social', with: '林越', detail: '约好周末看展', plan: { what: '和林越去看展', at: '周六下午' } };
    const kept = withPlanTime(life, AT, 'America/Chicago');
    assert.equal(kept.plan.dueAt, new Date(Date.UTC(2026, 8, 26, 20)).toISOString());
    assert.equal(kept.plan.what, '和林越去看展');
    const dropped = withPlanTime({ ...life, plan: { what: '和林越去看展', at: '改天吧' } }, AT, 'America/Chicago');
    assert.equal(dropped.plan, undefined);
    assert.equal(dropped.detail, '约好周末看展');
    assert.equal(withPlanTime(null, AT, 'America/Chicago'), null);
    // 解析层：plan 只在 chat / social 上收，缺字段就不要
    assert.equal(parseLife({ kind: 'delivery', with: '店', plan: { what: 'x', at: '明天' } }).plan, undefined);
    assert.equal(parseLife({ kind: 'social', with: '林越', detail: 'x', plan: { what: '看展' } }).plan, undefined);
});

test('迁移 9：旧 thread 的 due_at 是 NULL，行为不变；约定和正在推进的事各占各的名额', () => {
    const db = freshDb();
    seedCharacter(db);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9);
    // 模拟迁移前写下的行：不带 due_at
    db.prepare(`INSERT INTO life_threads (id, char_id, title, summary, status, created_at, updated_at)
                VALUES ('aaaaaaaa-old', ?, '改领口', '打样回来了', 'open', ?, ?)`).run(CHAR, AT.toISOString(), AT.toISOString());
    const [old] = listOpenThreads(db, CHAR);
    assert.equal(old.dueAt, null);
    assert.equal(isPlanDue(old, AT), false);
    const updated = applyThread(db, CHAR, { id: 'aaaaaaaa', title: '改领口', summary: '改完了', status: 'open' }, AT);
    assert.equal(updated.id, 'aaaaaaaa-old', '照抄 id 仍然接得上');
    assert.equal(closePassedPlans(db, CHAR, new Date(AT.getTime() + 86400_000)), 0, '没有时间的事不会被当成错过的约定');

    // 三个约定不挤掉工作的事；工作抄来的 id 也对不上约定
    for (let i = 0; i < 3; i += 1) {
        applyThread(db, CHAR, { title: `约定${i}`, summary: '', status: 'open', dueAt: new Date(AT.getTime() + (i + 1) * 3600_000).toISOString() }, AT);
    }
    const open = listOpenThreads(db, CHAR);
    assert.equal(open.length, 4);
    assert.ok(open.some(t => t.id === 'aaaaaaaa-old'));
    const plan = open.find(t => t.title === '约定0');
    const miss = applyThread(db, CHAR, { id: plan.id.slice(0, 8), title: '新工作', summary: '', status: 'open' }, AT);
    assert.notEqual(miss.id, plan.id);
    assert.equal(miss.dueAt, null);
});

test('约定窗口：前后 45 分钟内算到点，过了窗口还开着的静默收掉', () => {
    const db = freshDb();
    seedCharacter(db);
    const soon = applyThread(db, CHAR, { title: '和林越打球', summary: '', status: 'open', dueAt: new Date(AT.getTime() + 40 * 60_000).toISOString() }, AT);
    const later = applyThread(db, CHAR, { title: '和林越看展', summary: '', status: 'open', dueAt: new Date(AT.getTime() + 3 * 86400_000).toISOString() }, AT);
    assert.equal(isPlanDue(soon, AT), true);
    assert.equal(isPlanDue(later, AT), false);
    assert.equal(isPlanDue(soon, new Date(AT.getTime() + 86 * 60_000)), false);
    assert.equal(closePassedPlans(db, CHAR, new Date(AT.getTime() + 86 * 60_000)), 1);
    assert.deepEqual(listOpenThreads(db, CHAR).map(t => t.id), [later.id]);
});

test('真实执行：新约的事落成带时间的 thread；解析不了就不落库，生活照常送', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db, { todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] }, chicago(22));
    const sent = [];
    const social = plan => ({ kind: 'social', with: '林越', detail: '一起打了两把', lines: [{ who: '林越', text: '周六去看展？' }, { who: '我', text: '行' }], plan });
    const runnerFor = life => ({ run: async () => ({ ok: true, output: { action: 'noop', activity: '和林越打游戏', reason: '', urge: 'none', life } }) });
    // 不开口 → 抽中生活 → 0.5 落在 social
    const seq = rolls => { let i = 0; return () => rolls[i++] ?? 0.99; };
    await runHandler(db, { runner: runnerFor(social({ what: '和林越去看展', at: '周六下午' })), job: jobFor(character.heartbeatGeneration, 'p1'), now: chicago(22), rng: seq([0.99, 0.3, 0.5]), deliver: async e => sent.push(e) });
    const [plan] = listOpenThreads(db, CHAR);
    assert.equal(plan.title, '和林越去看展');
    assert.equal(plan.dueAt, new Date(Date.UTC(2026, 8, 26, 20)).toISOString());
    assert.equal(sent[0].payload.life.plan.dueAt, plan.dueAt);

    await runHandler(db, { runner: runnerFor(social({ what: '和林越吃饭', at: '改天' })), job: jobFor(character.heartbeatGeneration, 'p2'), now: chicago(22, 30), rng: seq([0.99, 0.3, 0.5]), deliver: async e => sent.push(e) });
    assert.equal(listOpenThreads(db, CHAR).length, 1, '解析不了的 plan 不落库');
    assert.equal(sent.length, 2, '生活照样送到手机');
    assert.equal(sent[1].payload.life.plan, undefined);
    assert.equal(sent[1].payload.life.detail, '一起打了两把');
});

test('约定到点：这一跳就去做这件事、写完收掉；没到点的留着，并进提示词当话头', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    const now = chicago(15);
    seedSnapshot(db, { todaySchedule: [{ start: '09:00', title: '在家', availability: 'online' }] }, now);
    const due = applyThread(db, CHAR, { title: '和林越打球', summary: '约在今天下午三点', status: 'open', dueAt: new Date(now.getTime() + 20 * 60_000).toISOString() }, AT);
    const later = applyThread(db, CHAR, { title: '和林越去看展', summary: '约在周六下午', status: 'open', dueAt: new Date(Date.UTC(2026, 8, 26, 20)).toISOString() }, AT);
    const prompts = [];
    const runner = { run: async ({ system }) => {
        prompts.push(system);
        return { ok: true, output: { action: 'noop', activity: '在球场跟林越打球', reason: '', urge: 'none', life: { kind: 'social', with: '林越', detail: '在打球' } } };
    } };
    // 不开口，抽签落在「什么都不写」（0.99）：到点的约定照样把这一跳变成赴约
    const sent = [];
    const result = await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'd1'), now, rng: () => 0.99, deliver: async e => sent.push(e) });
    assert.equal(result.intent, 'live');
    assert.ok(prompts[0].includes('现在就是你约好的时间：「和林越打球」'));
    assert.ok(prompts[0].includes('kind 填 "social"'));
    assert.ok(prompts[0].includes('和林越去看展'), '没到点的约定也在提示词里');
    assert.ok(!prompts[0].includes(`id：${due.id.slice(0, 8)}`), '约定不混进「手头正在推进的事」给工作抄 id');
    assert.equal(sent[0].payload.life.kind, 'social');
    assert.deepEqual(listOpenThreads(db, CHAR).map(t => t.id), [later.id], '到点的收掉，没到点的留着');

    // 开口的一跳：约定是能自然说起的话头
    const talk = [];
    await runHandler(db, {
        runner: { run: async ({ system }) => { talk.push(system); return { ok: true, output: { action: 'message', activity: 'a', reason: '', urge: 'none', text: '周六我要去看展' } }; } },
        job: jobFor(character.heartbeatGeneration, 'd2'), now: new Date(now.getTime() + 3 * 3600_000), rng: () => 0, deliver: async () => {},
    });
    assert.ok(talk[0].includes('你跟别人约好的事也是很自然的话头'));
});

test('影子期不动约定：不收、不落', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    const now = chicago(15);
    seedSnapshot(db, {}, now);
    const due = applyThread(db, CHAR, { title: '和林越打球', summary: '', status: 'open', dueAt: new Date(now.getTime() + 10 * 60_000).toISOString() }, AT);
    const runner = { run: async () => ({ ok: true, output: { action: 'noop', activity: '打球', reason: '', urge: 'none', life: { kind: 'social', with: '林越', detail: 'x', plan: { what: '再约', at: '明晚八点' } } } }) };
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 's1'), now, rng: () => 0.99 });
    assert.deepEqual(listOpenThreads(db, CHAR).map(t => t.id), [due.id]);
});

// ---- 逛小红书（从朋友圈分出去的那 0.08）----

const detailResult = () => ({
    content: [{ type: 'text', text: JSON.stringify({ feed_id: 'n2', data: {
        note: { noteId: 'n2', title: '猫咪第一次见雪', desc: '它先伸了一只爪子试探，然后整只猫扑进去了。', ipLocation: '黑龙江' },
        comments: { list: [
            { id: 'c1', content: '爪子缩回去那一下笑死', likeCount: '2.3万', userInfo: { nickname: '雪球' } },
            { id: 'c2', content: '', userInfo: { nickname: '空评论' } },
        ] },
    } }) }],
});

/** 假的小红书服务：按工具名回，顺手记下调了什么。 */
const fakeXhs = (calls, { detail = detailResult } = {}) => ({
    callTool: async (name, args) => {
        calls.push(name === 'list_feeds' ? name : `${name}:${args.feed_id}`);
        if (name === 'list_feeds') return feedResult();
        if (name === 'get_feed_detail') return detail();
        return { content: [{ type: 'text', text: '操作成功' }] };
    },
});

const xhsSeq = () => { const seq = [0.99, 0.3, 0.95]; let i = 0; return () => seq[i++] ?? 0.99; };   // 不开口 → 生活 → xhs

test('逛小红书：刷首页 → 点开多看两眼的第一条 → 看完再写 → 点赞收藏 → 转发给阿萌带卡片', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db, { xhsEnabled: true, todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] }, chicago(22));
    const calls = [];
    const prompts = [];
    const outputs = [
        { action: 'noop', activity: '刷小红书', reason: '', urge: 'none', life: { kind: 'xhs', detail: '刷到一只猫。', picks: [{ index: 2, note: '标题好可爱' }] } },
        { action: 'noop', activity: '窝在沙发上看猫扑雪', reason: '', urge: 'none',
            life: { kind: 'xhs', detail: '点开看了，它整只扑进雪里，评论说爪子缩回去那一下，我也笑了。',
                picks: [{ index: 2, note: '扑雪', like: true, fav: true }, { index: 1, like: true }, { index: 7, like: true }],
                share: { index: 2, text: '你看这只猫，像不像你第一次见雪' } } },
    ];
    const runner = { run: async ({ system }) => { prompts.push(system); return { ok: true, output: outputs[prompts.length - 1] }; } };
    const sent = [];
    const result = await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'x1'), now: chicago(22), rng: xhsSeq(), deliver: async e => sent.push(e), xhs: fakeXhs(calls) });

    assert.equal(prompts.length, 2, '点开之后再调一次模型');
    assert.ok(prompts[0].includes('「猫咪第一次见雪」（视频） — 橘子汽水'), '第一次看的是真实首页');
    assert.ok(!prompts[0].includes('你点开了'));
    assert.ok(prompts[1].includes('你点开了第 2 条「猫咪第一次见雪」（橘子汽水，黑龙江）'));
    assert.ok(prompts[1].includes('正文：它先伸了一只爪子试探'));
    assert.ok(prompts[1].includes('- 雪球：爪子缩回去那一下笑死（23000 赞）'));
    // 点赞 + 收藏一跳最多两次：第一条的赞和藏做了，第二条的赞没额度；越界的那条早被丢掉
    assert.deepEqual(calls, ['list_feeds', 'get_feed_detail:n2', 'like_feed:n2', 'favorite_feed:n2']);

    const life = sent.find(e => e.payload?.type === 'life_episode').payload.life;
    assert.equal(life.detail, '点开看了，它整只扑进雪里，评论说爪子缩回去那一下，我也笑了。', '用的是看完之后的第二次');
    assert.deepEqual(life.opened, { noteId: 'n2', title: '猫咪第一次见雪', author: '橘子汽水', desc: '它先伸了一只爪子试探，然后整只猫扑进去了。', comments: 1 });
    assert.deepEqual(life.picks.map(p => [p.noteId, p.liked ?? false, p.faved ?? false]), [['n2', true, true], ['n1', false, false]]);
    assert.ok(life.picks.every(p => !('wantLike' in p) && !('wantFav' in p)), '「想点」的标记不往前端送');

    const message = sent.find(e => e.kind === 'chat_message');
    assert.equal(message.payload.text, '你看这只猫，像不像你第一次见雪');
    assert.deepEqual(message.payload.xhsNote, {
        noteId: 'n2', title: '猫咪第一次见雪', desc: '', author: '橘子汽水', authorId: '', likes: 356, xsecToken: 'tok2', type: 'video',
    });
    assert.equal(result.action, 'message');
    assert.equal(listModelRuns(db)[0].outcome, 'message', '转发了就算这一跳开了口，冷却和每日上限照常算');
});

test('逛小红书：刚聊过的一跳不转发；影子期不点赞；点不开就用第一次的结果', async () => {
    // 刚聊过：share 丢掉，不发消息
    {
        const db = freshDb();
        setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
        const character = seedCharacter(db);
        seedSnapshot(db, { xhsEnabled: true, todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] }, chicago(22));
        db.prepare('UPDATE characters SET last_user_interaction_at = ? WHERE char_id = ?').run(new Date(chicago(22).getTime() - 3 * 60_000).toISOString(), CHAR);
        const prompts = [];
        const runner = { run: async ({ system }) => { prompts.push(system); return { ok: true, output: { action: 'noop', activity: 'a', reason: '', urge: 'none',
            life: { kind: 'xhs', detail: '嗯', share: { index: 1, text: '给你看' } } } }; } };
        const sent = [];
        await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'h1'), now: chicago(22), rng: xhsSeq(), deliver: async e => sent.push(e), xhs: fakeXhs([]) });
        assert.ok(prompts[0].includes('这次先别转发给 ta'));
        assert.equal(sent.filter(e => e.kind === 'chat_message').length, 0);
        assert.equal(sent[0].payload.life.share, undefined, '没发出去的转发不带给前端');
    }
    // 影子期：照常刷、照常点开看，但不点赞不收藏
    {
        const db = freshDb();
        const character = seedCharacter(db);
        seedSnapshot(db, { xhsEnabled: true, todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] }, chicago(22));
        const calls = [];
        const runner = { run: async () => ({ ok: true, output: { action: 'noop', activity: 'a', reason: '', urge: 'none',
            life: { kind: 'xhs', detail: '嗯', picks: [{ index: 1, like: true }] } } }) };
        await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 's1'), now: chicago(22), rng: xhsSeq(), xhs: fakeXhs(calls) });
        assert.deepEqual(calls, ['list_feeds', 'get_feed_detail:n1']);
    }
    // 详情读不出来：只调一次模型，用第一次的结果
    {
        const db = freshDb();
        setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
        const character = seedCharacter(db);
        seedSnapshot(db, { xhsEnabled: true, todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] }, chicago(22));
        let runs = 0;
        const runner = { run: async () => { runs += 1; return { ok: true, output: { action: 'noop', activity: 'a', reason: '', urge: 'none',
            life: { kind: 'xhs', detail: '第一次写的', picks: [{ index: 1 }] } } }; } };
        const sent = [];
        await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, 'd1'), now: chicago(22), rng: xhsSeq(), deliver: async e => sent.push(e),
            xhs: fakeXhs([], { detail: () => ({ content: [{ type: 'text', text: '笔记不可访问' }] }) }) });
        assert.equal(runs, 1);
        assert.equal(sent[0].payload.life.detail, '第一次写的');
        assert.equal(sent[0].payload.life.opened, undefined);
    }
});

test('逛小红书退回发朋友圈：角色没开小红书、服务没接、首页刷不到', async () => {
    const cases = [
        { name: '角色没开', snapshot: {}, xhs: { callTool: async () => feedResult() }, reason: 'xhs:xhs_disabled_for_character' },
        { name: '服务没接', snapshot: { xhsEnabled: true }, xhs: null, reason: 'xhs:xhs_not_configured' },
        { name: '刷不到', snapshot: { xhsEnabled: true }, xhs: { callTool: async () => { throw new Error('超过 90000ms 没响应'); } }, reason: /^xhs:连不上 MCP|^xhs:超过/ },
    ];
    for (const item of cases) {
        const db = freshDb();
        const character = seedCharacter(db);
        seedSnapshot(db, { ...item.snapshot, todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] }, chicago(22));
        const prompts = [];
        const runner = { run: async ({ system }) => { prompts.push(system); return { ok: true, output: { action: 'noop', activity: 'a', reason: '', urge: 'none' } }; } };
        const seq = [0.99, 0.3, 0.95];
        let i = 0;
        await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration, `f-${item.name}`), now: chicago(22), rng: () => seq[i++] ?? 0.99, xhs: item.xhs });
        assert.ok(prompts[0].includes('kind 填 "moment"'), `${item.name}：退回发朋友圈`);
        assert.ok(!prompts[0].includes('kind 填 "xhs"'), item.name);
        const gate = listModelRuns(db)[0].skipGate;
        if (item.reason instanceof RegExp) assert.match(gate, item.reason, item.name);
        else assert.equal(gate, item.reason, item.name);
    }
});

test('逛小红书的输出：没刷成首页或没写感想的整条不要', () => {
    const feed = [{ noteId: 'n1', title: 't', author: 'a', likes: 1, video: false }];
    assert.equal(withXhsFeed({ kind: 'xhs', detail: '好看' }, []), null);
    assert.equal(withXhsFeed({ kind: 'xhs' }, feed), null);
    assert.deepEqual(withXhsFeed({ kind: 'xhs', detail: '没什么想看的' }, feed), { kind: 'xhs', detail: '没什么想看的', feed });
    assert.deepEqual(withXhsFeed({ kind: 'moment', detail: 'x' }, feed), { kind: 'moment', detail: 'x' }, '别的种类原样过');
    assert.deepEqual(parseLife({ kind: 'xhs', detail: '嗯', picks: [{ index: 2, note: '好看' }, { index: 'x' }, { index: -1 }] }),
        { kind: 'xhs', detail: '嗯', picks: [{ index: 2, note: '好看' }] });
    assert.equal(parseLife({ kind: 'xhs', picks: [] }), null);
    assert.ok(HEARTBEAT_SCHEMA.properties.life.properties.kind.enum.includes('xhs'));
});

// ── 读消息：阿萌发了、TA 还没回的那几条 ──

const minutesAgo = (n, now = AT) => new Date(now.getTime() - n * 60_000).toISOString();
const bedtimeChat = [
    { role: 'char', at: minutesAgo(9 * 60), text: '我先去洗澡' },
    { role: 'user', at: minutesAgo(8 * 60), text: '今天好累，老板又改需求' },
    { role: 'user', at: minutesAgo(8 * 60 - 1), text: '我先睡啦，晚安' },
];

test('读消息：最后几条是阿萌发的、TA 没回，就是没读', () => {
    const db = freshDb();
    seedCharacter(db);
    const snapshot = { receivedAt: AT.toISOString(), payload: { recentMessages: bedtimeChat } };
    assert.deepEqual(unreadFromUser(db, CHAR, snapshot).map(m => m.text), ['今天好累，老板又改需求', '我先睡啦，晚安']);
});

test('读消息：最后一条是 TA 说的，没有欠着的', () => {
    const db = freshDb();
    seedCharacter(db);
    const snapshot = { receivedAt: AT.toISOString(), payload: { recentMessages: [...bedtimeChat, { role: 'char', at: minutesAgo(10), text: '早' }] } };
    assert.deepEqual(unreadFromUser(db, CHAR, snapshot), []);
});

test('读消息：心跳已经回过（outbox 里有），快照还没更新也不再回第二遍', () => {
    const db = freshDb();
    seedCharacter(db);
    enqueue(db, { messageId: 'hb:1', charId: CHAR, kind: 'chat_message', payload: { text: '早，昨晚睡得好吗' } }, new Date(minutesAgo(30)));
    const snapshot = { receivedAt: AT.toISOString(), payload: { recentMessages: bedtimeChat } };
    assert.deepEqual(unreadFromUser(db, CHAR, snapshot), []);
});

test('读消息：欠着回复时冷却挡不住，但刚在聊的 10 分钟窗口照样挡', () => {
    const db = freshDb();
    const character = seedCharacter(db, { messageCooldownMin: 600 });
    enqueue(db, { messageId: 'm1', charId: CHAR, kind: 'chat_message', payload: { text: '在吗' } }, new Date(minutesAgo(9 * 60 + 30)));
    const snapshot = { receivedAt: AT.toISOString(), payload: { timezone: 'America/Chicago' } };
    assert.equal(speakBlock(db, { character, snapshot, now: AT }), 'message_cooldown');
    assert.equal(speakBlock(db, { character, snapshot, now: AT, owed: true }), null);

    db.prepare('UPDATE characters SET last_user_interaction_at = ? WHERE char_id = ?').run(minutesAgo(3), CHAR);
    const present = toCharacter(db.prepare('SELECT * FROM characters WHERE char_id = ?').get(CHAR));
    assert.equal(speakBlock(db, { character: present, snapshot, now: AT, owed: true }), 'active_chat');
});

test('读消息：欠着回复时不抽签，这一跳就是回她', () => {
    const args = { snapshot: {}, now: AT, timezone: 'America/Chicago', minutesSinceContact: 480 };
    assert.equal(decideIntent({ ...args, owed: true, rng: () => 0.99 }).intent, 'reply');
    assert.equal(decideIntent({ ...args, owed: true, canSpeak: false, rng: () => 0.99 }).intent, 'live');
});

test('读消息：回她的那一跳，提示词列出没回的消息，不再说「对方没回你」', () => {
    const snapshot = { payload: { user: { name: '阿萌' }, timezone: 'America/Chicago', recentMessages: bedtimeChat } };
    const unread = bedtimeChat.slice(1);
    const prompt = buildPrompt({ displayName: '露米' }, snapshot, AT, 'reply', { unread });
    assert.match(prompt, /对方给你发了这些消息，你还没有回/);
    assert.match(prompt, /- .*今天好累，老板又改需求/);
    assert.match(prompt, /先回应 ta 说的内容/);
    assert.doesNotMatch(prompt, /对方没有回你消息/);
    const idle = buildPrompt({ displayName: '露米' }, snapshot, AT, 'live');
    assert.match(idle, /对方没有回你消息/);
});

test('读消息：整跳走下来，抽签抽不中也会回她，且不去过自己的日子', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db, { recentMessages: bedtimeChat, lastInteraction: { userAt: bedtimeChat[2].at, charAt: bedtimeChat[0].at } });
    let system = '';
    const runner = {
        run: async input => {
            system = input.system;
            return { ok: true, output: { action: 'message', activity: '刚醒', reason: '她昨晚好累', text: '早，昨天辛苦了', urge: 'none' } };
        },
    };
    const result = await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration), rng: () => 0.99 });
    assert.equal(result.intent, 'reply');
    assert.equal(result.action, 'message');
    assert.match(system, /我先睡啦，晚安/);
    assert.doesNotMatch(system, /在 life 里写/);
});

test('长期记忆：月度总结进提示词；聊天记录隔半小时标一次时间', () => {
    const snapshot = { payload: {
        timezone: 'America/Chicago',
        monthlySummaries: [{ month: '2026-09', text: '一起养了只猫' }],
        recentMessages: bedtimeChat,
    } };
    const prompt = buildPrompt({ displayName: '露米' }, snapshot, AT, 'live');
    assert.match(prompt, /\[2026-09\] 一起养了只猫/);
    const lines = formatRecentMessages(bedtimeChat, 'America/Chicago').split('\n');
    assert.equal(lines.filter(line => line.startsWith('〔')).length, 2, '洗澡和后面两句隔了一小时，后两句只隔一分钟');
});

test('快照：月度总结只收 {month, text}，聊天最多留 100 条', () => {
    const normalized = normalizeSnapshotPayload({
        monthlySummaries: [{ month: '2026-09', text: ' 猫 ', extra: 1 }, { month: '2026-08', text: '' }],
        recentMessages: Array.from({ length: 130 }, (_, i) => ({ role: 'user', at: null, text: String(i) })),
    });
    assert.deepEqual(normalized.monthlySummaries, [{ month: '2026-09', text: '猫' }]);
    assert.equal(normalized.recentMessages.length, 100);
    assert.equal(normalized.recentMessages[0].text, '30');
});

// ── 过期日程：昨天拼的「今天的安排」不拿来过今天 ──

test('过期日程：快照是今天拼的就照用，昨天的就丢掉日程、别的照旧', () => {
    const schedule = [{ start: '09:00', end: '18:00', title: '上班', availability: 'busy' }];
    const today = { builtAt: '2026-09-23T14:00:00.000Z', payload: { timezone: 'America/Chicago', todaySchedule: schedule, mood: '平静' } };
    assert.equal(withTodaySchedule(today, AT), today);
    // 芝加哥 9 月 22 日晚上拼的，到 23 日下午就是昨天的了
    const yesterday = { ...today, builtAt: '2026-09-23T03:00:00.000Z' };
    const fresh = withTodaySchedule(yesterday, AT);
    assert.equal(fresh.payload.todaySchedule, undefined);
    assert.equal(fresh.payload.mood, '平静');
    assert.equal(currentSlot(fresh, AT, 'America/Chicago'), null);
});

test('过期日程：心跳提示词里不再出现昨天的安排', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    putSnapshot(db, {
        charId: CHAR,
        builtAt: '2026-09-22T15:00:00.000Z',
        payload: { identity: { name: '露米' }, user: { name: '阿萌' }, timezone: 'America/Chicago', todaySchedule: [{ start: '09:00', end: '', title: '昨天的会' }] },
    }, AT);
    let system = '';
    const runner = { run: async input => { system = input.system; return { ok: true, output: { action: 'noop', activity: '发呆', reason: '' } }; } };
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration) });
    assert.doesNotMatch(system, /昨天的会/);
});

// ── 心跳刷朋友圈 ──

const userMoments = [
    { id: 'u1', text: '和露米一起做的红烧肉', at: '2026-09-23T19:00:00.000Z', images: 2, comments: [{ who: '表姐', text: '看着好香' }] },
    { id: 'u2', text: '下班路上的晚霞', at: '2026-09-23T19:30:00.000Z', images: 0, comments: [] },
];

test('朋友圈：没看过的才拿出来，看过就记下', () => {
    const db = freshDb();
    seedCharacter(db);
    const snapshot = { payload: { userMoments } };
    assert.deepEqual(unseenMoments(db, CHAR, snapshot).map(p => p.id), ['u1', 'u2']);
    markMomentsSeen(db, CHAR, ['u1'], AT);
    assert.deepEqual(unseenMoments(db, CHAR, snapshot).map(p => p.id), ['u2']);
});

test('朋友圈：模型只回编号，越界、重复、什么都没做的丢掉', () => {
    const parsed = parseMomentReactions([
        { index: 1, like: true, comment: ' 下次还要吃 ' }, { index: 1, like: true }, { index: 2 }, { index: 9, like: true },
    ]);
    assert.deepEqual(parsed, [{ index: 1, like: true, comment: '下次还要吃' }, { index: 9, like: true }]);
    assert.deepEqual(resolveMomentReactions(parsed, userMoments), [{ postId: 'u1', like: true, comment: '下次还要吃' }]);
    assert.equal(parseMomentReactions('乱写'), null);
});

test('朋友圈：提示词写明配图看不到内容、带上已有评论', () => {
    const text = formatMomentsForPrompt(userMoments, { userName: '阿萌' });
    assert.match(text, /1\. .*阿萌发了：「和露米一起做的红烧肉」（配了 2 张图，你看不到图的内容，别编）/);
    assert.match(text, /已有评论：表姐：看着好香/);
});

test('朋友圈：整跳走下来，刷到就回应，结果静默送去手机，下一跳不再看', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = seedCharacter(db);
    seedSnapshot(db, { userMoments });
    let system = '';
    const runner = {
        run: async input => {
            system = input.system;
            return { ok: true, output: { action: 'noop', activity: '躺着刷手机', reason: '', moments: [{ index: 1, like: true, comment: '下次还要吃' }] } };
        },
    };
    const delivered = [];
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration), deliver: async item => delivered.push(item) });
    assert.match(system, /你刚刷了一下朋友圈/);
    const sent = delivered.find(item => item.payload?.type === 'moment_reaction');
    assert.equal(sent.notify, false);
    assert.deepEqual(sent.payload.reactions, [{ postId: 'u1', like: true, comment: '下次还要吃' }]);
    assert.deepEqual(unseenMoments(db, CHAR, { payload: { userMoments } }), []);
});

test('朋友圈：回她消息的那一跳不刷朋友圈', async () => {
    const db = freshDb();
    const character = seedCharacter(db);
    seedSnapshot(db, { userMoments, recentMessages: bedtimeChat });
    let system = '';
    const runner = { run: async input => { system = input.system; return { ok: true, output: { action: 'message', activity: '刚醒', reason: '', text: '早' } }; } };
    await runHandler(db, { runner, job: jobFor(character.heartbeatGeneration) });
    assert.doesNotMatch(system, /你刚刷了一下朋友圈/);
});

test('朋友圈：runner 把 moments 解析出来', () => {
    const parsed = parseHeartbeatOutput(JSON.stringify({ action: 'noop', activity: 'x', reason: '', moments: [{ index: 1, like: true }] }));
    assert.deepEqual(parsed.output.moments, [{ index: 1, like: true }]);
});

// ── 约定给手机：日历和聊天 ──

test('约定：列出窗口内所有角色的约定，按时间排，带 charId，普通的事不列', () => {
    const db = freshDb();
    seedCharacter(db);
    applyThread(db, CHAR, { title: '和林越去看展', summary: '约在周六下午', dueAt: '2026-09-26T19:00:00.000Z' }, AT);
    applyThread(db, CHAR, { title: '和表姐吃饭', dueAt: '2026-09-24T01:00:00.000Z' }, AT);
    applyThread(db, CHAR, { title: '改方案', summary: '领口还要改' }, AT);
    applyThread(db, CHAR, { title: '很久以前的约', dueAt: '2026-08-01T01:00:00.000Z' }, AT);
    const plans = listPlans(db, { now: AT });
    assert.deepEqual(plans.map(p => p.title), ['和表姐吃饭', '和林越去看展']);
    assert.equal(plans[1].charId, CHAR);
    assert.equal(plans[1].status, 'open');
    assert.equal(plans[1].summary, '约在周六下午');
});
