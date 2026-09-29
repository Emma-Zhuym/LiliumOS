/**
 * 即时回复的单测：受理 → 立刻跑 → 按 amsg 推送形状推回；失败、顶替、重启丢凭据、4KB 退路。
 * 内存库 + 假 fetch，不调真模型、不发真推送。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from './db.mjs';
import { upsertCharacter } from './characters.mjs';
import { runJobNow } from './jobs.mjs';
import {
    CHAT_TURN_KIND, PUSH_PAYLOAD_LIMIT_BYTES, buildReplyPush, createChatTurnService, jobUuidFor, previewText, validateTurn,
} from './chatTurns.mjs';

const TURN = '11111111-2222-4333-8444-555555555555';
const NEXT = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const turn = (overrides = {}) => ({
    turnId: TURN,
    charId: 'lumi',
    charName: '陈照',
    messages: [{ role: 'system', content: '你是陈照' }, { role: 'user', content: '在吗' }],
    api: { baseUrl: 'https://relay.example/v1', model: 'claude-x', apiKey: 'sk-secret' },
    temperature: 0.85,
    maxTokens: 8000,
    ...overrides,
});

const setup = ({ reply = '在的\n刚开完会', status = 200, fetchImpl = null } = {}) => {
    const db = openDb(':memory:');
    upsertCharacter(db, { charId: 'lumi', displayName: '陈照', runtime: 'api', credRef: 'lumi' });
    const delivered = [];
    const calls = [];
    const fakeFetch = fetchImpl ?? (async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
        return {
            ok: status < 400,
            status,
            text: async () => 'upstream said no',
            json: async () => ({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
        };
    });
    const service = createChatTurnService({ db, deliver: async item => { delivered.push(item); return item; }, fetchImpl: fakeFetch, logger: { warn() {} } });
    const handlers = { [CHAT_TURN_KIND]: service.handler };
    return { db, service, handlers, delivered, calls };
};

test('即时回复：请求体一字不改转给模型，回复按 amsg 推送形状推回', async () => {
    const { db, service, handlers, delivered, calls } = setup();
    const accepted = service.submit(turn({ extraBody: { reasoning_effort: 'high' } }));
    assert.equal(accepted.ok, true);
    assert.equal(await runJobNow(db, jobUuidFor(TURN), { handlers, logger: { warn() {} } }), 'done');

    assert.equal(calls[0].url, 'https://relay.example/v1/chat/completions');
    assert.equal(calls[0].headers.Authorization, 'Bearer sk-secret');
    assert.deepEqual(calls[0].body.messages, turn().messages);
    assert.equal(calls[0].body.temperature, 0.85);
    assert.equal(calls[0].body.max_tokens, 8000);
    assert.equal(calls[0].body.reasoning_effort, 'high');
    assert.equal(calls[0].body.stream, false);

    const reply = delivered.find(d => d.kind === 'chat_reply');
    assert.equal(reply.pushPayload.messageKind, 'content');
    assert.equal(reply.pushPayload.taskUuid, TURN);
    assert.equal(reply.pushPayload.message, '在的\n刚开完会');
    assert.equal(reply.pushPayload.metadata.charId, 'lumi');
    assert.equal(reply.pushPayload.notification.silent, 'when-visible');
    assert.deepEqual(reply.payload, reply.pushPayload, '信箱存整份，推送丢了按原样补');
    assert.equal(service.status(TURN).state, 'done');
    assert.doesNotMatch(JSON.stringify(delivered), /sk-secret/, 'Key 不许进信箱');
});

test('即时回复：模型报错就推一条 error，状态是 failed，不重试', async () => {
    const { db, service, handlers, delivered } = setup({ status: 400 });
    service.submit(turn());
    assert.equal(await runJobNow(db, jobUuidFor(TURN), { handlers, logger: { warn() {} } }), 'failed');
    const error = delivered.find(d => d.kind === 'chat_error');
    assert.equal(error.pushPayload.messageKind, 'error');
    assert.equal(error.pushPayload.metadata.taskUuid, TURN);
    assert.match(error.pushPayload.metadata.reason, /模型返回 400/);
    assert.equal(service.status(TURN).state, 'failed');
});

test('即时回复：进程重启丢了凭据，这一轮判失败让手机重发（不去猜 Key）', async () => {
    const { db, service, handlers, delivered } = setup();
    service.submit(turn());
    const restarted = createChatTurnService({ db, deliver: async item => { delivered.push(item); }, logger: { warn() {} } });
    await runJobNow(db, jobUuidFor(TURN), { handlers: { [CHAT_TURN_KIND]: restarted.handler }, logger: { warn() {} } });
    assert.match(delivered.find(d => d.kind === 'chat_error').pushPayload.metadata.reason, /重启/);
});

test('即时回复：连发时顶掉还没开跑的上一轮', () => {
    const { service } = setup();
    service.submit(turn());
    service.submit(turn({ turnId: NEXT, supersedes: TURN }));
    assert.equal(service.status(TURN).state, 'cancelled');
    assert.equal(service.status(NEXT).state, 'pending');
    assert.equal(service.busy('lumi'), true);
});

test('即时回复：没在后端登记过的角色也能交（只有开了心跳的才登记）', async () => {
    const { db, service, handlers, delivered } = setup();
    service.submit(turn({ charId: 'sully', charName: 'Sully' }));
    assert.equal(await runJobNow(db, jobUuidFor(TURN), { handlers, logger: { warn() {} } }), 'done');
    assert.equal(delivered.find(d => d.kind === 'chat_reply').pushPayload.metadata.charId, 'sully');
    assert.equal(service.busy('sully'), false);
});

test('即时回复：同一个 turnId 重复提交只算一次', () => {
    const { service } = setup();
    service.submit(turn());
    assert.equal(service.submit(turn()).duplicated, true);
});

test('即时回复：太长推不动就只推「去取」的信号，信箱里是全文', async () => {
    const long = '很长的一段话'.repeat(400);
    const { db, service, handlers, delivered } = setup({ reply: long });
    service.submit(turn());
    await runJobNow(db, jobUuidFor(TURN), { handlers, logger: { warn() {} } });
    const reply = delivered.find(d => d.kind === 'chat_reply');
    assert.ok(Buffer.byteLength(JSON.stringify(buildReplyPush({ turnId: TURN, charId: 'lumi', charName: '陈照', text: long, at: '' }))) > PUSH_PAYLOAD_LIMIT_BYTES);
    assert.equal(reply.pushPayload.messageKind, 'result');
    assert.equal(reply.pushPayload.resultKind, 'agent-pull');
    assert.equal(reply.payload.message, long);
});

test('即时回复：请求校验', () => {
    assert.match(validateTurn({}), /turnId/);
    assert.match(validateTurn(turn({ messages: [] })), /messages/);
    assert.match(validateTurn(turn({ api: { baseUrl: '', model: 'x' } })), /api/);
    assert.equal(validateTurn(turn()), null);
});

test('通知预览去掉指令和标签', () => {
    assert.equal(previewText('[[SEND_EMOJI: 开心]]<语音>好呀</语音> 走吧'), '好呀 走吧');
});
