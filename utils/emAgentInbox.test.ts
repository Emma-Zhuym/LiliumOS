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
        // 通知要用：角色 + 正文，不是只有 id
        expect(result.lines).toEqual([{ charId: 'lumi', text: '在干嘛' }]);
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
        await expect(syncAgentMessagesIntoChat(NOW)).resolves.toEqual({ delivered: 0, stale: 0, work: 0, life: 0, charIds: [], lines: [] });
    });
});

describe('工作往来', () => {
    beforeEach(() => {
        localStorage.clear();
        saveMessage.mockClear();
        ackInbox.mockClear();
    });

    const work = (id: string, overrides: Record<string, unknown> = {}) => ({
        id: 2,
        messageId: id,
        charId: 'lumi',
        jobUuid: 'hb:1',
        kind: 'job_result' as const,
        payload: {
            type: 'work_episode',
            createdAt: '2026-09-23T11:00:00.000Z',
            episode: { channel: 'group', with: '美术组', lines: [{ who: '小林', text: '稿子好了' }] },
            thread: { id: 't1', title: '角色设计', summary: '配色通过', status: 'open' },
            ...(overrides.payload as object ?? {}),
        },
        createdAt: '2026-09-23T11:00:00.000Z',
    });

    it('交给调用方落地，落成功才 ack；不进聊天', async () => {
        inbox.mockResolvedValueOnce([work('hb:1:work')]);
        const onWorkEvent = vi.fn();
        const result = await syncAgentMessagesIntoChat(NOW, { onWorkEvent });
        expect(result.work).toBe(1);
        expect(result.delivered).toBe(0);
        expect(saveMessage).not.toHaveBeenCalled();
        expect(onWorkEvent).toHaveBeenCalledWith(expect.objectContaining({
            charId: 'lumi', messageId: 'hb:1:work', episode: expect.objectContaining({ with: '美术组' }),
            thread: expect.objectContaining({ id: 't1' }),
        }));
        expect(ackInbox).toHaveBeenCalledWith(['hb:1:work']);
    });

    it('落地失败就不 ack，下次还能取回来', async () => {
        inbox.mockResolvedValueOnce([work('hb:2:work')]);
        const result = await syncAgentMessagesIntoChat(NOW, { onWorkEvent: () => { throw new Error('写不进去'); } });
        expect(result.work).toBe(0);
        expect(ackInbox).not.toHaveBeenCalled();
    });

    it('没有人接手时原样留在信箱里，不被悄悄 ack 掉', async () => {
        inbox.mockResolvedValueOnce([work('hb:3:work')]);
        await syncAgentMessagesIntoChat(NOW);
        expect(ackInbox).not.toHaveBeenCalled();
    });

    it('聊天消息和工作往来同一次取回，各走各的', async () => {
        inbox.mockResolvedValueOnce([msg('hb:4'), work('hb:5:work')]);
        const result = await syncAgentMessagesIntoChat(NOW, { onWorkEvent: vi.fn() });
        expect(result.delivered).toBe(1);
        expect(result.work).toBe(1);
        expect(ackInbox).toHaveBeenCalledWith(expect.arrayContaining(['hb:4', 'hb:5:work']));
    });
});

describe('生活小事', () => {
    beforeEach(() => {
        localStorage.clear();
        saveMessage.mockClear();
        ackInbox.mockClear();
    });

    const life = (id: string) => ({
        id: 3, messageId: id, charId: 'lumi', jobUuid: 'hb:1', kind: 'job_result' as const,
        payload: { type: 'life_episode', createdAt: '2026-09-23T11:00:00.000Z', life: { kind: 'delivery', with: '麻辣烫' } },
        createdAt: '2026-09-23T11:00:00.000Z',
    });

    it('交给调用方落地，落成功才 ack，之后同一条只补 ack 不再落', async () => {
        inbox.mockResolvedValueOnce([life('hb:9:life')]);
        const onLifeEvent = vi.fn();
        const result = await syncAgentMessagesIntoChat(NOW, { onLifeEvent });
        expect(result.life).toBe(1);
        expect(onLifeEvent).toHaveBeenCalledWith(expect.objectContaining({ charId: 'lumi', messageId: 'hb:9:life', life: expect.objectContaining({ kind: 'delivery' }) }));
        expect(ackInbox).toHaveBeenCalledWith(['hb:9:life']);

        inbox.mockResolvedValueOnce([life('hb:9:life')]);
        await syncAgentMessagesIntoChat(NOW, { onLifeEvent });
        expect(onLifeEvent).toHaveBeenCalledTimes(1);
    });

    it('没有人接手时留在信箱里', async () => {
        inbox.mockResolvedValueOnce([life('hb:10:life')]);
        await syncAgentMessagesIntoChat(NOW, { onWorkEvent: vi.fn() });
        expect(ackInbox).not.toHaveBeenCalled();
    });
});
// [EM-END: agent-backend-inbox]
