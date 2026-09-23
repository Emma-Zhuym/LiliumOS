// [EM-START: agent-backend-chronicle]
import { beforeEach, describe, expect, it } from 'vitest';

import {
    clearChronicle, loadChronicle, mergeChronicle, toSegments, type ChronicleEntry,
} from './emAgentActivity';

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

const skipped = (id: number, gate: string) =>
    entry(id, '2026-09-22T20:00:00.000Z', { outcome: 'skipped', skipGate: gate, activity: null });

describe('起居注时间轴', () => {
    it('连着被拦下的醒来折成一段，而不是刷满整页', () => {
        const segments = toSegments([
            entry(1, '2026-09-22T20:05:00.000Z'),
            skipped(2, 'sleeping'),
            skipped(3, 'sleeping'),
            skipped(4, 'daily_budget'),
            entry(5, '2026-09-22T19:00:00.000Z'),
        ]);
        expect(segments.map(s => s.kind)).toEqual(['entry', 'quiet', 'entry']);
        const quiet = segments[1] as { kind: 'quiet'; count: number; gates: string[] };
        expect(quiet.count).toBe(3);
        // 理由去重，最多留两个：列全了反而看不出重点。
        expect(quiet.gates).toEqual(['在睡觉', '今天已经想了很多次']);
    });

    it('两段安静之间隔着一次活动时，不会被合并', () => {
        const segments = toSegments([
            skipped(1, 'sleeping'),
            entry(2, '2026-09-22T19:30:00.000Z'),
            skipped(3, 'sleeping'),
        ]);
        expect(segments.map(s => s.kind)).toEqual(['quiet', 'entry', 'quiet']);
    });

    it('出错的那次也算「没做什么」，但说法不一样', () => {
        const segments = toSegments([
            entry(1, '2026-09-22T20:00:00.000Z', { outcome: 'error', activity: null }),
        ]);
        const quiet = segments[0] as { kind: 'quiet'; gates: string[] };
        expect(quiet.gates).toEqual(['出了点岔子']);
    });

    it('全是活动时不会冒出安静段', () => {
        const segments = toSegments([
            entry(1, '2026-09-22T20:00:00.000Z'),
            entry(2, '2026-09-22T19:00:00.000Z', { outcome: 'message', proposedText: '在吗' }),
        ]);
        expect(segments.every(s => s.kind === 'entry')).toBe(true);
    });
});
// [EM-END: agent-backend-chronicle]
