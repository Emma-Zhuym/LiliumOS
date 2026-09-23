// [EM-START: agent-backend-chronicle]
import { beforeEach, describe, expect, it } from 'vitest';

import { clearChronicle, loadChronicle, mergeChronicle, type ChronicleEntry } from './emAgentActivity';

const CHAR = 'lumi';

const entry = (id: number, at: string, overrides: Partial<ChronicleEntry> = {}): ChronicleEntry => ({
    id,
    charId: CHAR,
    activity: `做了第 ${id} 件事`,
    outcome: 'noop',
    skipGate: null,
    proposedText: null,
    shadow: true,
    at,
    ...overrides,
});

describe('起居注本地缓存', () => {
    beforeEach(() => clearChronicle(CHAR));

    it('按时间倒序合并，新的在前', () => {
        mergeChronicle(CHAR, [entry(1, '2026-09-22T10:00:00.000Z')]);
        const merged = mergeChronicle(CHAR, [entry(2, '2026-09-22T12:00:00.000Z')]);
        expect(merged.map(item => item.id)).toEqual([2, 1]);
    });

    it('同一个 id 以新取到的为准：服务端才是事实来源', () => {
        mergeChronicle(CHAR, [entry(1, '2026-09-22T10:00:00.000Z', { activity: '旧的说法' })]);
        const merged = mergeChronicle(CHAR, [entry(1, '2026-09-22T10:00:00.000Z', { activity: '新的说法' })]);
        expect(merged).toHaveLength(1);
        expect(merged[0].activity).toBe('新的说法');
    });

    it('每个角色最多留 200 条', () => {
        const many = Array.from({ length: 260 }, (_, index) =>
            entry(index, new Date(Date.parse('2026-09-01T00:00:00.000Z') + index * 60_000).toISOString()));
        const merged = mergeChronicle(CHAR, many);
        expect(merged).toHaveLength(200);
        // 留下的是最新的那 200 条。
        expect(merged[0].id).toBe(259);
    });

    it('存坏了当没有，不抛错', () => {
        localStorage.setItem('em_agent_chronicle_v1:lumi', '不是 JSON');
        expect(loadChronicle(CHAR)).toEqual([]);
    });
});
// [EM-END: agent-backend-chronicle]
