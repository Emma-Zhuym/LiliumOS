/**
 * 烛下约好的时间到了，TA 来找她（docs/spec-deep-talk.md「阶段二：约好的时间到了」）。
 *
 * 阿萌 2026-10-22：想起来「晚上八点找他聊」，点蜡烛时就能约个时间；TA 答应了，到点 mini 推一条
 * 「{角色}来了，蜡烛点上了」，她点开就进纸面。TA 自己回「晚点，23:00」也走同一条路。
 *
 * 不走心跳：心跳大约一小时醒一次，等不到准点。这里每一夜排一条准点任务，到点只送一条带标记的消息，
 * 不调模型——TA 已经答应过了，这一刻要的是准时，不是再写一段话。
 * 她早一点自己点上、拒了、或者改了时间，手机就把这条任务撤掉或换掉。
 */

import { cancelJob, createJob } from './jobs.mjs';

export const DEEP_TALK_DUE_KIND = 'deep_talk.due';
/** 送到手机那条消息的 payload.type（手机信箱据此分流）。 */
export const DEEP_TALK_DUE_TYPE = 'deep_talk_due';
/** 到点后这么久还没送出去（mini 睡着了）就不送了：过了好几个小时再来叫，人早就不在了。 */
const DUE_GRACE_MS = 3 * 60 * 60 * 1000;
/** 太远的不收：约的是今天晚些、最多明天。 */
const MAX_AHEAD_MS = 48 * 60 * 60 * 1000;

const uuidPrefix = nightId => `deeptalk:${nightId}:`;

/** 撤掉这一夜所有还没跑的提醒。返回撤了几条。 */
export const cancelDeepTalkDue = (db, nightId, now = new Date()) => {
    const rows = db.prepare(
        `SELECT uuid FROM jobs WHERE kind = ? AND uuid LIKE ? AND status IN ('pending','running')`,
    ).all(DEEP_TALK_DUE_KIND, `${uuidPrefix(nightId)}%`);
    return rows.filter(row => cancelJob(db, row.uuid, now)).length;
};

/**
 * 排（或改）这一夜的提醒。同一夜只留一条：先撤旧的再排新的。
 * dueAt 必须在将来、48 小时以内；角色得已经在后端登记过。
 */
export const scheduleDeepTalkDue = (db, { charId, nightId, dueAt, charName = '' }, now = new Date()) => {
    const due = Date.parse(dueAt ?? '');
    if (!nightId || typeof nightId !== 'string' || nightId.length > 100) {
        throw Object.assign(new Error('缺少这一夜的 id'), { code: 'BAD_NIGHT', status: 400 });
    }
    if (!Number.isFinite(due) || due <= now.getTime() || due - now.getTime() > MAX_AHEAD_MS) {
        throw Object.assign(new Error('约的时间要在将来、两天以内'), { code: 'BAD_DUE', status: 400 });
    }
    cancelDeepTalkDue(db, nightId, now);
    const runAt = new Date(due).toISOString();
    const { job } = createJob(db, {
        uuid: `${uuidPrefix(nightId)}${runAt}`,
        kind: DEEP_TALK_DUE_KIND,
        charId,
        runAt,
        expiresAt: new Date(due + DUE_GRACE_MS).toISOString(),
        missedPolicy: 'drop',
        maxAttempts: 2,
        input: { nightId, charName: String(charName || '').slice(0, 40) },
        createdBy: 'phone',
    }, now);
    return { nightId, dueAt: runAt, jobUuid: job.uuid };
};

/** 到点：送一条「TA 来了」。不调模型，消息 id 跟这一夜绑定，重跑也只有一条。 */
export const createDeepTalkDueHandler = ({ deliver, now = () => new Date() }) => async job => {
    const { nightId, charName } = job.input ?? {};
    const name = charName || 'TA';
    await deliver({
        messageId: `deeptalk-due:${nightId}`,
        charId: job.charId,
        jobUuid: job.uuid,
        kind: 'job_result',
        title: name,
        body: `${name}来了，蜡烛点上了`,
        payload: { type: DEEP_TALK_DUE_TYPE, nightId, createdAt: now().toISOString() },
    });
    return { delivered: true };
};
