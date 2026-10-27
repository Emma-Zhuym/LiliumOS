import { beforeEach, describe, expect, it } from 'vitest';
import { getActiveOuting, noteOutingFromLife, outingActivity } from './emOuting';
import { computeCharStatus } from './charStatus';
import type { CharacterProfile } from '../types';

const NOW = Date.parse('2026-10-27T18:00:00.000Z');
const social = (minutes?: number, createdAt = new Date(NOW).toISOString()) => ({
    createdAt,
    life: { kind: 'social' as const, with: '林越', detail: '临时出去喝杯咖啡', ...(minutes != null ? { outing: minutes } : {}) },
});

describe('心跳临时出门 → 状态灯', () => {
    beforeEach(() => localStorage.clear());

    it('social 带 outing 才记，回来前算出门', () => {
        expect(noteOutingFromLife('lumi', social(90), NOW)).toBe(true);
        expect(getActiveOuting('lumi', NOW + 89 * 60_000)?.with).toBe('林越');
        expect(getActiveOuting('lumi', NOW + 91 * 60_000)).toBeNull();
        expect(noteOutingFromLife('lumi', social(), NOW)).toBe(false);
        expect(noteOutingFromLife('lumi', { createdAt: social().createdAt, life: { kind: 'chat', outing: 60 } }, NOW)).toBe(false);
    });

    it('取回得晚、已经回来了的不记', () => {
        const earlier = new Date(NOW - 3 * 3600_000).toISOString();
        expect(noteOutingFromLife('lumi', social(60, earlier), NOW)).toBe(false);
        expect(getActiveOuting('lumi', NOW)).toBeNull();
    });

    it('出门时盖过日程显示忙碌，到点交还给日程', () => {
        noteOutingFromLife('lumi', social(60), NOW);
        const char = { id: 'lumi' } as CharacterProfile;
        const out = computeCharStatus(null, new Date(NOW + 10 * 60_000), char);
        expect(out.status).toBe('busy');
        expect(out.currentActivity).toBe('和林越出门了');
        expect(out.msUntilChange).toBe(50 * 60_000);
        expect(computeCharStatus(null, new Date(NOW + 61 * 60_000), char).status).toBe('online');
        expect(outingActivity({ until: 0 })).toBe('出门了');
    });
});
