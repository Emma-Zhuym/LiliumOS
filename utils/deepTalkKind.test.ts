import { describe, expect, it } from 'vitest';

import type { CharacterProfile } from '../types';
import { DB } from './db';
import { getCachedMatterNightIds, loadMatterNightIds } from './deepTalkDb';
import { endDeepTalk, saveDeepTalkSegment, setDeepTalkKind } from './deepTalkActions';
import type { DeepTalkNight } from './deepTalk';

const names = { userName: '阿萌', charName: '既白' };
const char = (id: string) => ({ id, name: '既白' } as unknown as CharacterProfile);
const openNight = (charId: string): DeepTalkNight => ({ id: `n-${charId}`, charId, status: 'open', invitedBy: 'user', invitedAt: Date.now(), startedAt: Date.now() });

describe('两种夜（落库）', () => {
    it('收尾认不出来就按说真话；她改成照常记住，原文就进谈事名单，改回来又出去', async () => {
        const c = char('kind-a');
        const night = openNight(c.id);
        await saveDeepTalkSegment(c.id, night.id, 'user', '要不要换个大点的公寓？');
        // 没配 API：生成不了名字，照样收卡
        const closed = await endDeepTalk({ char: c, night, names, api: { baseUrl: '', apiKey: '', model: '' }, palace: null });
        expect(closed.kind).toBe('truth');
        expect(getCachedMatterNightIds(c.id).has(night.id)).toBe(false);

        const matter = await setDeepTalkKind(closed, 'matter');
        expect(matter.kind).toBe('matter');
        expect(getCachedMatterNightIds(c.id).has(night.id)).toBe(true);
        expect((await loadMatterNightIds(c.id)).has(night.id)).toBe(true);

        await setDeepTalkKind(matter, 'truth');
        expect(getCachedMatterNightIds(c.id).has(night.id)).toBe(false);
        expect((await DB.getMessagesByCharId(c.id, true)).some(m => m.metadata?.kind === 'deep_talk_card')).toBe(true);
    });

    it('还开着的那次改不了', async () => {
        const night = openNight('kind-b');
        expect(await setDeepTalkKind(night, 'matter')).toBe(night);
    });
});
