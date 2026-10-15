import { describe, expect, it } from 'vitest';
import { minutesForRecord, SCREEN_MINUTES, summarizeScreenTime } from './emScreenTime';

const NOW = Date.parse('2026-10-14T20:00:00.000Z'); // 芝加哥 15:00

describe('屏幕使用时间', () => {
    it('同一条记录永远同一个数，并落在该类的区间里', () => {
        const record = { id: 'r1', type: 'chat', timestamp: NOW - 3600_000 };
        const first = minutesForRecord(record);
        expect(minutesForRecord(record)).toBe(first);
        const [lo, hi] = SCREEN_MINUTES.chat;
        expect(first).toBeGreaterThanOrEqual(lo);
        expect(first).toBeLessThanOrEqual(hi);
    });

    it('只算 TA 那边的今天；按 App 拆开、多的在前', () => {
        const records = [
            { id: 'a', type: 'chat', timestamp: NOW - 3600_000 },
            { id: 'b', type: 'chat', timestamp: NOW - 2 * 3600_000 },
            { id: 'c', type: 'delivery', timestamp: NOW - 30 * 60_000 },
            // 芝加哥昨天
            { id: 'd', type: 'order', timestamp: Date.parse('2026-10-14T03:00:00.000Z') },
            // 还没发生的不算
            { id: 'e', type: 'social', timestamp: NOW + 60_000 },
        ];
        const summary = summarizeScreenTime(records, { now: NOW, timeZone: 'America/Chicago' });
        expect(summary.byApp.map(app => app.type)).toEqual(['chat', 'delivery']);
        expect(summary.totalMin).toBe(summary.byApp.reduce((sum, app) => sum + app.minutes, 0));
    });

    it('今天什么都没做就是 0，不再编', () => {
        expect(summarizeScreenTime([], { now: NOW })).toEqual({ totalMin: 0, byApp: [] });
    });
});
