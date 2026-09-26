import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb, setSetting } from './db.mjs';
import { toCharacter, upsertCharacter } from './characters.mjs';
import { putSnapshot } from './snapshots.mjs';
import { createHeartbeatHandler, listModelRuns, recordModelRun } from './heartbeat.mjs';
import { formatEtaForPrompt, formatPurchasesForPrompt, formatShipOptions, pickEtas, recentPurchases, withEta } from './shopping.mjs';

const TZ = 'America/Chicago';
// 芝加哥 2026-09-26（周六）晚上 7 点
const AT = new Date('2026-09-27T00:00:00.000Z');
const CHAR = 'lumi';

const localHour = date => +new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(date);

test('送达时刻：外卖 30–50 分钟；网购当天达 2–4 小时、次日达明天白天、普通快递第 2–5 天白天', () => {
    // 周六下午 1 点下单：当天达还来得及
    const noon = new Date('2026-09-26T18:00:00.000Z');
    const low = pickEtas(noon, TZ, () => 0);
    assert.equal(low.food.getTime() - noon.getTime(), 30 * 60_000);
    assert.equal(low.net.same_day.getTime() - noon.getTime(), 2 * 3_600_000);
    assert.equal(formatEtaForPrompt(low.net.same_day, noon, TZ), '今天下午3:00');
    assert.equal(formatEtaForPrompt(low.net.next_day, noon, TZ), '明天上午10:00');
    assert.equal(formatEtaForPrompt(low.net.standard, noon, TZ), '周一（9月28日）上午10:00');

    const high = pickEtas(noon, TZ, () => 0.999);
    assert.equal(high.food.getTime() - noon.getTime(), 50 * 60_000);
    assert.equal(formatEtaForPrompt(high.net.same_day, noon, TZ), '今天下午5:00');
    assert.equal(localHour(high.net.next_day), 19);
    assert.equal(formatEtaForPrompt(high.net.standard, noon, TZ), '周四（10月1日）晚上7:59');

    // 晚上 7 点下单：2 小时后已经 9 点，当天达不给了
    assert.equal(pickEtas(AT, TZ, () => 0).net.same_day, null);

    for (let i = 0; i < 200; i += 1) {
        const { food, net } = pickEtas(noon, TZ);
        assert.ok(food > noon && net.next_day > food && net.standard > net.next_day);
        for (const at of [net.next_day, net.standard]) assert.ok(localHour(at) >= 10 && localHour(at) < 20);
        if (net.same_day) assert.ok(localHour(net.same_day) < 21);
    }
});

test('送达时刻挂到 life 上：外卖用外卖的；网购按选的配送，没选当普通快递，当天达来不及退成次日达', () => {
    const food = new Date('2026-09-27T00:40:00.000Z');
    const net = { same_day: new Date('2026-09-26T22:00:00.000Z'), next_day: new Date('2026-09-27T16:00:00.000Z'), standard: new Date('2026-09-29T20:00:00.000Z') };
    const etas = { food, net };
    assert.equal(withEta({ kind: 'delivery', with: '店' }, etas).eta, food.toISOString());
    assert.equal(withEta({ kind: 'order', with: '青菜', ship: 'same_day' }, etas).eta, net.same_day.toISOString());
    assert.equal(withEta({ kind: 'order', with: '纸巾', ship: 'next_day' }, etas).eta, net.next_day.toISOString());
    assert.equal(withEta({ kind: 'order', with: '书' }, etas).eta, net.standard.toISOString());
    assert.equal(withEta({ kind: 'order', with: '青菜', ship: 'same_day' }, { food, net: { ...net, same_day: null } }).eta, net.next_day.toISOString());
    assert.equal(withEta({ kind: 'gift', with: '奶茶', via: 'food', ship: 'standard' }, etas).eta, food.toISOString());
    assert.equal(withEta({ kind: 'gift', with: '花', via: 'net', ship: 'same_day' }, etas).eta, net.same_day.toISOString());
    assert.equal(withEta({ kind: 'chat', with: '林越' }, etas).eta, undefined);
    assert.equal(withEta(null, etas), null);
    assert.deepEqual(withEta({ kind: 'order', with: '书' }, null), { kind: 'order', with: '书' });
});

test('配送三档写进提示词；晚上说明当天达送不了', () => {
    const noon = new Date('2026-09-26T18:00:00.000Z');
    const text = formatShipOptions(pickEtas(noon, TZ, () => 0), noon, TZ);
    assert.match(text, /"same_day"（当天达：买菜.*今天下午3:00到）/);
    assert.match(text, /"next_day"（次日达.*明天上午10:00到）/);
    assert.match(text, /"standard"（普通快递.*周一（9月28日）上午10:00到）/);
    const late = formatShipOptions(pickEtas(AT, TZ, () => 0), AT, TZ);
    assert.ok(!late.includes('same_day'));
    assert.match(late, /当天达已经送不了/);
});

test('最近买过的：只算真发生的购物，新的在前；还在路上的写出几点到', () => {
    const db = openDb(':memory:');
    const run = (hoursAgo, episode, extra = {}) => recordModelRun(db, {
        charId: CHAR, runtime: 'api', startedAt: new Date(AT.getTime() - hoursAgo * 3_600_000).toISOString(),
        ok: true, outcome: 'noop', episode, ...extra,
    });
    run(50, { life: { kind: 'order', with: '猫爬架', detail: '灰色', eta: '2026-09-28T20:00:00.000Z' } });
    run(30, { life: { kind: 'gift', with: '云朵抱枕', via: 'net' } });
    run(20, { life: { kind: 'chat', with: '林越' } });
    run(10, { life: { kind: 'delivery', with: '麻辣烫' } }, { shadow: true });
    run(24 * 9, { life: { kind: 'order', with: '太久以前的' } });
    run(5, { channel: 'group', lines: [] });

    const list = recentPurchases(db, CHAR, AT);
    assert.deepEqual(list.map(item => item.what), ['云朵抱枕', '猫爬架']);
    const text = formatPurchasesForPrompt(list, AT, TZ, '阿萌');
    assert.match(text, /给阿萌买的网购：云朵抱枕/);
    assert.match(text, /网购：猫爬架（灰色），还在路上（周一（9月28日）下午3:00到）/);
    assert.match(text, /别把同一件东西再下一单/);
    assert.equal(formatPurchasesForPrompt([], AT, TZ), '');
});

test('心跳抽中网购：提示词里有送达时间和最近买过的，送去前端的 life 带同一个 eta', async () => {
    const db = openDb(':memory:');
    setSetting(db, 'heartbeat_shadow', JSON.stringify({ enabled: false }));
    upsertCharacter(db, { charId: CHAR, displayName: '露米', runtime: 'api', credRef: 'lumi' });
    upsertCharacter(db, { charId: CHAR, heartbeatEnabled: true });
    const character = toCharacter(db.prepare('SELECT * FROM characters WHERE char_id = ?').get(CHAR));
    putSnapshot(db, {
        charId: CHAR,
        builtAt: new Date(AT.getTime() - 60_000).toISOString(),
        payload: {
            identity: { name: '露米', persona: '……' }, user: { name: '阿萌' }, timezone: TZ,
            sleepWindow: { start: '00:30', end: '08:00' },
            todaySchedule: [{ start: '18:00', title: '在家', availability: 'online' }],
        },
    }, AT);
    recordModelRun(db, {
        charId: CHAR, runtime: 'api', startedAt: new Date(AT.getTime() - 26 * 3_600_000).toISOString(),
        ok: true, outcome: 'noop', episode: { life: { kind: 'order', with: '猫爬架' } },
    });
    const prompts = [];
    const runner = {
        run: async ({ system }) => {
            prompts.push(system);
            return { ok: true, output: { action: 'noop', activity: '网购', reason: '', urge: 'none', life: { kind: 'order', with: '猫砂', value: '¥39', ship: 'next_day' } } };
        },
    };
    // 不开口 → 抽中生活 → 非饭点 order 档（0.61–0.73）→ 送达时刻的五次抽签
    const seq = [0.99, 0.3, 0.7, 0, 0, 0, 0, 0];
    let i = 0;
    const sent = [];
    await createHeartbeatHandler({
        db, config: { heartbeatTimeoutMs: 1000 }, runners: { api: runner }, scheduleNext: () => {},
        now: () => new Date(AT.getTime() + 2 * 3_600_000), rng: () => seq[i++] ?? 0.99, deliver: async e => sent.push(e),
    })({ uuid: 'shop1', kind: 'heartbeat', charId: CHAR, generation: character.heartbeatGeneration, attempts: 1 });

    assert.match(prompts[0], /"next_day"（次日达.*明天上午10:00到）/);
    assert.match(prompts[0], /当天达已经送不了/, '晚上 9 点下单');
    assert.match(prompts[0], /你最近买过的.*\n- .*网购：猫爬架/);
    const life = sent[0].payload.life;
    assert.equal(life.kind, 'order');
    assert.equal(formatEtaForPrompt(new Date(life.eta), new Date(AT.getTime() + 2 * 3_600_000), TZ), '明天上午10:00');
    assert.equal(listModelRuns(db)[0].episode.life.eta, life.eta, '起居注那边记下同一个时刻，下次列「最近买过的」用');
});
