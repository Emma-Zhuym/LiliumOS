/**
 * 烛下约好的时间到了，TA 来找她（deepTalk.mjs）。内存库，跟真库隔离。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from './db.mjs';
import { upsertCharacter } from './characters.mjs';
import { runTick } from './jobs.mjs';
import { createRouter } from './server.mjs';
import {
    DEEP_TALK_DUE_KIND, DEEP_TALK_DUE_TYPE, cancelDeepTalkDue, createDeepTalkDueHandler, scheduleDeepTalkDue,
} from './deepTalk.mjs';

const NOW = new Date('2026-10-22T22:00:00.000Z'); // 芝加哥 17:00
const at = minutes => new Date(NOW.getTime() + minutes * 60_000);
const freshDb = () => {
    const db = openDb(':memory:');
    upsertCharacter(db, { charId: 'jibai', displayName: '既白', runtime: 'api', credRef: 'jibai' });
    return db;
};
const pending = db => db.prepare(`SELECT uuid, run_at FROM jobs WHERE kind = ? AND status = 'pending'`).all(DEEP_TALK_DUE_KIND);

test('排提醒：同一夜只留一条，改时间就换掉旧的；撤掉就没了', () => {
    const db = freshDb();
    scheduleDeepTalkDue(db, { charId: 'jibai', nightId: 'n1', dueAt: at(180).toISOString(), charName: '既白' }, NOW);
    scheduleDeepTalkDue(db, { charId: 'jibai', nightId: 'n1', dueAt: at(240).toISOString(), charName: '既白' }, NOW);
    const rows = pending(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].run_at, at(240).toISOString());
    assert.equal(cancelDeepTalkDue(db, 'n1', NOW), 1);
    assert.equal(pending(db).length, 0);
});

test('排提醒：过去的、两天以后的、没有夜 id 的都不收', () => {
    const db = freshDb();
    assert.throws(() => scheduleDeepTalkDue(db, { charId: 'jibai', nightId: 'n1', dueAt: at(-5).toISOString() }, NOW), /将来/);
    assert.throws(() => scheduleDeepTalkDue(db, { charId: 'jibai', nightId: 'n1', dueAt: at(60 * 49).toISOString() }, NOW), /两天/);
    assert.throws(() => scheduleDeepTalkDue(db, { charId: 'jibai', nightId: '', dueAt: at(60).toISOString() }, NOW), /id/);
});

test('到点：送一条带这一夜 id 的「TA 来了」，推送标题是名字；安静时段里也照约定来', async () => {
    const db = freshDb();
    scheduleDeepTalkDue(db, { charId: 'jibai', nightId: 'n2', dueAt: at(60).toISOString(), charName: '既白' }, NOW);
    const sent = [];
    const handlers = { [DEEP_TALK_DUE_KIND]: createDeepTalkDueHandler({ deliver: async entry => sent.push(entry), now: () => at(60) }) };
    await runTick(db, { handlers, quiet: { active: true }, now: at(30), logger: { warn() {}, error() {}, log() {} } });
    assert.equal(sent.length, 0, '没到点不送');
    await runTick(db, { handlers, quiet: { active: true }, now: at(61), logger: { warn() {}, error() {}, log() {} } });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].messageId, 'deeptalk-due:n2');
    assert.equal(sent[0].charId, 'jibai');
    assert.equal(sent[0].body, '既白来了，蜡烛点上了');
    assert.deepEqual({ type: sent[0].payload.type, nightId: sent[0].payload.nightId }, { type: DEEP_TALK_DUE_TYPE, nightId: 'n2' });
});

test('mini 睡过头：过了三小时就不送了', async () => {
    const db = freshDb();
    scheduleDeepTalkDue(db, { charId: 'jibai', nightId: 'n3', dueAt: at(60).toISOString(), charName: '既白' }, NOW);
    const sent = [];
    const handlers = { [DEEP_TALK_DUE_KIND]: createDeepTalkDueHandler({ deliver: async entry => sent.push(entry) }) };
    await runTick(db, { handlers, quiet: { active: false }, now: at(60 + 181), logger: { warn() {}, error() {}, log() {} } });
    assert.equal(sent.length, 0);
});

test('接口：排、撤；没登记的角色不收', () => {
    const db = freshDb();
    const routes = createRouter({ db, config: {} });
    const dueAt = new Date(Date.now() + 2 * 3600_000).toISOString();
    const { plan } = routes['POST /deep-talk/plans'].handle({ body: { charId: 'jibai', nightId: 'n4', dueAt, charName: '既白' } });
    assert.equal(plan.nightId, 'n4');
    assert.equal(routes['POST /deep-talk/plans/cancel'].handle({ body: { nightId: 'n4' } }).cancelled, 1);
    assert.throws(() => routes['POST /deep-talk/plans'].handle({ body: { charId: 'nobody', nightId: 'n5', dueAt } }), /登记/);
});
