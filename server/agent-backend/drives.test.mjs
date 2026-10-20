/**
 * 劲儿系统（docs/spec-character-drives.md 第 5 节）。内存库、假时钟，跟真账本物理隔离。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb, setSetting } from './db.mjs';
import { upsertCharacter } from './characters.mjs';
import { putSnapshot } from './snapshots.mjs';
import {
    DEFAULT_BASELINE, SULK_MAX_MS, apartnessOf, applyLabel, chanceFactor, evolve, formatFeelings, freshState, grievanceOf,
    ingestChatEvents, lifeWeightFactors, loadState, satisfy, saveState, summarizeForPhone, withApartness,
} from './drives.mjs';
import { createHeartbeatHandler, decideIntent, pickLifeKind } from './heartbeat.mjs';

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

test('心跳：感受进提示词；selfEvents 和真做完的事落进劲儿账', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
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

test('心跳：念想那股最强时发的消息，锁屏预览藏起来', async () => {
    const db = freshDb();
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
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
