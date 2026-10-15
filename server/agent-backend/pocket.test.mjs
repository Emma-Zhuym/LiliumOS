/**
 * 话兜 + 开口缘由（docs/spec-character-drives.md 4.2–4.4）。内存库、钉死的 rng，不碰真模型。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from './db.mjs';
import { upsertCharacter } from './characters.mjs';
import { recordModelRun } from './heartbeat.mjs';
import { MAX_UNSAID, POCKET_TTL_MS, addPocketItem, listPocketForPhone, listUnsaid, markSaid } from './pocket.mjs';
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
    for (let i = 0; i < MAX_UNSAID + 2; i += 1) {
        addPocketItem(db, { charId: CHAR, text: `第 ${i} 句`, now: new Date(AT.getTime() + i * 60_000) });
    }
    const later = new Date(AT.getTime() + 10 * 60_000);
    const unsaid = listUnsaid(db, CHAR, later, { limit: 50 });
    assert.equal(unsaid.length, MAX_UNSAID);
    assert.equal(unsaid[0].text, '第 2 句');
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
    const gift = parseLife({ kind: 'gift', via: 'net', with: '围巾', detail: '冬天了', tellLater: '给你买了围巾' });
    assert.ok(gift && !('tellLater' in gift));
    assert.ok(!('tellLater' in parseLife({ kind: 'moment', detail: '今天的云' })));
});
