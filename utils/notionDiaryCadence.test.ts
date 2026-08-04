import { describe, expect, it } from 'vitest';
import { resolveNotionDiaryCadence } from './notionDiaryCadence';

const NOW = new Date('2026-08-04T12:00:00+08:00');

describe('resolveNotionDiaryCadence', () => {
    it('uses successful-write timestamps for the 24h and 48h thresholds', () => {
        expect(resolveNotionDiaryCadence({
            lastWrittenAt: NOW.getTime() - (24 * 60 * 60 * 1000) + 1,
            historyLookupSucceeded: true,
            now: NOW,
        })).toBe('none');
        expect(resolveNotionDiaryCadence({
            lastWrittenAt: NOW.getTime() - 24 * 60 * 60 * 1000,
            historyLookupSucceeded: true,
            now: NOW,
        })).toBe('soft');
        expect(resolveNotionDiaryCadence({
            lastWrittenAt: NOW.getTime() - 48 * 60 * 60 * 1000,
            historyLookupSucceeded: true,
            now: NOW,
        })).toBe('hard');
    });

    it('falls back to Notion calendar dates across devices', () => {
        expect(resolveNotionDiaryCadence({ latestDiaryDate: '2026-08-04', historyLookupSucceeded: true, now: NOW })).toBe('none');
        expect(resolveNotionDiaryCadence({ latestDiaryDate: '2026-08-03', historyLookupSucceeded: true, now: NOW })).toBe('soft');
        expect(resolveNotionDiaryCadence({ latestDiaryDate: '2026-08-02', historyLookupSucceeded: true, now: NOW })).toBe('hard');
    });

    it('requires a first diary only after a successful empty history lookup', () => {
        expect(resolveNotionDiaryCadence({ historyLookupSucceeded: true, now: NOW })).toBe('hard');
        expect(resolveNotionDiaryCadence({ historyLookupSucceeded: false, now: NOW })).toBe('none');
    });
});
