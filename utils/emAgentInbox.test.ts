// [EM-START: agent-backend-inbox]
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveMessage = vi.fn(async () => 1);
const inbox = vi.fn();
const ackInbox = vi.fn(async (_ids?: string[]) => ({ acked: 0 }));

vi.mock('./db', () => ({ DB: { saveMessage: (...args: unknown[]) => saveMessage(...args as []) } }));
vi.mock('./emAgentBackend', async () => {
    const actual = await vi.importActual<typeof import('./emAgentBackend')>('./emAgentBackend');
    return {
        ...actual,
        isAgentPaired: () => true,
        AgentBackend: { inbox: () => inbox(), ackInbox: (ids: string[]) => ackInbox(ids as never) },
    };
});

import { syncAgentMessagesIntoChat } from './emAgentInbox';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');

const msg = (id: string, overrides: Record<string, unknown> = {}) => ({
    id: 1,
    messageId: id,
    charId: 'lumi',
    jobUuid: null,
    kind: 'chat_message' as const,
    payload: {
        text: '在干嘛',
        source: 'heartbeat',
        createdAt: '2026-09-23T11:00:00.000Z',
        staleAfter: '2026-09-23T17:00:00.000Z',
        ...(overrides.payload as object ?? {}),
    },
    createdAt: '2026-09-23T11:00:00.000Z',
    ...overrides,
});

describe('后端信箱落地到聊天', () => {
    beforeEach(() => {
        localStorage.clear();
        saveMessage.mockClear();
        ackInbox.mockClear();
    });

    it('新鲜的消息写进聊天，用后端记下的时刻而不是取回来的这一刻', async () => {
        inbox.mockResolvedValueOnce([msg('hb:1')]);
        const result = await syncAgentMessagesIntoChat(NOW);
        expect(result.delivered).toBe(1);
        expect(result.charIds).toEqual(['lumi']);
        expect(saveMessage).toHaveBeenCalledWith(expect.objectContaining({
            charId: 'lumi',
            role: 'assistant',
            content: '在干嘛',
            timestamp: Date.parse('2026-09-23T11:00:00.000Z'),
        }));
    });

    it('过了保质期的不进聊天——那会儿的话不该假装是刚说的', async () => {
        inbox.mockResolvedValueOnce([msg('hb:2', { payload: { staleAfter: '2026-09-23T06:00:00.000Z' } })]);
        const result = await syncAgentMessagesIntoChat(NOW);
        expect(result.delivered).toBe(0);
        expect(result.stale).toBe(1);
        expect(saveMessage).not.toHaveBeenCalled();
        // 仍然要 ack，否则它会一直赖在信箱里。
        expect(ackInbox).toHaveBeenCalledWith(['hb:2']);
    });

    it('ack 失败后重来一次，不会写成两条', async () => {
        inbox.mockResolvedValueOnce([msg('hb:3')]);
        ackInbox.mockRejectedValueOnce(new Error('网断了'));
        await syncAgentMessagesIntoChat(NOW);
        expect(saveMessage).toHaveBeenCalledTimes(1);

        inbox.mockResolvedValueOnce([msg('hb:3')]);
        const again = await syncAgentMessagesIntoChat(NOW);
        expect(saveMessage).toHaveBeenCalledTimes(1);
        expect(again.delivered).toBe(0);
        expect(ackInbox).toHaveBeenLastCalledWith(['hb:3']);
    });

    it('系统通知之类不进聊天', async () => {
        inbox.mockResolvedValueOnce([msg('n:1', { kind: 'system_notice' })]);
        const result = await syncAgentMessagesIntoChat(NOW);
        expect(result.delivered).toBe(0);
        expect(saveMessage).not.toHaveBeenCalled();
    });

    it('后端连不上就当没有，不抛错', async () => {
        inbox.mockRejectedValueOnce(new Error('连不上'));
        await expect(syncAgentMessagesIntoChat(NOW)).resolves.toEqual({ delivered: 0, stale: 0, charIds: [] });
    });
});
// [EM-END: agent-backend-inbox]
