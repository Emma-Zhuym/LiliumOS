import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb, setSetting } from './db.mjs';
import { toCharacter, upsertCharacter } from './characters.mjs';
import { putSnapshot } from './snapshots.mjs';
import { createHeartbeatHandler, listModelRuns, recordModelRun } from './heartbeat.mjs';
import { formatEtaForPrompt, formatPurchasesForPrompt, pickEtas, recentPurchases, withEta } from './shopping.mjs';

const TZ = 'America/Chicago';
// 芝加哥 2026-09-26（周六）晚上 7 点
const AT = new Date('2026-09-27T00:00:00.000Z');
const CHAR = 'lumi';

const localHour = date => +new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(date);

test('送达时刻：外卖 30–50 分钟，网购第 1–4 天的白天', () => {
    const low = pickEtas(AT, TZ, () => 0);
    assert.equal(low.food.getTime() - AT.getTime(), 30 * 60_000);
    assert.equal(localHour(low.net), 10, '最早上午 10 点');
    assert.equal(formatEtaForPrompt(low.net, AT, TZ), '明天上午10:00');

    const high = pickEtas(AT, TZ, () => 0.999);
    assert.equal(high.food.getTime() - AT.getTime(), 50 * 60_000);
    assert.equal(localHour(high.net), 19, '最晚晚上 8 点前');
    assert.equal(formatEtaForPrompt(high.net, AT, TZ), '周三（9月30日）晚上7:59');

    for (let i = 0; i < 200; i += 1) {
        const { food, net } = pickEtas(AT, TZ);
        const hours = (net.getTime() - AT.getTime()) / 3_600_000;
        assert.ok(food > AT && net > food);
        assert.ok(hours > 12 && hours < 5 * 24, `网购 ${hours} 小时后到`);
        assert.ok(localHour(net) >= 10 && localHour(net) < 20);
    }
});

test('送达时刻挂到 life 上：delivery 用外卖，order 用网购，gift 看 via；别的不动', () => {
    const etas = { food: new Date('2026-09-27T00:40:00.000Z'), net: new Date('2026-09-28T20:00:00.000Z') };
    assert.equal(withEta({ kind: 'delivery', with: '店' }, etas).eta, etas.food.toISOString());
    assert.equal(withEta({ kind: 'order', with: '书' }, etas).eta, etas.net.toISOString());
    assert.equal(withEta({ kind: 'gift', with: '奶茶', via: 'food' }, etas).eta, etas.food.toISOString());
    assert.equal(withEta({ kind: 'gift', with: '围巾', via: 'net' }, etas).eta, etas.net.toISOString());
    assert.equal(withEta({ kind: 'chat', with: '林越' }, etas).eta, undefined);
    assert.equal(withEta(null, etas), null);
    assert.deepEqual(withEta({ kind: 'order', with: '书' }, null), { kind: 'order', with: '书' });
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
            return { ok: true, output: { action: 'noop', activity: '网购', reason: '', urge: 'none', life: { kind: 'order', with: '猫砂', value: '¥39' } } };
        },
    };
    // 不开口 → 抽中生活 → 非饭点 order 档（0.61–0.73）→ 送达时刻的三次抽签
    const seq = [0.99, 0.3, 0.7, 0, 0, 0];
    let i = 0;
    const sent = [];
    await createHeartbeatHandler({
        db, config: { heartbeatTimeoutMs: 1000 }, runners: { api: runner }, scheduleNext: () => {},
        now: () => new Date(AT.getTime() + 2 * 3_600_000), rng: () => seq[i++] ?? 0.99, deliver: async e => sent.push(e),
    })({ uuid: 'shop1', kind: 'heartbeat', charId: CHAR, generation: character.heartbeatGeneration, attempts: 1 });

    assert.match(prompts[0], /这一单明天上午10:00送到/);
    assert.match(prompts[0], /你最近买过的.*\n- .*网购：猫爬架/);
    const life = sent[0].payload.life;
    assert.equal(life.kind, 'order');
    assert.equal(formatEtaForPrompt(new Date(life.eta), new Date(AT.getTime() + 2 * 3_600_000), TZ), '明天上午10:00');
    assert.equal(listModelRuns(db)[0].episode.life.eta, life.eta, '起居注那边记下同一个时刻，下次列「最近买过的」用');
});
