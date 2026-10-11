// [EM-START: calendar-temporal]
import { beforeEach, describe, expect, it } from 'vitest';

import type { TemporalItem } from './emAgentBackend';
import {
    buildTemporalInjection, cacheItem, dayKey, dueText, emptyVisibility, formatTemporalForPrompt, groupByDay,
    hasOpenSource, isOverdue, itemTimeText, levelOf, loadTemporalCache, monthGrid, openReminders, saveTemporalCache,
    shiftMonth, sortItems, syncText, uncacheItem, veilForCharacter, writableLists,
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

describe('给角色看的那一份', () => {
    const TZ = 'America/Chicago';
    const visibility = { calendars: { Learning: 'title' as const, Sleeping: 'busy' as const }, lists: { 学业: 'title' as const } };
    const course = event({ title: 'BST 631', repeats: 'week on ,  until 2026-12-04', location: '433' });
    const sleep = event({ sourceId: 's1', source: 'Sleeping', title: '睡觉', startAt: '2026-09-24T05:00:00.000Z', endAt: '2026-09-24T12:00:00.000Z', location: '家' });
    const secret = event({ sourceId: 'x1', source: 'Appointments', title: '看牙' });

    it('没开的日历整条不给；busy 的只剩「有安排」；地点一律不进', () => {
        const veiled = veilForCharacter([course, sleep, secret], visibility);
        expect(veiled.map(i => i.title)).toEqual(['BST 631', '有安排']);
        expect(veiled.every(i => i.location === null)).toBe(true);
        expect(veilForCharacter([course], emptyVisibility())).toEqual([]);
    });

    it('提醒被遮住时说的是「有件事要做」，不会漏出标题', () => {
        const [veiled] = veilForCharacter([reminder({ source: '私事' })], { calendars: {}, lists: { 私事: 'busy' } });
        expect(veiled.title).toBe('有件事要做');
    });

    it('写成提示词：此刻在忙、接下来、每周固定、快到期的事', () => {
        // 芝加哥 9/24 08:30，课正在上（8:00–9:15）
        const text = formatTemporalForPrompt([course, reminder({})], new Date('2026-09-24T13:30:00.000Z'), '阿萌', TZ);
        expect(text).toContain('此刻：BST 631，到 上午9:15');
        expect(text).toContain('每周固定：周四上午8:00 BST 631');
        expect(text).toContain('记着的事：周四前 交作业');
        expect(text).toContain('不是 ta 特地告诉你的');
        expect(text).toContain('别一见面就报菜单');
        expect(text).not.toContain('433');
    });

    it('课上完就不再说「此刻」；已完成的提醒不写；没条目就整段不写', () => {
        const later = formatTemporalForPrompt([course, reminder({ completed: true })], new Date('2026-09-24T15:00:00.000Z'), '阿萌', TZ);
        expect(later).not.toContain('此刻');
        expect(later).not.toContain('交作业');
        expect(formatTemporalForPrompt([], new Date(), '阿萌', TZ)).toBe('');
    });

    it('36 小时外的事不写进「接下来」', () => {
        const farAway = event({ sourceId: 'f1', startAt: '2026-09-28T13:00:00.000Z', endAt: null, repeats: null, title: '期中考' });
        const text = formatTemporalForPrompt([farAway], new Date('2026-09-24T13:30:00.000Z'), '阿萌', TZ);
        expect(text).toBe('');
    });

    it('buildTemporalInjection 读缓存并裁过再写；没缓存就什么都不写', () => {
        localStorage.clear();
        expect(buildTemporalInjection('阿萌')).toBe('');
        saveTemporalCache({ items: [course, secret], visibility, sync: {} });
        const text = buildTemporalInjection('阿萌', new Date('2026-09-24T13:30:00.000Z'));
        expect(text).toContain('BST 631');
        expect(text).not.toContain('看牙');
    });
});

describe('提醒：记下来和勾掉', () => {
    beforeEach(() => localStorage.clear());

    it('能写进去的清单 = 设置里开过的；一个都没开就不能建', () => {
        expect(writableLists({ calendars: {}, lists: { 学业: 'title', 私事: 'busy', 杂务: 'hidden' } })).toEqual(['学业', '私事']);
        expect(writableLists(emptyVisibility())).toEqual([]);
    });

    it('排序：逾期的在最前，没写截止时间的垫底；已完成的不列', () => {
        const items = [
            reminder({ sourceId: 'none', dueAt: null, title: '买菜' }),
            reminder({ sourceId: 'late', dueAt: '2026-09-20T18:00:00.000Z', title: '交表' }),
            reminder({ sourceId: 'soon', dueAt: '2026-09-26T18:00:00.000Z', title: '写作业' }),
            reminder({ sourceId: 'done', dueAt: '2026-09-21T18:00:00.000Z', completed: true }),
            event({}),
        ];
        expect(openReminders(items).map(i => i.sourceId)).toEqual(['late', 'soon', 'none']);
        expect(isOverdue(items[1], Date.parse('2026-09-24T12:00:00.000Z'))).toBe(true);
        expect(isOverdue(items[0], Date.parse('2026-09-24T12:00:00.000Z'))).toBe(false);
    });

    it('截止时间那一句分逾期 / 今天 / 明天 / 本周', () => {
        const now = new Date('2026-09-24T12:00:00.000Z'); // 芝加哥 9/24 07:00 周四
        expect(dueText(reminder({ dueAt: '2026-09-20T18:00:00.000Z' }), now)).toContain('逾期');
        expect(dueText(reminder({ dueAt: '2026-09-24T18:00:00.000Z' }), now)).toMatch(/^今天 /);
        expect(dueText(reminder({ dueAt: '2026-09-25T18:00:00.000Z' }), now)).toMatch(/^明天 /);
        expect(dueText(reminder({ dueAt: '2026-09-27T18:00:00.000Z' }), now)).toMatch(/^周日 /);
        expect(dueText(reminder({ dueAt: null }), now)).toBe('');
    });

    it('刚建的立刻进缓存，勾掉就从缓存里拿走；没缓存时不假装成功', () => {
        expect(cacheItem(reminder({}))).toBeNull();
        saveTemporalCache({ items: [event({})], visibility: emptyVisibility(), sync: {} });
        const added = cacheItem(reminder({ sourceId: 'R-NEW' }))!;
        expect(added.items.map(i => i.sourceId)).toEqual(['e1', 'R-NEW']);
        // 同一条再来一次是替换，不是多一条
        expect(cacheItem(reminder({ sourceId: 'R-NEW', title: '改过的' }))!.items).toHaveLength(2);
        expect(loadTemporalCache()!.items.find(i => i.sourceId === 'R-NEW')!.title).toBe('改过的');
        expect(uncacheItem('R-NEW')!.items.map(i => i.sourceId)).toEqual(['e1']);
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
