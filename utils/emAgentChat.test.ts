// [EM-START: agent-instant-chat]
import { beforeEach, describe, expect, it, vi } from 'vitest';

const health = vi.fn();
const submitChatTurn = vi.fn();
const chatTurnStatus = vi.fn();
const registerPush = vi.fn();
let paired = true;

vi.mock('./emAgentBackend', () => ({
    isAgentPaired: () => paired,
    AgentBackend: {
        health: (...args: unknown[]) => health(...args),
        submitChatTurn: (...args: unknown[]) => submitChatTurn(...args),
        chatTurnStatus: (...args: unknown[]) => chatTurnStatus(...args),
        registerPush: (...args: unknown[]) => registerPush(...args),
    },
}));
vi.mock('./activeMsgClient', () => ({
    resolveChatMessagesForUpload: async (messages: unknown[]) => messages.map(m => ({ ...(m as object), resolved: true })),
}));

import {
    AGENT_CHAT_MAX_STATUS_FAILURES, chatReplyToInbox, checkAgentChatPending, isAgentChatReady, resetAgentChatProbeForTest,
    sendAgentChatTurn, setAgentChatEnabled, tokenUsageFromCloudMetadata, notePollRescue, pushStaleNoticeText, resetPushStaleForTest, PUSH_STALE_EVENT,
} from './emAgentChat';
import { clearInstantChatPending, getInstantChatPending, setInstantChatPending } from './amsgInstantChat';

const char = { id: 'lumi', name: '陈照' };

beforeEach(() => {
    localStorage.clear();
    health.mockReset(); submitChatTurn.mockReset(); chatTurnStatus.mockReset();
    paired = true;
    resetAgentChatProbeForTest();
});

describe('这一轮交不交给 mini', () => {
    it('开关没开、没配对：不走 mini，也不去探', async () => {
        expect(await isAgentChatReady()).toBe(false);
        setAgentChatEnabled(true);
        paired = false;
        expect(await isAgentChatReady()).toBe(false);
        expect(health).not.toHaveBeenCalled();
    });

    it('mini 在就走；连不上就回落本地；30 秒内复用结论', async () => {
        setAgentChatEnabled(true);
        health.mockRejectedValueOnce(new Error('连不上'));
        expect(await isAgentChatReady(1_000)).toBe(false);
        expect(await isAgentChatReady(5_000)).toBe(false);
        expect(health).toHaveBeenCalledTimes(1);
        health.mockResolvedValueOnce({ ok: true });
        expect(await isAgentChatReady(40_000)).toBe(true);
    });
});

describe('交上去', () => {
    it('图片令牌先还原；成功后点亮「正在输入」并标明是 mini', async () => {
        submitChatTurn.mockResolvedValueOnce({ turnId: 'x', status: 'accepted' });
        const result = await sendAgentChatTurn({
            char, messages: [{ role: 'user', content: '在吗' }],
            api: { baseUrl: 'https://relay/v1', apiKey: 'k', model: 'm' }, temperature: 0.8, maxTokens: 8000,
        });
        expect(result.ok).toBe(true);
        const body = submitChatTurn.mock.calls[0][0];
        expect(body.messages[0].resolved).toBe(true);
        expect(body.charName).toBe('陈照');
        expect(body.supersedes).toBeUndefined();
        const pending = getInstantChatPending('lumi');
        expect(pending?.via).toBe('mini');
        expect(pending?.uuid).toBe(body.turnId);
    });

    it('连发：顶掉上一轮 mini 的，不碰 amsg 的', async () => {
        setInstantChatPending('lumi', 'amsg-uuid', 1, '陈照');
        submitChatTurn.mockResolvedValue({});
        await sendAgentChatTurn({ char, messages: [], api: { baseUrl: 'b', apiKey: '', model: 'm' } });
        expect(submitChatTurn.mock.calls[0][0].supersedes).toBeUndefined();
        const first = getInstantChatPending('lumi')!.uuid;
        await sendAgentChatTurn({ char, messages: [], api: { baseUrl: 'b', apiKey: '', model: 'm' } });
        expect(submitChatTurn.mock.calls[1][0].supersedes).toBe(first);
    });

    it('交不上去：不点灯，把原因交回去', async () => {
        submitChatTurn.mockRejectedValueOnce(new Error('请求体过大'));
        const result = await sendAgentChatTurn({ char, messages: [], api: { baseUrl: 'b', apiKey: '', model: 'm' } });
        expect(result).toEqual({ ok: false, error: '请求体过大' });
        expect(getInstantChatPending('lumi')).toBeNull();
    });
});

describe('60 秒点名', () => {
    const pending = { charId: 'lumi', uuid: 'turn-1' };
    beforeEach(() => setInstantChatPending('lumi', 'turn-1', 1, '陈照', 'mini'));

    it('还在跑：什么都不做', async () => {
        chatTurnStatus.mockResolvedValueOnce({ state: 'running' });
        const pull = vi.fn(async () => {});
        await checkAgentChatPending(pending, pull);
        expect(pull).not.toHaveBeenCalled();
        expect(getInstantChatPending('lumi')).not.toBeNull();
    });

    it('跑完了没收到：去信箱取，取到就不再管', async () => {
        chatTurnStatus.mockResolvedValueOnce({ state: 'done' });
        const pull = vi.fn(async () => { clearInstantChatPending('lumi'); });
        await checkAgentChatPending(pending, pull);
        expect(pull).toHaveBeenCalled();
    });

    it('mini 说失败了：取一次还没有就收场', async () => {
        chatTurnStatus.mockResolvedValueOnce({ state: 'failed', error: '模型返回 400' });
        await checkAgentChatPending(pending, async () => {});
        expect(getInstantChatPending('lumi')).toBeNull();
    });

    it('一直联系不上：连续几次后才收场', async () => {
        chatTurnStatus.mockRejectedValue(new Error('连不上'));
        for (let i = 1; i < AGENT_CHAT_MAX_STATUS_FAILURES; i += 1) {
            await checkAgentChatPending(pending, async () => {});
            expect(getInstantChatPending('lumi')).not.toBeNull();
        }
        await checkAgentChatPending(pending, async () => {});
        expect(getInstantChatPending('lumi')).toBeNull();
    });
});

describe('[EM: agent-push-stale-notice] 推送没送到时要让阿萌知道', () => {
    const heard: Array<{ fixed?: boolean; reason?: string }> = [];
    const listen = (event: Event) => { heard.push((event as CustomEvent).detail); };
    beforeEach(() => {
        heard.length = 0; registerPush.mockReset(); resetPushStaleForTest();
        vi.stubGlobal('window', new EventTarget());
        window.addEventListener(PUSH_STALE_EVENT, listen);
        submitChatTurn.mockResolvedValue({});
    });
    const send = () => sendAgentChatTurn({ char, messages: [], api: { baseUrl: 'b', apiKey: '', model: 'm' } });

    it('一轮靠点名取到不算；连着两轮才提示，并先自己重新登记一次', async () => {
        registerPush.mockResolvedValue({ ok: true });
        await send(); await notePollRescue(1_000);
        expect(heard).toHaveLength(0);
        await send(); await notePollRescue(2_000);
        expect(registerPush).toHaveBeenCalledTimes(1);
        expect(heard).toEqual([{ fixed: true, reason: '' }]);
        expect(pushStaleNoticeText(heard[0])).toContain('已经自动重新登记推送');
        // 半小时内不重复提示
        await send(); await notePollRescue(3_000);
        expect(heard).toHaveLength(1);
        vi.unstubAllGlobals();
    });

    it('中间有一轮是推送送到的：连续计数清零', async () => {
        registerPush.mockResolvedValue({ ok: true });
        await send(); await notePollRescue(1_000);
        await send(); // 这一轮推送送到了，没走点名
        await send(); await notePollRescue(2_000);
        expect(heard).toHaveLength(0);
        vi.unstubAllGlobals();
    });

    it('自动登记没成功：提示里说清原因，让她去点「登记推送」', async () => {
        registerPush.mockResolvedValue({ ok: false, reason: '浏览器没有给出推送订阅' });
        await send(); await notePollRescue(1_000);
        await send(); await notePollRescue(2_000);
        expect(pushStaleNoticeText(heard[0])).toContain('自动重新登记没成功（浏览器没有给出推送订阅）');
        expect(pushStaleNoticeText(heard[0])).toContain('点一次「登记推送」');
        vi.unstubAllGlobals();
    });
});

describe('信箱里的回复塞回收件箱', () => {
    it('形状跟 SW 收到推送时写的一样，taskUuid 认得出是哪一轮', () => {
        const entry = chatReplyToInbox({
            id: 1, messageId: 'mini:t1', charId: 'lumi', jobUuid: 'chat:t1', kind: 'chat_reply', createdAt: '2026-09-29T20:00:00.000Z',
            payload: {
                messageId: 'mini:t1', taskUuid: 't1', contactName: '陈照', message: '在的\n刚开完会', messageType: 'instant',
                timestamp: '2026-09-29T20:00:00.000Z', metadata: { charId: 'lumi', charName: '陈照' }, notification: { body: '在的' },
            },
        }, 123);
        expect(entry).toMatchObject({
            messageId: 'mini:t1', charId: 'lumi', charName: '陈照', body: '在的\n刚开完会', taskUuid: 't1', messageType: 'instant',
            sentAt: Date.parse('2026-09-29T20:00:00.000Z'), receivedAt: 123,
        });
        expect(entry?.metadata?.amsgOutboxBackfill).toBeUndefined();
    });
});

describe('[EM: token-panel-cloud] 云端回复的用量给 ⚡ 面板', () => {
    it('mini 原样的 usage、amsg 的两个数都认；没有数就不更新', () => {
        expect(tokenUsageFromCloudMetadata({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 80 }))
            .toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 80 });
        expect(tokenUsageFromCloudMetadata({ promptTokens: 10, completionTokens: 5 }))
            .toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
        expect(tokenUsageFromCloudMetadata({})).toBeNull();
        expect(tokenUsageFromCloudMetadata(undefined)).toBeNull();
    });
});
// [EM-END: agent-instant-chat]
