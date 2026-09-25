// [EM-START: calendar-temporal]
import { beforeEach, describe, expect, it } from 'vitest';

import type { TemporalItem } from './emAgentBackend';
import {
    dayKey, emptyVisibility, groupByDay, hasOpenSource, itemTimeText, levelOf, loadTemporalCache,
    monthGrid, saveTemporalCache, shiftMonth, sortItems, syncText,
} from './emTemporal';

const event = (over: Partial<TemporalItem>): TemporalItem => ({
    kind: 'event', sourceId: 'e1', source: 'Learning', title: '课',
    startAt: '2026-09-24T13:00:00.000Z', endAt: '2026-09-24T14:15:00.000Z',
    allDay: false, dueAt: null, completed: false, priority: null, location: null, repeats: null,
    fetchedAt: '2026-09-24T12:00:00.000Z', ...over,
});
const reminder = (over: Partial<TemporalItem>): TemporalItem =>
    event({ kind: 'reminder', sourceId: 'r1', source: '学业', title: '交作业', startAt: null, endAt: null, dueAt: '2026-09-24T18:00:00.000Z', ...over });

describe('可见性', () => {
    it('没设过的一律当不给看，坏档位也不会放宽', () => {
        const v = { calendars: { Learning: 'title' as const, 乱: 'everything' as unknown as 'title' }, lists: { 学业: 'busy' as const } };
        expect(levelOf(v, 'event', 'Learning')).toBe('title');
        expect(levelOf(v, 'event', '乱')).toBe('hidden');
        expect(levelOf(v, 'event', '没设过')).toBe('hidden');
        expect(levelOf(v, 'reminder', '学业')).toBe('busy');
        expect(levelOf(undefined, 'event', 'Learning')).toBe('hidden');
    });

    it('全是 hidden 就等于一个都没开', () => {
        expect(hasOpenSource(emptyVisibility())).toBe(false);
        expect(hasOpenSource({ calendars: { A: 'hidden' }, lists: {} })).toBe(false);
        expect(hasOpenSource({ calendars: { A: 'hidden' }, lists: { B: 'busy' } })).toBe(true);
    });
});

describe('按天摆', () => {
    it('事件看开始时间，提醒看截止时间；没时间的不进任何一天', () => {
        const map = groupByDay([event({}), reminder({}), reminder({ sourceId: 'r2', dueAt: null })]);
        expect([...map.keys()]).toEqual([dayKey('2026-09-24T13:00:00.000Z')]);
        expect(map.get(dayKey('2026-09-24T13:00:00.000Z'))).toHaveLength(2);
    });

    it('同一天里全天排最前，其余按时间，没时间的垫底', () => {
        const items = [
            event({ sourceId: 'b', startAt: '2026-09-24T20:00:00.000Z' }),
            reminder({ sourceId: 'x', dueAt: null }),
            event({ sourceId: 'allday', allDay: true, startAt: '2026-09-24T05:00:00.000Z' }),
            event({ sourceId: 'a', startAt: '2026-09-24T13:00:00.000Z' }),
        ];
        expect(sortItems(items).map(i => i.sourceId)).toEqual(['allday', 'a', 'b', 'x']);
    });

    it('时间文字用本机时区的时:分，全天的直接说全天', () => {
        const at = new Date('2026-09-24T13:00:00.000Z');
        expect(itemTimeText(event({}))).toBe(`${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`);
        expect(itemTimeText(event({ allDay: true }))).toBe('全天');
        expect(itemTimeText(reminder({ dueAt: null }))).toBe('');
    });
});

describe('月历格子', () => {
    it('固定 42 格、周日起头，邻月的日子标成不在本月', () => {
        // 2026-09-01 是周二 → 前面补 8/30、8/31
        const grid = monthGrid(2026, 8);
        expect(grid).toHaveLength(42);
        expect(grid[0].date.getDay()).toBe(0);
        expect(grid[0].inMonth).toBe(false);
        expect(grid[2].inMonth).toBe(true);
        expect(grid[2].date.getDate()).toBe(1);
        expect(grid.filter(c => c.inMonth)).toHaveLength(30);
    });

    it('切月跨年不会算错', () => {
        expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
        expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    });
});

describe('缓存与同步状态', () => {
    beforeEach(() => localStorage.clear());

    it('存了能读回来；坏数据按没缓存处理', () => {
        expect(loadTemporalCache()).toBeNull();
        saveTemporalCache({ items: [event({})], visibility: emptyVisibility(), sync: { count: 1 } }, 1000);
        expect(loadTemporalCache()).toMatchObject({ cachedAt: 1000, sync: { count: 1 } });
        expect(loadTemporalCache()?.items).toHaveLength(1);
        localStorage.setItem('em_temporal_cache_v1', '{不是 JSON');
        expect(loadTemporalCache()).toBeNull();
    });

    it('上次同步的说法按间隔换档', () => {
        const now = Date.parse('2026-09-24T12:00:00.000Z');
        expect(syncText(undefined, now)).toBe('还没同步过');
        expect(syncText({ lastAt: '乱七八糟' }, now)).toBe('还没同步过');
        expect(syncText({ lastAt: '2026-09-24T11:59:00.000Z' }, now)).toBe('刚刚同步过');
        expect(syncText({ lastAt: '2026-09-24T11:20:00.000Z' }, now)).toBe('40 分钟前同步');
        expect(syncText({ lastAt: '2026-09-24T09:00:00.000Z' }, now)).toBe('3 小时前同步');
        expect(syncText({ lastAt: '2026-09-22T09:00:00.000Z' }, now)).toBe('2 天前同步');
    });
});
// [EM-END: calendar-temporal]
