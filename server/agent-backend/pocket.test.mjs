/**
 * 话兜 + 开口缘由（docs/spec-character-drives.md 4.2–4.4）。内存库、钉死的 rng，不碰真模型。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from './db.mjs';
import { upsertCharacter } from './characters.mjs';
import { recordModelRun } from './heartbeat.mjs';
import {
    MAX_UNSAID, POCKET_SOON_MS, POCKET_TTL_MS, addPocketItem, coverage, freshnessFromText, isSelfNote, listPocketForPhone, listUnsaid, markSaid,
    settleSaidFromMessages,
} from './pocket.mjs';
import {
    REACH_REASON_WEIGHTS, formatReachReason, herSideCues, pickReachReason, recentLife, summarizeEpisode,
} from './reachOut.mjs';
import { parseEpisode, parseLife } from './runner.mjs';

const AT = new Date('2026-10-14T20:00:00.000Z');
const CHAR = 'lumi';

const freshDb = () => {
    const db = openDb(':memory:');
    upsertCharacter(db, { charId: CHAR, displayName: '露米' });
    return db;
};

test('话兜：攒一句、按先后取；空的和重复的不收', () => {
    const db = freshDb();
    assert.ok(addPocketItem(db, { charId: CHAR, text: '  今天被客户气笑了  ', now: AT }));
    assert.equal(addPocketItem(db, { charId: CHAR, text: '今天被客户气笑了', now: AT }), null, '一字不差的不重复攒');
    assert.equal(addPocketItem(db, { charId: CHAR, text: '   ', now: AT }), null);
    addPocketItem(db, { charId: CHAR, text: '楼下新开了家面馆', now: new Date(AT.getTime() + 60_000) });
    const unsaid = listUnsaid(db, CHAR, AT);
    assert.deepEqual(unsaid.map(item => item.text), ['今天被客户气笑了', '楼下新开了家面馆']);
});

test('话兜：超过名额丢最旧的；两天没说就过去了', () => {
    const db = freshDb();
    const lines = ['楼下新开了家面馆', '老周打球又输了', '同事养了只柯基', '模拟器里练侧风降落', '我爸问慈善晚宴的事', '周末想做提拉米苏', '昂哥后悔没买那瓶酒'];
    lines.forEach((text, i) => addPocketItem(db, { charId: CHAR, text, freshness: 'days', now: new Date(AT.getTime() + i * 60_000) }));
    const later = new Date(AT.getTime() + 10 * 60_000);
    const unsaid = listUnsaid(db, CHAR, later, { limit: 50 });
    assert.equal(unsaid.length, MAX_UNSAID);
    assert.equal(unsaid[0].text, '同事养了只柯基');
    assert.equal(listUnsaid(db, CHAR, new Date(AT.getTime() + POCKET_TTL_MS + 20 * 60_000)).length, 0);
});

test('话兜：说出口了就不再拿，草稿箱也不显示', () => {
    const db = freshDb();
    const item = addPocketItem(db, { charId: CHAR, text: '想给你看我拍的云', now: AT });
    assert.equal(listPocketForPhone(db, { charId: CHAR, now: AT }).length, 1);
    markSaid(db, item.id, AT);
    assert.equal(listUnsaid(db, CHAR, AT).length, 0);
    assert.equal(listPocketForPhone(db, { charId: CHAR, now: AT }).length, 0);
});

test('一件事压成一行：生活、工作都认，礼物不写（惊喜得藏住）', () => {
    assert.match(summarizeEpisode({ life: { kind: 'chat', with: '老周', lines: [{ who: '老周', text: '周末打球？' }] } }), /跟老周聊了几句：老周：周末打球？/);
    assert.match(summarizeEpisode({ life: { kind: 'delivery', with: '兰州拉面', detail: '牛肉面' } }), /外卖（兰州拉面）：牛肉面/);
    assert.match(summarizeEpisode({ channel: 'group', with: '项目组', lines: [{ who: '王姐', text: '方案再改一版' }], thread: { summary: '方案第三版' } }), /工作上，工作群里和项目组：方案第三版/);
    assert.equal(summarizeEpisode({ life: { kind: 'gift', with: '围巾', detail: '给她' } }), null);
    assert.equal(summarizeEpisode(null), null);
    const long = summarizeEpisode({ life: { kind: 'moment', detail: '很长'.repeat(80) } });
    assert.ok(long.length <= 90);
});

test('读回最近一天的生活：只读真跑过的，试跑和超过一天的不算', () => {
    const db = freshDb();
    const run = (hoursAgo, episode, shadow = false) => recordModelRun(db, {
        charId: CHAR, runtime: 'api', startedAt: new Date(AT.getTime() - hoursAgo * 3600_000).toISOString(),
        ok: true, outcome: 'noop', shadow, episode,
    });
    run(30, { life: { kind: 'chat', with: '太早的人', lines: [{ who: '太早的人', text: '嗨' }] } });
    run(5, { life: { kind: 'chat', with: '老周', lines: [{ who: '老周', text: '打球？' }] } });
    run(3, { life: { kind: 'chat', with: '试跑的人', lines: [{ who: '试跑的人', text: '嗨' }] } }, true);
    run(1, { life: { kind: 'xhs', detail: '刷到一只柯基' } });
    const log = recentLife(db, CHAR, AT);
    assert.equal(log.length, 2);
    assert.match(log[0].text, /老周/, '最早的在前');
    assert.match(log[1].text, /柯基/);
});

test('她那边的：只认裁过可见性还看得到标题的；账本只认近两天的支出', () => {
    const cues = herSideCues({
        temporalItems: [
            { kind: 'event', title: '组会', startAt: '2026-10-14T22:00:00.000Z', endAt: '2026-10-14T23:00:00.000Z' },
            { kind: 'event', title: '有安排', veiled: true, startAt: '2026-10-14T21:00:00.000Z' },
            { kind: 'event', title: '牙医', startAt: '2026-10-14T17:00:00.000Z', endAt: '2026-10-14T18:30:00.000Z' },
            { kind: 'event', title: '下周的事', startAt: '2026-10-20T17:00:00.000Z' },
        ],
        finance: { recent: [
            { type: 'transfer', merchant: '转给妈妈', amount: 100, currency: 'USD', date: '2026-10-14' },
            { type: 'expense', merchant: 'Trader Joe\'s', amount: 42.1, currency: 'USD', date: '2026-10-13' },
        ] },
        now: AT,
        userTimeZone: 'America/Chicago',
        userName: '阿萌',
    });
    assert.equal(cues.length, 3);
    assert.match(cues[0], /阿萌 17:00 有「组会」/);
    assert.match(cues[1], /刚结束「牙医」/);
    assert.match(cues[2], /Trader Joe's.*42\.1 USD/);
    assert.ok(!cues.some(cue => cue.includes('有安排')), '只给看「有安排」的说不出具体的事，不用');
});

test('开口缘由：权重合计 1；没内容的不参与；连发没回时不接话头', () => {
    const total = REACH_REASON_WEIGHTS.reduce((sum, [, w]) => sum + Math.round(w * 1000), 0);
    assert.equal(total, 1000);
    const pocket = [{ id: 'p1', text: '想跟你说个事', createdAt: AT.toISOString() }];
    const ownLife = [{ at: AT.toISOString(), text: '跟老周打了球' }];
    const herSide = ['阿萌 17:00 有「组会」'];

    assert.equal(pickReachReason({ pocket, ownLife, herSide, rng: () => 0 }).kind, 'pocket');
    assert.equal(pickReachReason({ pocket, ownLife, herSide, rng: () => 0.999 }).kind, 'thread');
    // 只有话头：永远接话头
    assert.equal(pickReachReason({ rng: () => 0.5 }).kind, 'thread');
    // 连发没回、什么都没有：说说自己此刻
    assert.equal(pickReachReason({ unanswered: 2, rng: () => 0.5 }).kind, 'own_day');
    // 连发没回时接话头被拿掉，落在剩下的里
    const kinds = new Set();
    for (let i = 0; i < 50; i += 1) kinds.add(pickReachReason({ pocket, ownLife, herSide, unanswered: 1, rng: () => i / 50 }).kind);
    assert.ok(!kinds.has('thread'));
    assert.ok(kinds.has('pocket') && kinds.has('own_life') && kinds.has('her_side'));
});

test('开口缘由写给模型的话：只说为什么想起，不出现「必须」', () => {
    const pocket = formatReachReason({ kind: 'pocket', item: { text: '楼下新开了家面馆', createdAt: AT.toISOString() } }, { formatGap: () => '3 小时前' });
    assert.match(pocket, /楼下新开了家面馆/);
    assert.match(pocket, /3 小时前想到的/);
    assert.match(formatReachReason({ kind: 'her_side', item: '阿萌刚结束「牙医」' }), /别像在查岗/);
    for (const kind of ['pocket', 'own_life', 'her_side', 'thread', 'own_day']) {
        const text = formatReachReason({ kind, item: kind === 'pocket' ? { text: 'x', createdAt: AT.toISOString() } : kind === 'own_life' ? { text: 'x' } : 'x' });
        assert.ok(text.startsWith('你想起 ta'));
        assert.ok(!text.includes('必须'));
    }
});

test('解析：生活和工作都留得住 tellLater；给阿萌的礼物不留', () => {
    const life = parseLife({ kind: 'chat', with: '老周', lines: [{ who: '老周', text: '打球？' }], tellLater: '  老周又约我打球了  ' });
    assert.equal(life.tellLater, '老周又约我打球了');
    const work = parseEpisode({ channel: 'dm', with: '王姐', lines: [{ who: '王姐', text: '改一版' }], tellLater: '王姐又让我改方案' });
    assert.equal(work.tellLater, '王姐又让我改方案');
    assert.equal(parseLife({ kind: 'moment', detail: '云', tellLater: '今天的云给你看', tellLaterFresh: 'today' }).tellLaterFresh, 'today');
    assert.ok(!('tellLaterFresh' in parseLife({ kind: 'moment', detail: '云', tellLater: '云', tellLaterFresh: 'forever' })), '不认识的档不收');
    const gift = parseLife({ kind: 'gift', via: 'net', with: '围巾', detail: '冬天了', tellLater: '给你买了围巾' });
    assert.ok(gift && !('tellLater' in gift));
    assert.ok(!('tellLater' in parseLife({ kind: 'moment', detail: '今天的云' })));
});

// ── 2026-10-19 返工：草稿箱里不挂过时的话和写给自己的备忘 ─────────────────

test('写给自己的备忘、跟别人说的话、用「她」称呼对方的自言自语都不收（全是实测原句）', () => {
    const notes = [
        '周二晚上要和昂哥喝酒，到时候得跟她说一声——别等我吃晚饭',
        '跟萌宝吐槽一下老徐的deadline压力，顺便说我这边都搞定了',
        '周二跟昂哥吐槽一下今天她问我爱不爱她的时候，差点把我这套说辞全推翻了。',
        '下周要和昂哥约了，又是一帮老友的局，得提醒丁沂萌别等我太晚。',
        '刷到一条说手好看的，我说我家的手最好看——她肯定会嘻嘻哈哈拿我开玩笑。',
        '跟萌宝说，老徐他们看我笑得贼开心，全猜出来我这会儿心情有多好。',
    ];
    for (const text of notes) assert.equal(isSelfNote(text, '丁沂萌'), true, text);
    const real = [
        '我那半个蛋就是被陈秘书那通电话煎糊的，你说巧不巧',
        '萌宝 我刚刷到一条甄嬛传的梗笑死了',
        '老徐这边推得挺紧的 不过逻辑跑通了 没什么问题',
        '昂哥下周二还要我陪喝酒，我得提醒他别太晚，老子还有人要陪。',
        'the data looks fine',
    ];
    for (const text of real) assert.equal(isSelfNote(text, '丁沂萌'), false, text);

    const db = freshDb();
    assert.equal(addPocketItem(db, { charId: CHAR, text: notes[0], now: AT, userName: '丁沂萌' }), null);
});

test('保质期：等会儿的事几小时就过去，今天的事放到今天结束，闲话两天；模型标长了按字面截短', () => {
    assert.equal(freshnessFromText('给你也点了杯冰的，等会儿开完会一起喝。'), 'soon');
    assert.equal(freshnessFromText('没什么特别的，就是这边贵宾厅冷得过头，点了点热汤待会儿喝'), 'soon');
    assert.equal(freshnessFromText('今晚牛排升级，回来有口福'), 'today');
    assert.equal(freshnessFromText('周鹏说上次把球抽到隔壁场是因为风大'), 'days');

    const db = freshDb();
    const soon = addPocketItem(db, { charId: CHAR, text: '点了热汤待会儿喝', freshness: 'days', now: AT, timeZone: 'America/Chicago' });
    assert.equal(Date.parse(soon.expiresAt) - AT.getTime(), POCKET_SOON_MS, '模型说能放两天，字面是「待会儿」，按短的');
    // 芝加哥 15:00 写的「今晚」：放到今天结束（9 小时）
    const today = addPocketItem(db, { charId: CHAR, text: '今晚想煮热红酒给你喝', freshness: 'today', now: AT, timeZone: 'America/Chicago' });
    assert.equal(Date.parse(today.expiresAt) - AT.getTime(), 9 * 3600_000);
    const days = addPocketItem(db, { charId: CHAR, text: '周鹏说室内球馆风大，笑死我了', freshness: 'days', now: AT });
    assert.equal(Date.parse(days.expiresAt) - AT.getTime(), POCKET_TTL_MS);
    // 四小时后：等会儿那句没了，另外两句还在
    assert.deepEqual(listUnsaid(db, CHAR, new Date(AT.getTime() + 4 * 3600_000)).map(i => i.text), ['今晚想煮热红酒给你喝', '周鹏说室内球馆风大，笑死我了']);
});

test('返工前存的旧行也按字面保质期筛：两天的期限还没到，但「待会儿喝」早过去了', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO pocket_items (id, char_id, text, kind, created_at, expires_at) VALUES ('old', ?, ?, 'share', ?, ?)`)
        .run(CHAR, '点了热汤待会儿喝', new Date(AT.getTime() - 5 * 3600_000).toISOString(), new Date(AT.getTime() + 40 * 3600_000).toISOString());
    assert.equal(listUnsaid(db, CHAR, AT).length, 0);
});

test('跟还没说的某句差不多的不再攒（「下周六 rank」攒了两遍）', () => {
    const db = freshDb();
    assert.ok(addPocketItem(db, { charId: CHAR, text: '跟周鹏约了下周六晚上打rank，手热着呢', freshness: 'days', now: AT }));
    assert.equal(addPocketItem(db, { charId: CHAR, text: '下周六又有rank局了，周鹏手热着呢', freshness: 'days', now: AT }), null);
    assert.ok(coverage('下周六又有rank局了，周鹏手热着呢', '跟周鹏约了下周六晚上打rank，手热着呢') >= 0.5);
});

test('聊天里已经说过了就划掉：只认攒下之后、TA 自己说的', () => {
    const db = freshDb();
    addPocketItem(db, { charId: CHAR, text: '我那半个蛋就是被陈秘书那通电话煎糊的', freshness: 'days', now: AT });
    addPocketItem(db, { charId: CHAR, text: '楼下新开了家面馆', freshness: 'days', now: AT });
    const later = new Date(AT.getTime() + 3600_000);
    const settled = settleSaidFromMessages(db, CHAR, [
        { role: 'user', at: later.toISOString(), text: '楼下新开了家面馆？' },
        { role: 'char', at: new Date(AT.getTime() - 60_000).toISOString(), text: '楼下新开了家面馆' },
        { role: 'char', at: later.toISOString(), text: '早上那半个蛋被陈秘书一通电话煎糊了，气死' },
    ], later);
    assert.equal(settled, 1);
    assert.deepEqual(listUnsaid(db, CHAR, later).map(i => i.text), ['楼下新开了家面馆']);
});

test('草稿箱接口：先拿快照把说过的划掉，再筛掉备忘；带上过期时刻', () => {
    const db = freshDb();
    addPocketItem(db, { charId: CHAR, text: '同事养了只柯基，下次带你去看', freshness: 'days', now: AT });
    addPocketItem(db, { charId: CHAR, text: '模拟器里练侧风降落差点冲出跑道', freshness: 'days', now: AT });
    const later = new Date(AT.getTime() + 3600_000);
    const snapshot = { payload: { user: { name: '丁沂萌' }, recentMessages: [{ role: 'char', at: later.toISOString(), text: '今天模拟器练侧风降落，差点冲出跑道' }] } };
    const items = listPocketForPhone(db, { charId: CHAR, now: later, snapshotsFor: () => snapshot });
    assert.deepEqual(items.map(i => i.text), ['同事养了只柯基，下次带你去看']);
    assert.ok(items[0].expiresAt);
});
