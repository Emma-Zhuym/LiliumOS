// [EM-START: date-plans]
import { beforeEach, describe, expect, it, vi , afterEach} from 'vitest';

import {
    buildDatePlanSceneNote, buildDatePlansChatInjection, cancelDatePlan, datePlansForSnapshot, executeDatePlanDirectives,
    importDatePlans, isRevealed, loadDatePlans, parseDatePlanDirectives, parseDateWord, parseTimeWord, upsertDatePlan, withDatePlanScene,
} from './emDatePlans';

// 2026-10-29 周四 晚上九点（本机时区）
const NOW = new Date(2026, 9, 29, 21, 0);

// 用例里写死了 2026 年 10 月的日期，「今天」也要固定住，不然过了那几天就全红
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 9, 20, 10, 0), toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('约会：日期和时间', () => {
    it('认常见说法，按阿萌这边的日历算', () => {
        expect(parseDateWord('明天', NOW)).toBe('2026-10-30');
        expect(parseDateWord('10月30日', NOW)).toBe('2026-10-30');
        expect(parseDateWord('十月三十日 晚上七点', NOW)).toBe('2026-10-30');
        expect(parseDateWord('10/31', NOW)).toBe('2026-10-31');
        expect(parseDateWord('周六 19:00-21:00', NOW)).toBe('2026-10-31');
        expect(parseDateWord('下周一', NOW)).toBe('2026-11-02');
        expect(parseDateWord('今天', NOW)).toBe('2026-10-29');
    });

    it('认不出、已经过了、太远的不收', () => {
        expect(parseDateWord('改天', NOW)).toBeNull();
        expect(parseDateWord('2026-10-01', NOW)).toBeNull();
        expect(parseDateWord('2027-03-01', NOW)).toBeNull();
        // 只写了月日、今年已经过了：是明年的，太远
        expect(parseDateWord('10月1日', NOW)).toBeNull();
    });

    it('几点', () => {
        expect(parseTimeWord('明天 19:00')).toBe('19:00');
        expect(parseTimeWord('明晚七点半')).toBe('19:30');
        expect(parseTimeWord('10月30日 下午3点')).toBe('15:00');
        expect(parseTimeWord('明天')).toBeUndefined();
    });
});

describe('约会：聊天标签', () => {
    beforeEach(() => localStorage.clear());

    it('剥掉标签、写进本机；安排里自带竖线也不丢', () => {
        const { content, ops } = parseDatePlanDirectives(
            '都安排好啦，明天你就等着吧\n[[DATE_PLAN: 明天 15:00 | 你的生日 | 三点来接你 | 先去花市\n晚上河边吃饭]]', NOW,
        );
        expect(content).toBe('都安排好啦，明天你就等着吧');
        expect(ops).toEqual([{ kind: 'save', date: '2026-10-30', time: '15:00', title: '你的生日', itinerary: '三点来接你 | 先去花市\n晚上河边吃饭' }]);
    });

    it('同一天再写一次是改；取消不删，只是标上', () => {
        const toast = vi.fn();
        executeDatePlanDirectives('[[DATE_PLAN: 10月30日 | 你的生日 | 第一版]]', 'lumi', '露米', toast);
        executeDatePlanDirectives('[[DATE_PLAN: 10月30日 19:00 | 你的生日 | 第二版]]', 'lumi', '露米', toast);
        expect(loadDatePlans()).toHaveLength(1);
        expect(loadDatePlans()[0]).toMatchObject({ itinerary: '第二版', time: '19:00' });
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('写好了：你的生日'), 'success');
        expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('第二版'), expect.anything());

        executeDatePlanDirectives('[[DATE_PLAN_CANCEL: 10月30日]]', 'lumi', '露米', toast);
        expect(loadDatePlans()[0].status).toBe('cancelled');
    });

    it('认不出日期就不记，并且告诉阿萌', () => {
        const toast = vi.fn();
        const rest = executeDatePlanDirectives('好[[DATE_PLAN: 改天 | 看海 | 开车去]]', 'lumi', '露米', toast);
        expect(rest).toBe('好');
        expect(loadDatePlans()).toEqual([]);
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('没认出日期「改天」'), 'info');
    });
});

describe('约会：给 TA 看 / 给阿萌看', () => {
    beforeEach(() => localStorage.clear());

    it('聊天提示词带自己写的全文；没写过也教怎么写', () => {
        const empty = buildDatePlansChatInjection('lumi', { userName: '阿萌', now: NOW });
        expect(empty).toContain('先真的写下来');
        expect(empty).toContain('[[DATE_PLAN: 哪天 几点 | 场合 | 完整安排]]');

        upsertDatePlan({ charId: 'lumi', date: '2026-10-30', time: '15:00', title: '你的生日', itinerary: '三点来接你' });
        upsertDatePlan({ charId: 'other', date: '2026-10-30', title: '别人的', itinerary: '不该出现' });
        const text = buildDatePlansChatInjection('lumi', { userName: '阿萌', now: NOW });
        expect(text).toMatch(/10月30日（周五 15:00，明天） · 你的生日：\n三点来接你/);
        expect(text).not.toContain('不该出现');
        expect(text).toContain('别剧透细节');
    });

    it('当天才揭晓；见面当天照安排开场', () => {
        const plan = upsertDatePlan({ charId: 'lumi', date: '2026-10-30', title: '你的生日', itinerary: '三点来接你' });
        expect(isRevealed(plan, '2026-10-29')).toBe(false);
        expect(isRevealed(plan, '2026-10-30')).toBe(true);
        expect(buildDatePlanSceneNote('lumi', '阿萌', NOW)).toBe('');
        const day = new Date(2026, 9, 30, 10, 0);
        expect(buildDatePlanSceneNote('lumi', '阿萌', day)).toContain('三点来接你');

        const messages = [{ role: 'system', content: '你是露米' }, { role: 'user', content: '嗨' }];
        expect(withDatePlanScene(messages, 'lumi', '阿萌')).toBe(messages);
    });

    it('快照只带今天和接下来两天', () => {
        upsertDatePlan({ charId: 'lumi', date: '2026-10-30', title: '生日', itinerary: 'a' });
        upsertDatePlan({ charId: 'lumi', date: '2026-11-05', title: '远的', itinerary: 'b' });
        expect(datePlansForSnapshot('lumi', NOW).map(p => p.title)).toEqual(['生日']);
        cancelDatePlan('lumi', '2026-10-30');
        expect(datePlansForSnapshot('lumi', NOW)).toEqual([]);
    });

    it('恢复备份按 id 合并', () => {
        const mine = upsertDatePlan({ charId: 'lumi', date: '2026-10-30', title: '生日', itinerary: 'a' });
        importDatePlans([{ ...mine, itinerary: '备份里的' }, { ...mine, id: 'other-id', date: '2026-10-31' }, { bad: true }]);
        expect(loadDatePlans()).toHaveLength(2);
        expect(loadDatePlans().find(p => p.id === mine.id)?.itinerary).toBe('备份里的');
    });
});
// [EM-END: date-plans]
