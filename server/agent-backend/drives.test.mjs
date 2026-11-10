/**
 * 心思系统（docs/spec-character-drives.md 第 5 节）。内存库、假时钟，跟真账本物理隔离。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb, setSetting } from './db.mjs';
import { upsertCharacter } from './characters.mjs';
import { putSnapshot } from './snapshots.mjs';
import {
    DEFAULT_BASELINE, SULK_MAX_MS, apartnessOf, applyLabel, chanceFactor, evolve, formatFeelings, freshState, grievanceOf,
    cancelPrivateMoment, ingestChatEvents, isDriveTrial, lifeWeightFactors, loadState, peakLevel, privateMomentOf, satisfy, saveState, setPrivateMoment, summarizeForPhone, weekOf, withApartness, writeLedger,
} from './drives.mjs';
import { createHeartbeatHandler, decideIntent, heartbeatSchemaFor, pickLifeKind } from './heartbeat.mjs';

const AT = new Date('2026-10-14T20:00:00.000Z'); // 芝加哥 15:00
const CHAR = 'lumi';
const H = 3_600_000;

const freshDb = () => {
    const db = openDb(':memory:');
    upsertCharacter(db, { charId: CHAR, displayName: '露米', runtime: 'api', credRef: 'lumi' });
    return db;
};

test('时间：往基线回；久不说话「想你」的基线往上爬，有封顶', () => {
    const start = { ...freshState(DEFAULT_BASELINE, AT), values: { ...DEFAULT_BASELINE, stress: 0.8 } };
    const later = evolve(start, new Date(AT.getTime() + 8 * H), { silenceHours: 0, localHour: 15 });
    assert.ok(later.values.stress < 0.5 && later.values.stress > DEFAULT_BASELINE.stress, '八小时回了一半');
    const lonely = evolve(freshState(DEFAULT_BASELINE, AT), new Date(AT.getTime() + 30 * H), { silenceHours: 30, localHour: 15 });
    assert.ok(lonely.values.miss > DEFAULT_BASELINE.miss + 0.2);
    assert.ok(lonely.values.miss <= DEFAULT_BASELINE.miss + 0.35 + 1e-9);
    const night = evolve(freshState(DEFAULT_BASELINE, AT), new Date(AT.getTime() + 12 * H), { localHour: 23 });
    assert.ok(night.values.tired > DEFAULT_BASELINE.tired, '深夜累一点');
});

test('好奇、社交：多久没做越想，夜里不加，真做完时钟重来；回味夜里浮一点、要有事推才显示（2026-11-04）', () => {
    // AT = 芝加哥 15:00；一路醒着到 22:00（7 小时）——还没到显示
    const s0 = freshState(DEFAULT_BASELINE, AT);
    const day = evolve(s0, new Date(AT.getTime() + 7 * H), { localHour: 22 });
    assert.ok(day.values.social > DEFAULT_BASELINE.social && day.values.curious > DEFAULT_BASELINE.curious, '白天在涨');
    // 一整个白天（8 点起到 22 点）没找过人：晚上「想找朋友说说话」
    const morning = { ...freshState(DEFAULT_BASELINE, AT) };
    let st = morning;
    for (let h = 1; h <= 14; h += 1) st = evolve(st, new Date(AT.getTime() + h * H), { localHour: 8 + h });
    assert.match(formatFeelings(st, { userName: '她' }).text, /想找朋友说说话/);
    // 有封顶
    let long = freshState(DEFAULT_BASELINE, AT);
    for (let h = 1; h <= 60; h += 1) long = evolve(long, new Date(AT.getTime() + h * H), { localHour: 12 });
    assert.ok(long.values.social <= DEFAULT_BASELINE.social + 0.3 + 1e-9);
    assert.ok(long.values.curious <= DEFAULT_BASELINE.curious + 0.25 + 1e-9);
    // 夜里不加：同样隔 7 小时，凌晨那段基线不动
    const night = evolve(freshState(DEFAULT_BASELINE, AT), new Date(AT.getTime() + 7 * H), { localHour: 3 });
    assert.ok(Math.abs(night.values.social - DEFAULT_BASELINE.social) < 1e-9);
    // 真做完：时钟重来、数值落
    const done = satisfy(long, 'chat', { now: new Date(AT.getTime() + 60 * H) }).state;
    assert.equal(done.satisfiedAt.social, new Date(AT.getTime() + 60 * H).toISOString());
    assert.ok(done.values.social < long.values.social);
    const after = evolve(done, new Date(AT.getTime() + 61 * H), { localHour: 12 });
    assert.ok(after.values.social < long.values.social, '刚聊完不会马上又想');
    // 跟朋友玩得开心也算社交满足过
    const fun = applyLabel(long, { label: 'friend_fun', source: 'heartbeat', now: new Date(AT.getTime() + 60 * H) }).state;
    assert.equal(fun.satisfiedAt.social, new Date(AT.getTime() + 60 * H).toISOString());
    // 回味：夜里单靠时段到不了显示门槛；她翻旧照片 + 自己想起旧事才显示
    const quietNight = evolve(freshState(DEFAULT_BASELINE, AT), new Date(AT.getTime() + 6 * H), { localHour: 21 });
    assert.doesNotMatch(formatFeelings(quietNight).text, /以前的事/);
    let memo = applyLabel(quietNight, { label: 'reminiscing', now: new Date(AT.getTime() + 6 * H) }).state;
    memo = applyLabel(memo, { label: 'old_memory', source: 'heartbeat', now: new Date(AT.getTime() + 6 * H) }).state;
    assert.match(formatFeelings(memo).text, /以前的事/);
    // 新的自身经历都认
    for (const label of ['bored', 'new_thing', 'lonely_day', 'old_memory']) {
        assert.ok(applyLabel(s0, { label, source: 'heartbeat', now: AT }).changes.length > 0, label);
    }
});

test('标签：负面的没有原话不收；同一标签 15 分钟内打折；一次最多推 0.2', () => {
    const s0 = freshState(DEFAULT_BASELINE, AT);
    assert.equal(applyLabel(s0, { label: 'cold', quote: '', now: AT }).rejected, 'no_quote');
    const first = applyLabel(s0, { label: 'broken_promise', quote: '啊我忘了，下次一定', now: AT });
    const firstDelta = first.changes.find(c => c.drive === 'sulk').delta;
    assert.ok(firstDelta > 0 && firstDelta <= 0.2 + 1e-9);
    assert.equal(first.state.sulkEvidence.quote, '啊我忘了，下次一定');
    const second = applyLabel(first.state, { label: 'broken_promise', quote: '又忘了', now: new Date(AT.getTime() + 5 * 60_000) });
    assert.ok(second.changes.find(c => c.drive === 'sulk').delta < firstDelta, '重复打折');
    // 和好：别扭大幅落，作证的原话清掉
    const made = applyLabel(second.state, { label: 'reassuring', now: new Date(AT.getTime() + 10 * 60_000) });
    assert.ok(made.state.values.sulk < second.state.values.sulk);
    assert.equal(made.state.sulkEvidence, null);
    assert.equal(applyLabel(s0, { label: 'made_up', now: AT }).rejected, 'unknown_label');
});

test('别扭最多一天：距最后一次作证满 24 小时就回基线', () => {
    const angry = applyLabel(freshState(DEFAULT_BASELINE, AT), { label: 'conflict', quote: '随便你', now: AT }).state;
    const nextDay = evolve(angry, new Date(AT.getTime() + SULK_MAX_MS + 60_000), { localHour: 15 });
    assert.equal(nextDay.values.sulk, DEFAULT_BASELINE.sulk);
    assert.equal(nextDay.sulkEvidence, null);
});

test('真做完才落；开口系数封在 0.5–1.6；感受只写一两句、不出现数字', () => {
    const missing = { ...freshState(DEFAULT_BASELINE, AT), values: { ...DEFAULT_BASELINE, miss: 0.9 } };
    assert.ok(satisfy(missing, 'message').state.values.miss < 0.5);
    assert.ok(chanceFactor(missing) > 1.4 && chanceFactor(missing) <= 1.6);
    const tired = { ...freshState(DEFAULT_BASELINE, AT), values: { ...DEFAULT_BASELINE, tired: 1, sulk: 1 } };
    assert.equal(chanceFactor(tired), 0.5);
    const feelings = formatFeelings(missing, { userName: '阿萌' });
    assert.equal(feelings.top, 'miss');
    assert.match(feelings.text, /你有点想阿萌了/);
    assert.doesNotMatch(feelings.text, /\d/);
    assert.equal(formatFeelings(freshState(DEFAULT_BASELINE, AT)).text, '', '都在基线附近就不写');
    assert.deepEqual(summarizeForPhone(missing), [{ drive: 'miss', level: 'high' }]);
    const social = lifeWeightFactors({ ...freshState(DEFAULT_BASELINE, AT), values: { ...DEFAULT_BASELINE, social: 0.9 } });
    assert.ok(social.chat > lifeWeightFactors(freshState(DEFAULT_BASELINE, AT)).chat);
});

test('别扭：失约 / 吵架一次就够主动提；冷淡一次只是心里有点堵', () => {
    const s0 = freshState(DEFAULT_BASELINE, AT);
    assert.equal(grievanceOf(s0), null);
    const once = applyLabel(s0, { label: 'broken_promise', quote: '晚上视频我忘了', now: AT }).state;
    assert.equal(grievanceOf(once)?.quote, '晚上视频我忘了');
    const cold = applyLabel(s0, { label: 'cold', quote: '嗯', now: AT }).state;
    assert.equal(grievanceOf(cold), null, '冷淡一次不够主动提');
    assert.match(formatFeelings(cold, { userName: '阿萌' }).text, /心里还有点堵：阿萌说过「嗯」/, '但感受里有');
});

test('在不在一块：同居在家时「想你」往下回，今天能见慢慢涨，异国涨得快；撒娇在一块是满足、分开是更想见', () => {
    // 五小时后（判断 6 小时内有效）
    const later = new Date(AT.getTime() + 5 * H);
    const run = value => evolve(withApartness(freshState(DEFAULT_BASELINE, AT), value, AT), later, { silenceHours: 5, localHour: 23 }).values.miss;
    assert.ok(run('together') < DEFAULT_BASELINE.miss);
    assert.ok(run('today') > DEFAULT_BASELINE.miss && run('today') < run('far'));
    assert.ok(run('unknown') > run('today') && run('unknown') < run('far'));
    // 过了 6 小时没再判断：当作看不出来
    assert.equal(apartnessOf(withApartness(freshState(DEFAULT_BASELINE, AT), 'far', AT), new Date(AT.getTime() + 7 * H)), 'unknown');
    assert.equal(withApartness(freshState(DEFAULT_BASELINE, AT), 'bogus', AT).apartness, undefined);
    const hug = value => applyLabel(withApartness(freshState(DEFAULT_BASELINE, AT), value, AT), { label: 'affectionate', now: AT }).state.values.miss;
    assert.ok(hug('together') < DEFAULT_BASELINE.miss, '在一块撒娇：满足了');
    assert.ok(hug('far') > DEFAULT_BASELINE.miss, '隔着半个地球撒娇：更想见');
});

test('手机送来的事件：落账、存状态；同一句 30 分钟内不重复记', () => {
    const db = freshDb();
    const events = [{ label: 'vulnerable', quote: '今天好难受' }, { label: 'neutral' }, { label: 'cold' }, { label: 'nonsense' }];
    assert.equal(ingestChatEvents(db, { charId: CHAR, events, now: AT }), 1, '中性的、没原话的负面、不认识的都不收');
    assert.equal(ingestChatEvents(db, { charId: CHAR, events, now: new Date(AT.getTime() + 10 * 60_000) }), 0);
    const rows = db.prepare('SELECT drive, label, reason FROM drive_ledger').all();
    assert.deepEqual(rows.map(r => [r.drive, r.label, r.reason]), [['concern', 'vulnerable', '今天好难受']]);
    assert.ok(loadState(db, CHAR, AT).values.concern > DEFAULT_BASELINE.concern);
});

test('抽签：系数只动普通开口那一档，封顶 0.75；欠着回复照样必回', () => {
    const snapshot = { payload: { timezone: 'America/Chicago' } };
    const base = decideIntent({ snapshot, now: AT, timezone: 'America/Chicago', minutesSinceContact: 600, rng: () => 0.99 });
    const boosted = decideIntent({ snapshot, now: AT, timezone: 'America/Chicago', minutesSinceContact: 600, rng: () => 0.99, chanceFactor: 1.6 });
    assert.ok(boosted.chance > base.chance);
    assert.ok(boosted.chance <= 0.75);
    assert.equal(decideIntent({ snapshot, now: AT, timezone: 'America/Chicago', owed: true, rng: () => 0.99, chanceFactor: 0.5 }).chance, 1);
    // 生活小事：没有系数时原表；社交系数大时更容易抽到聊天
    const roll = () => 0.5;
    assert.equal(pickLifeKind(15 * 60, roll), pickLifeKind(15 * 60, roll, null));
    let chats = 0;
    for (let i = 0; i < 100; i += 1) if (['chat', 'social'].includes(pickLifeKind(15 * 60, () => i / 100, { chat: 2, social: 2 }))) chats += 1;
    assert.ok(chats > 70);
});

const seedSnapshot = (db, payload = {}) => putSnapshot(db, {
    charId: CHAR,
    builtAt: new Date(AT.getTime() - 60_000).toISOString(),
    payload: {
        identity: { name: '露米', persona: '……' }, user: { name: '阿萌' }, timezone: 'America/Chicago',
        sleepWindow: { start: '00:30', end: '08:00' }, ...payload,
    },
}, AT);

const handlerFor = (db, runner, { rng = () => 0.99, deliver = async () => {} } = {}) => createHeartbeatHandler({
    db, config: { heartbeatTimeoutMs: 1000 }, runners: { api: runner }, scheduleNext: () => {}, now: () => AT, rng, deliver,
});

test('心跳：感受进提示词；selfEvents 和真做完的事落进心思账', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    setSetting(db, 'drives_trial', JSON.stringify({ enabled: false }));
    const character = upsertCharacter(db, { charId: CHAR, heartbeatEnabled: true });
    seedSnapshot(db, { todaySchedule: [{ start: '09:00', end: '18:00', title: '上班', availability: 'busy' }] });
    saveState(db, CHAR, { ...freshState(DEFAULT_BASELINE, AT), values: { ...DEFAULT_BASELINE, stress: 0.6 } });
    let system = '';
    const runner = { run: async args => { system = args.system; return { ok: true, output: { action: 'noop', activity: '改方案', reason: '', urge: 'none', selfEvents: ['work_trouble'], together: 'today' } }; } };
    await handlerFor(db, runner)({ uuid: 'd1', kind: 'heartbeat', charId: CHAR, generation: character.heartbeatGeneration, attempts: 1 });
    assert.match(system, /工作上的事压得你有点烦/);
    assert.match(system, /together：你们此刻在不在一块/);
    const ledger = db.prepare('SELECT drive, label, source FROM drive_ledger').all();
    assert.ok(ledger.some(r => r.label === 'work_trouble' && r.drive === 'stress' && r.source === 'heartbeat'));
    assert.equal(apartnessOf(loadState(db, CHAR, AT), AT), 'today', '判断存下来了');
});

test('心跳：念想那种最强时发的消息，锁屏预览藏起来', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    setSetting(db, 'drives_trial', JSON.stringify({ enabled: false }));
    const character = upsertCharacter(db, { charId: CHAR, heartbeatEnabled: true });
    seedSnapshot(db);
    saveState(db, CHAR, { ...freshState(DEFAULT_BASELINE, AT), values: { ...DEFAULT_BASELINE, desire: 0.95 } });
    const sent = [];
    const runner = { run: async () => ({ ok: true, output: { action: 'message', activity: '躺着', reason: '', text: '想你了' } }) };
    await handlerFor(db, runner, { rng: () => 0, deliver: async e => sent.push(e) })({ uuid: 'd2', kind: 'heartbeat', charId: CHAR, generation: character.heartbeatGeneration, attempts: 1 });
    const message = sent.find(e => e.kind === 'chat_message');
    assert.equal(message.body, '露米给你发来一条消息');
    assert.equal(message.payload.text, '想你了', '点开照样是原话');
});

test('心跳：别扭有原话作证时，开口的缘由可以是把不满说出来', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    setSetting(db, 'drives_trial', JSON.stringify({ enabled: false }));
    const character = upsertCharacter(db, { charId: CHAR, heartbeatEnabled: true });
    seedSnapshot(db);
    let s = freshState(DEFAULT_BASELINE, new Date(AT.getTime() - H));
    s = applyLabel(s, { label: 'broken_promise', quote: '晚上视频我忘了', now: new Date(AT.getTime() - H) }).state;
    s = applyLabel(s, { label: 'dismissive', quote: '嗯嗯', now: new Date(AT.getTime() - 30 * 60_000) }).state;
    saveState(db, CHAR, s);
    let system = '';
    const runner = { run: async args => { system = args.system; return { ok: true, output: { action: 'message', activity: '下班', reason: '', text: '你昨晚说好的视频呢' } }; } };
    await handlerFor(db, runner, { rng: () => 0 })({ uuid: 'd3', kind: 'heartbeat', charId: CHAR, generation: character.heartbeatGeneration, attempts: 1 });
    assert.match(system, /心里还有点堵/);
    assert.ok(loadState(db, CHAR, AT).values.sulk < s.values.sulk, '说出来了就落一截');
});

test('性欲（念想）：调情往上冲；事后才算满足，之后 3 小时不应期；早上小脉冲；累了、上班时压着', () => {
    const together = withApartness(freshState(DEFAULT_BASELINE, AT), 'together', AT);
    const apart = withApartness(freshState(DEFAULT_BASELINE, AT), 'far', AT);
    assert.ok(applyLabel(apart, { label: 'flirt', now: AT }).state.values.desire > DEFAULT_BASELINE.desire);
    assert.ok(applyLabel(together, { label: 'flirt', now: AT }).state.values.desire > DEFAULT_BASELINE.desire, '在一块调情也是升温，不是满足');
    assert.ok(applyLabel(apart, { label: 'intimate', now: AT }).state.values.desire > DEFAULT_BASELINE.desire, '旧标签当调情');
    const after = applyLabel({ ...together, values: { ...together.values, desire: 0.7 } }, { label: 'intimacy_done', now: AT }).state;
    assert.ok(Math.abs(after.values.desire - 0.28) < 1e-9, '落到四成');
    assert.ok(after.desireRefractoryUntil);
    const flirtDuring = applyLabel(after, { label: 'affectionate', now: new Date(AT.getTime() + H) }).state;
    assert.ok(flirtDuring.values.desire <= after.values.desire + 1e-9, '不应期里不再往上推');
    const morning = evolve(freshState(DEFAULT_BASELINE, AT), new Date(AT.getTime() + 2 * H), { localHour: 7 }).values.desire;
    const noon = evolve(freshState(DEFAULT_BASELINE, AT), new Date(AT.getTime() + 2 * H), { localHour: 12 }).values.desire;
    const working = evolve(freshState(DEFAULT_BASELINE, AT), new Date(AT.getTime() + 2 * H), { localHour: 12, busy: true }).values.desire;
    assert.ok(morning > noon && noon > working);
});

test('脾气读数：基线、敏感度、回落快慢按角色自己的；不适用的固定为 0；压力出口写进感受', async () => {
    const { applyTemperament, temperamentFrom } = await import('./drives.mjs');
    assert.equal(temperamentFrom(null), null);
    const touchy = applyTemperament(freshState(DEFAULT_BASELINE, AT), {
        baseline: { miss: 'high', social: 'low' }, sensitivity: { sulk: 'high' }, recovery: 'slow', stressOutlet: 'friends', disabled: ['desire'],
    });
    assert.ok(touchy.baseline.miss > DEFAULT_BASELINE.miss);
    assert.ok(touchy.baseline.social < DEFAULT_BASELINE.social);
    assert.equal(touchy.values.desire, 0);
    const easy = applyTemperament(freshState(DEFAULT_BASELINE, AT), { sensitivity: { sulk: 'low' }, recovery: 'fast' });
    const hurt = st => applyLabel(st, { label: 'cold', quote: '嗯', now: AT }).state.values.sulk;
    assert.ok(hurt(touchy) > hurt(easy), '同一句「嗯」，敏感的人更在意');
    assert.equal(applyLabel(touchy, { label: 'flirt', now: AT }).state.values.desire, 0, '不适用的不涨');
    const stressed = { ...touchy, values: { ...touchy.values, stress: 0.8 } };
    assert.match(formatFeelings(stressed).text, /习惯找朋友吐槽/);
    assert.ok(lifeWeightFactors(stressed).chat > lifeWeightFactors({ ...stressed, stressOutlet: null }).chat);
    // 慢的人别扭消得慢
    const slowLater = evolve({ ...touchy, values: { ...touchy.values, sulk: 0.6 } }, new Date(AT.getTime() + 6 * H), { localHour: 15 }).values.sulk;
    const fastLater = evolve({ ...easy, values: { ...easy.values, sulk: 0.6 } }, new Date(AT.getTime() + 6 * H), { localHour: 15 }).values.sulk;
    assert.ok(slowLater > fastLater);
});

test('两个人的时间：说要开始了就进去，事后就出来，最多两小时；这期间心跳连模型都不叫，手动补跑也一样', async () => {
    const { PRIVATE_MOMENT_MS, inPrivateMoment } = await import('./drives.mjs');
    const s0 = withApartness(freshState(DEFAULT_BASELINE, AT), 'together', AT);
    const going = applyLabel(applyLabel(s0, { label: 'flirt', now: AT }).state, { label: 'getting_intimate', now: AT }).state;
    assert.equal(inPrivateMoment(going, new Date(AT.getTime() + H)), true);
    assert.equal(inPrivateMoment(going, new Date(AT.getTime() + PRIVATE_MOMENT_MS + 1)), false, '最多两小时');
    const done = applyLabel(going, { label: 'intimacy_done', now: new Date(AT.getTime() + 70 * 60_000) }).state;
    assert.equal(inPrivateMoment(done, new Date(AT.getTime() + 80 * 60_000)), false, '事后就结束');
    assert.ok(done.values.desire < going.values.desire);
    assert.ok(done.desireRefractoryUntil);

    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = upsertCharacter(db, { charId: CHAR, heartbeatEnabled: true });
    seedSnapshot(db);
    saveState(db, CHAR, going);
    let called = false;
    const runner = { run: async () => { called = true; return { ok: true, output: { action: 'message', activity: '等她洗澡', reason: '', text: '在干嘛' } }; } };
    const result = await handlerFor(db, runner)({ uuid: 'manual:x', kind: 'heartbeat', charId: CHAR, generation: character.heartbeatGeneration, attempts: 1, input: { retry: 1 } });
    assert.deepEqual(result, { skipped: 'private_moment' });
    assert.equal(called, false, '模型都不叫');
    assert.equal(db.prepare("SELECT skip_gate FROM model_runs ORDER BY id DESC LIMIT 1").get().skip_gate, 'private_moment');
});

test('两个人的时间：不应期里第二次说要开始了，照样进去（数值不动也要存状态）', () => {
    const db = freshDb();
    const at = min => new Date(AT.getTime() + min * 60_000);
    ingestChatEvents(db, { charId: CHAR, events: [{ label: 'getting_intimate' }], now: at(0) });
    ingestChatEvents(db, { charId: CHAR, events: [{ label: 'intimacy_done' }], now: at(60) });
    assert.ok(loadState(db, CHAR, at(61)).desireRefractoryUntil, '进了不应期');
    assert.equal(ingestChatEvents(db, { charId: CHAR, events: [{ label: 'getting_intimate' }], now: at(150) }), 1);
    assert.equal(privateMomentOf(loadState(db, CHAR, at(151)), at(160)).active, true);
});

test('贴贴按钮：手动开始、自动猜的「事后」不替她关、手动结束才算满足', () => {
    const db = freshDb();
    const at = min => new Date(AT.getTime() + min * 60_000);
    const on = setPrivateMoment(db, { charId: CHAR, on: true, now: at(0) });
    assert.equal(on.active, true);
    assert.equal(on.source, 'manual');
    ingestChatEvents(db, { charId: CHAR, events: [{ label: 'intimacy_done' }], now: at(30) });
    assert.equal(privateMomentOf(loadState(db, CHAR, at(31)), at(31)).active, true, '副 API 猜的不算数');
    const desireBefore = loadState(db, CHAR, at(40)).values.desire;
    const off = setPrivateMoment(db, { charId: CHAR, on: false, now: at(40) });
    assert.equal(off.active, false);
    const after = loadState(db, CHAR, at(41));
    assert.ok(after.values.desire < desireBefore, '念想落下来');
    assert.ok(Date.parse(after.desireRefractoryUntil) > at(41).getTime(), '进不应期');
    assert.ok(db.prepare("SELECT 1 FROM drive_ledger WHERE label = 'intimacy_done' AND source = 'manual'").get(), '记进心思账');
    // 忘了按结束：两小时后自己出来
    setPrivateMoment(db, { charId: CHAR, on: true, now: at(300) });
    assert.equal(privateMomentOf(loadState(db, CHAR, at(301)), at(300 + 121)).active, false);
});

test('贴贴不算数：副 API 猜错开的，她说「不是」只关掉——念想不落、不进不应期、不记「事后」', () => {
    const db = freshDb();
    const at = min => new Date(AT.getTime() + min * 60_000);
    ingestChatEvents(db, { charId: CHAR, events: [{ label: 'getting_intimate', quote: '你好坏' }], now: at(0) });
    const on = privateMomentOf(loadState(db, CHAR, at(1)), at(1));
    assert.equal(on.active, true);
    assert.equal(on.source, 'auto');
    const before = loadState(db, CHAR, at(2));
    const off = cancelPrivateMoment(db, { charId: CHAR, now: at(2) });
    assert.equal(off.active, false);
    const after = loadState(db, CHAR, at(3));
    assert.equal(after.values.desire, before.values.desire, '念想没被当成满足');
    assert.ok(!after.desireRefractoryUntil || Date.parse(after.desireRefractoryUntil) < at(3).getTime(), '没进不应期');
    assert.equal(db.prepare("SELECT 1 FROM drive_ledger WHERE label = 'intimacy_done'").get(), undefined);
});

test('排队补送的事件按真发生的时刻算：三小时前的「说要开始了」现在不再拦心跳', () => {
    const db = freshDb();
    const old = new Date(AT.getTime() - 3 * H).toISOString();
    ingestChatEvents(db, { charId: CHAR, events: [{ label: 'getting_intimate', at: old }], now: AT });
    assert.equal(privateMomentOf(loadState(db, CHAR, AT), AT).active, false);
    // 时间写坏了 / 太旧 / 在将来：按现在算
    ingestChatEvents(db, { charId: CHAR, events: [{ label: 'getting_intimate', at: 'nope' }], now: AT });
    assert.equal(privateMomentOf(loadState(db, CHAR, AT), AT).active, true);
});

test('试运行（默认开）：照常记账，但感受不进提示词、念想不藏预览', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    assert.equal(isDriveTrial(db), true, '默认试运行');
    const character = upsertCharacter(db, { charId: CHAR, heartbeatEnabled: true });
    seedSnapshot(db, { todaySchedule: [{ start: '09:00', end: '18:00', title: '上班', availability: 'busy' }] });
    saveState(db, CHAR, { ...freshState(DEFAULT_BASELINE, AT), values: { ...DEFAULT_BASELINE, stress: 0.6, desire: 0.9 } });
    let system = '';
    const sent = [];
    const runner = { run: async args => { system = args.system; return { ok: true, output: { action: 'message', activity: '改方案', reason: '', urge: 'none', text: '想你了', selfEvents: ['work_trouble'], together: 'today' } }; } };
    await handlerFor(db, runner, { rng: () => 0, deliver: async e => sent.push(e) })({ uuid: 't1', kind: 'heartbeat', charId: CHAR, generation: character.heartbeatGeneration, attempts: 1 });
    assert.doesNotMatch(system, /你此刻身上的感觉/);
    assert.equal(sent.find(e => e.kind === 'chat_message')?.body, '想你了');
    assert.ok(db.prepare("SELECT 1 FROM drive_ledger WHERE label = 'work_trouble'").get(), '账照记');
});

test('心跳等模型时聊天送来的标签不会被心跳写回时盖掉', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    const character = upsertCharacter(db, { charId: CHAR, heartbeatEnabled: true });
    seedSnapshot(db);
    const runner = { run: async () => {
        // 模型还没回来，她在聊天里放了鸽子、又说去洗澡等他
        ingestChatEvents(db, { charId: CHAR, events: [{ label: 'broken_promise', quote: '啊我忘了' }, { label: 'getting_intimate' }], now: AT });
        return { ok: true, output: { action: 'noop', activity: '看书', reason: '', urge: 'none', together: 'together' } };
    } };
    await handlerFor(db, runner)({ uuid: 'r1', kind: 'heartbeat', charId: CHAR, generation: character.heartbeatGeneration, attempts: 1 });
    const state = loadState(db, CHAR, AT);
    assert.equal(state.sulkEvidence?.quote, '啊我忘了');
    assert.equal(privateMomentOf(state, AT).active, true);
    assert.equal(apartnessOf(state, AT), 'together', '心跳自己的判断也存上了');
});

test('schema：together 每跳必填，selfEvents 过日子那跳必填（Gemini 不写选填项）', async () => {
    const db = freshDb();
    const character = upsertCharacter(db, { charId: CHAR, heartbeatEnabled: true });
    seedSnapshot(db, { todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }] });
    const schemas = [];
    const runner = { run: async ({ schema }) => { schemas.push(schema); return { ok: true, output: { action: 'noop', activity: 'x', reason: '', urge: 'none' } }; } };
    await handlerFor(db, runner, { rng: () => 0.99 })({ uuid: 's1', kind: 'heartbeat', charId: CHAR, generation: character.heartbeatGeneration, attempts: 1 });
    assert.ok(schemas[0].required.includes('together'));
    const live = heartbeatSchemaFor({ life: 'chat', together: true, selfEvents: true });
    assert.ok(live.required.includes('selfEvents') && live.required.includes('together'));
});

test('GET /drives 跟心跳算的一样：异国十小时没说话，查手机也看得到「有点想你」', async () => {
    const db = freshDb();
    const { createRouter } = await import('./server.mjs');
    const routes = createRouter({ db, config: {} });
    seedSnapshot(db, { lastInteraction: { userAt: new Date(Date.now() - 10 * H).toISOString() } });
    saveState(db, CHAR, withApartness(freshState(DEFAULT_BASELINE, new Date(Date.now() - 10 * H)), 'far', new Date(Date.now() - 1000)));
    const result = routes['GET /drives'].handle({ query: new URLSearchParams({ charId: CHAR }) });
    assert.equal(result.drives[0]?.drive, 'miss');
    assert.equal(result.private.active, false);
});

test('窗台七日心事：每天记峰值、今天用此刻补、上线前那几天拿心思账顶上，只给五档', () => {
    const db = freshDb();
    const day = n => new Date(AT.getTime() - n * 24 * H);
    // 三天前：想你高出平常 0.4（很想），存了一次状态
    saveState(db, CHAR, { ...freshState(DEFAULT_BASELINE, day(3)), values: { ...DEFAULT_BASELINE, miss: DEFAULT_BASELINE.miss + 0.4 }, updatedAt: day(3).toISOString() });
    // 同一天后来回落：峰值不被冲掉
    saveState(db, CHAR, { ...freshState(DEFAULT_BASELINE, day(3)), updatedAt: new Date(day(3).getTime() + H).toISOString() });
    // 五天前没存过状态，只有心思账：好奇到过平常 +0.2
    writeLedger(db, CHAR, [{ drive: 'curious', delta: 0.2, valueAfter: DEFAULT_BASELINE.curious + 0.2, source: 'heartbeat', label: 'x', reason: 'x' }], day(5));
    const current = { ...freshState(DEFAULT_BASELINE, AT), values: { ...DEFAULT_BASELINE, tired: DEFAULT_BASELINE.tired + 0.1 } };
    const week = weekOf(db, CHAR, current, AT);
    assert.equal(week.days.length, 7);
    assert.equal(week.days[6], '2026-10-14');
    const row = drive => week.rows.find(r => r.drive === drive).levels;
    assert.equal(row('miss')[3], 4, '三天前很想');
    assert.equal(row('miss')[6], 0);
    assert.equal(row('curious')[1], 2, '心思账顶上');
    assert.equal(row('tired')[6], 1, '今天用此刻');
    assert.deepEqual([0, 0.05, 0.15, 0.25, 0.35].map(peakLevel), [0, 1, 2, 3, 4]);
});

test('GET /drives/week：没给角色就是空的；给了就是九种七天', async () => {
    const db = freshDb();
    const { createRouter } = await import('./server.mjs');
    const routes = createRouter({ db, config: {} });
    assert.deepEqual(routes['GET /drives/week'].handle({ query: new URLSearchParams() }), { days: [], rows: [] });
    const result = routes['GET /drives/week'].handle({ query: new URLSearchParams({ charId: CHAR }) });
    assert.equal(result.rows.length, 9);
    assert.ok(result.rows.every(r => r.levels.length === 7 && r.levels.every(v => v >= 0 && v <= 4)));
});

test('挂心：没原话不算；同一句话 12 小时内只算一次；一件事实不够、真难受一次就够（2026-11-10）', () => {
    const feels = db => summarizeForPhone(loadState(db, CHAR, AT)).some(d => d.drive === 'concern');
    // 没原话：不收
    let db = freshDb();
    assert.equal(ingestChatEvents(db, { charId: CHAR, events: [{ label: 'vulnerable' }], now: AT }), 0);
    assert.equal(feels(db), false);
    // 一件挂心的事实：还不到「有点挂心」
    db = freshDb();
    ingestChatEvents(db, { charId: CHAR, events: [{ label: 'concern_fact', quote: '明天考试' }], now: AT });
    assert.equal(feels(db), false);
    // 隔两小时又一件：够了
    ingestChatEvents(db, { charId: CHAR, events: [{ label: 'concern_fact', quote: '下午要去看医生' }], now: new Date(AT.getTime() + 2 * H) });
    assert.equal(summarizeForPhone(loadState(db, CHAR, new Date(AT.getTime() + 2 * H))).some(d => d.drive === 'concern'), true);
    // 真难受一次就够；同一句话下一轮又被标、几小时后再被标，都不再加
    db = freshDb();
    assert.equal(ingestChatEvents(db, { charId: CHAR, events: [{ label: 'vulnerable', quote: '我哭了一晚上' }], now: AT }), 1);
    assert.equal(feels(db), true);
    const once = loadState(db, CHAR, AT).values.concern;
    assert.equal(ingestChatEvents(db, { charId: CHAR, events: [{ label: 'vulnerable', quote: '我哭了一晚上' }], now: new Date(AT.getTime() + 3 * H) }), 0);
    assert.ok(loadState(db, CHAR, new Date(AT.getTime() + 3 * H)).values.concern <= once);
});
