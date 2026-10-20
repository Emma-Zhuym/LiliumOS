import { describe, expect, it } from 'vitest';
import { pocketItemsFor } from './emAgentPocket';

const NOW = Date.parse('2026-10-14T20:00:00.000Z');
const item = (charId: string, hoursAgo: number, text = 'x', expiresInHours?: number) => ({
    charId, text, kind: 'share' as const, createdAt: new Date(NOW - hoursAgo * 3600_000).toISOString(),
    ...(expiresInHours === undefined ? {} : { expiresAt: new Date(NOW + expiresInHours * 3600_000).toISOString() }),
});

describe('草稿箱缓存', () => {
    it('只要这个角色的、两天内的，最新的在前', () => {
        const items = [item('lumi', 5, '旧'), item('lumi', 1, '新'), item('elias', 1), item('lumi', 50, '过期')];
        expect(pocketItemsFor(items, 'lumi', NOW).map(i => i.text)).toEqual(['新', '旧']);
    });

    it('过了这句自己的保质期就不显示，哪怕缓存没刷新', () => {
        const items = [item('lumi', 4, '待会儿喝', -1), item('lumi', 4, '周鹏说室内风大', 40)];
        expect(pocketItemsFor(items, 'lumi', NOW).map(i => i.text)).toEqual(['周鹏说室内风大']);
    });
});
