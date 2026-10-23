import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./emAgentBackend', () => ({
    isAgentPaired: vi.fn(() => true),
    AgentBackend: {
        scheduleDeepTalk: vi.fn(async () => ({ plan: {} })),
        cancelDeepTalk: vi.fn(async () => ({ cancelled: 1 })),
    },
}));

import type { CharacterProfile } from '../types';
import { AgentBackend } from './emAgentBackend';
import { DB } from './db';
import { DeepTalkDB } from './deepTalkDb';
import { applyDeepTalkAnswer, markDeepTalkDue, relightDeepTalk, startDeepTalkInvite } from './deepTalkActions';

const names = { userName: '阿萌', charName: '既白' };
const char = (id: string) => ({ id, name: '既白' } as unknown as CharacterProfile);
const events = async (charId: string) => (await DB.getMessagesByCharId(charId, true))
    .filter(m => m.metadata?.kind === 'deep_talk_event').map(m => ({ event: m.metadata?.deepTalkEvent, content: m.content }));

describe('烛下约时间（落库）', () => {
    beforeEach(() => {
        vi.mocked(AgentBackend.scheduleDeepTalk).mockClear();
        vi.mocked(AgentBackend.cancelDeepTalk).mockClear();
    });

    it('她约了时间、TA 答应：不是现在变纸，而是约在那个时间，并交给 mini 到点来叫', async () => {
        const c = char('jibai-a');
        const now = new Date();
        const proposedAt = now.getTime() + 2 * 3600_000;
        const { night } = await startDeepTalkInvite(c, names, { proposedAt });
        expect(night.proposedAt).toBe(proposedAt);
        expect((await events(c.id))[0].content).toContain('想在');
        const next = await applyDeepTalkAnswer(c, night, { kind: 'accept' }, names, now);
        expect(next.status).toBe('later');
        expect(next.laterAt).toBe(proposedAt);
        expect(AgentBackend.scheduleDeepTalk).toHaveBeenCalledWith(expect.objectContaining({ charId: c.id, nightId: night.id, dueAt: new Date(proposedAt).toISOString() }));
        expect((await events(c.id)).map(e => e.event)).toEqual(['invite', 'later']);
    });

    it('没约时间、TA 答应：照旧当场变纸，不找 mini', async () => {
        const c = char('jibai-b');
        const { night } = await startDeepTalkInvite(c, names);
        const next = await applyDeepTalkAnswer(c, night, { kind: 'accept' }, names);
        expect(next.status).toBe('open');
        expect(AgentBackend.scheduleDeepTalk).not.toHaveBeenCalled();
    });

    it('到点 mini 来叫：还在等就落「来了，蜡烛点上了」；她早就自己点上了就不落，并撤掉 mini 那条', async () => {
        const c = char('jibai-c');
        const now = new Date();
        const { night } = await startDeepTalkInvite(c, names, { proposedAt: now.getTime() + 3600_000 });
        const later = await applyDeepTalkAnswer(c, night, { kind: 'accept' }, names, now);
        expect(await markDeepTalkDue(c, later.id, names)).toBe(true);
        expect((await events(c.id)).at(-1)).toEqual({ event: 'due', content: '[既白来了，蜡烛点上了]' });

        await relightDeepTalk(c, (await DeepTalkDB.getActive(c.id))!, names);
        expect(AgentBackend.cancelDeepTalk).toHaveBeenCalledWith(later.id);
        expect(await markDeepTalkDue(c, later.id, names)).toBe(false);
    });
});
