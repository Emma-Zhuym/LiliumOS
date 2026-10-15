import { describe, expect, it } from 'vitest';
import { pocketItemsFor } from './emAgentPocket';

const NOW = Date.parse('2026-10-14T20:00:00.000Z');
const item = (charId: string, hoursAgo: number, text = 'x') => ({
    charId, text, kind: 'share' as const, createdAt: new Date(NOW - hoursAgo * 3600_000).toISOString(),
});

describe('草稿箱缓存', () => {
    it('只要这个角色的、两天内的，最新的在前', () => {
        const items = [item('lumi', 5, '旧'), item('lumi', 1, '新'), item('elias', 1), item('lumi', 50, '过期')];
        expect(pocketItemsFor(items, 'lumi', NOW).map(i => i.text)).toEqual(['新', '旧']);
    });
});
