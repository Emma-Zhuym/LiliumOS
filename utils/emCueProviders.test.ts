import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarCue, financeCue, kitchenCue, ownLifeCue, rollChatCue } from './emCueProviders';
import { getPendingCue, loadCueState, setPendingCue } from './emCuePool';
import type { PhoneEvidence } from '../types';

const NOW = Date.parse('2026-10-14T20:00:00.000Z');
const DAY = 24 * 3600_000;

describe('契机来源', () => {
    it('账本：只认正常计入的支出，转账、待入账、代收代付不当话头', () => {
        const base = { dataAsOf: NOW, windowDays: 7, totals: [{ currency: 'USD', amount: 120.5 }] };
        const row = (over: object) => ({ date: '2026-10-13', merchant: 'Trader Joe\'s', amount: 42.1, currency: 'USD', type: 'expense' as const, category: '食品', pending: false, analysisTreatment: '正常计入', ...over });
        const cue = financeCue({ ...base, recent: [row({ type: 'transfer', merchant: '转给妈妈' }), row({ pending: true, merchant: '待入账' }), row({ analysisTreatment: '代收代付', merchant: '帮人买' }), row({})] }, '阿萌');
        expect(cue?.text).toContain('Trader Joe\'s');
        expect(cue?.text).toContain('120.50 USD');
        expect(cue?.toolGroup).toBe('finance');
        expect(financeCue({ ...base, recent: [row({ type: 'transfer' })] }, '阿萌')).toBeNull();
        expect(financeCue(null, '阿萌')).toBeNull();
    });

    it('冰箱：快到期的优先，其次是放了两天的剩菜；常温柜不看', () => {
        const names = new Map([['milk', '牛奶'], ['pork', '红烧肉'], ['noodle', '泡面']]);
        const lot = (over: object) => ({ id: 'l', foodId: 'milk', quantity: 1, storageZone: 'fridge', foodState: 'raw', createdAt: NOW - DAY, ...over });
        expect(kitchenCue([lot({ id: 'a', expiresAt: new Date(NOW + 1.5 * DAY).toISOString() })], names, NOW, '阿萌')?.text).toMatch(/「牛奶」后天就到期了.*现实里的冰箱/);
        expect(kitchenCue([lot({ id: 'b', foodId: 'pork', foodState: 'leftover', createdAt: NOW - 3 * DAY })], names, NOW, '阿萌')?.text).toMatch(/做好的「红烧肉」，3 天前的/);
        expect(kitchenCue([lot({ id: 'c', foodId: 'noodle', storageZone: 'pantry', expiresAt: new Date(NOW + DAY).toISOString() })], names, NOW, '阿萌')).toBeNull();
        expect(kitchenCue([lot({ id: 'd', quantity: 0, expiresAt: new Date(NOW + DAY).toISOString() })], names, NOW, '阿萌')).toBeNull();
    });

    it('日历：只用「能看到标题」的；只知道在忙的不用', () => {
        const levelOf = (v: any, kind: 'event' | 'reminder', source: string) => (kind === 'event' ? v.calendars[source] : v.lists[source]) ?? 'hidden';
        const visibility = { calendars: { 课表: 'title', 私事: 'busy' }, lists: {} } as any;
        const ev = (over: object) => ({ kind: 'event' as const, sourceId: 's', source: '课表', title: '组会', startAt: new Date(NOW + 2 * 3600_000).toISOString(), endAt: new Date(NOW + 3 * 3600_000).toISOString(), allDay: false, dueAt: null, completed: false, priority: null, location: null, repeats: null, fetchedAt: '', ...over });
        expect(calendarCue([ev({})], visibility, NOW, '阿萌', levelOf, 'America/Chicago')?.text).toBe('阿萌 17:00 有「组会」');
        expect(calendarCue([ev({ source: '私事' })], visibility, NOW, '阿萌', levelOf)).toBeNull();
        expect(calendarCue([ev({ startAt: new Date(NOW + 2 * DAY).toISOString() })], visibility, NOW, '阿萌', levelOf)).toBeNull();
    });

    it('他自己的生活：只认心跳写进来的、一天以内的，最新的一条', () => {
        const rec = (over: Partial<PhoneEvidence>): PhoneEvidence => ({ id: 'r', type: 'chat', title: '老周', detail: '老周：打球？\n我：行', timestamp: NOW - 3600_000, agentSourceIds: ['hb:1'], ...over });
        expect(ownLifeCue([rec({}), rec({ id: 'old', timestamp: NOW - 2 * DAY, title: '太早' })], NOW)?.text).toBe('你这一天里跟老周聊过：老周：打球？ / 我：行');
        expect(ownLifeCue([rec({ agentSourceIds: undefined })], NOW)).toBeNull();
        expect(ownLifeCue([rec({ type: 'order', title: '围巾' })], NOW)?.text).toBe('你这一天里在网上买了围巾');
    });
});

describe('每轮抽念头', () => {
    beforeEach(() => { localStorage.clear(); setPendingCue('lumi', null); });

    it('skip 时清空、不掷；掷中了就放进这一轮并记账', async () => {
        setPendingCue('lumi', { source: 'kitchen', dedupeKey: 'k', text: '旧的' });
        await rollChatCue({ id: 'lumi', phoneState: undefined } as any, { skip: true, now: NOW, rng: () => 0 });
        expect(getPendingCue('lumi')).toBeNull();

        const records: PhoneEvidence[] = [{ id: 'r', type: 'chat', title: '老周', detail: '打球？', timestamp: NOW - 3600_000, agentSourceIds: ['hb:1'] }];
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cue = await rollChatCue({ id: 'lumi', phoneState: { records } } as any, { now: NOW, rng: () => 0, route: 'mini', userName: '阿萌' });
        expect(cue?.source).toBe('own_life');
        expect(getPendingCue('lumi')?.dedupeKey).toBe(cue?.dedupeKey);
        expect(loadCueState('lumi').log[0].route).toBe('mini');

        // 紧接着下一轮：离上一个太近，不闪，也不带上一轮的
        expect(await rollChatCue({ id: 'lumi', phoneState: { records } } as any, { now: NOW + 60_000, rng: () => 0 })).toBeNull();
        expect(getPendingCue('lumi')).toBeNull();
    });
});
