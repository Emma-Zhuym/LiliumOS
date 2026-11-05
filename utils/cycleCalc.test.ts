import { describe, expect, it } from 'vitest';

import type { DischargeAmount, PeriodHealthEvent } from './healthDb';
import { calcCycleStatus, isBreastSymptom } from './cycleCalc';

const period = (...dates: string[]): PeriodHealthEvent[] =>
    dates.map(date => ({ id: `p_${date}`, date, createdAt: 0, type: 'period', flow: 'medium' }));
const wet = (...dates: string[]) => dates.map(date => ({ date, amount: 'soaked' as DischargeAmount }));
const pain = (...dates: string[]) => dates.map(date => ({ date, symptoms: ['乳头硬痛'] }));
const at = (date: string) => new Date(`${date}T12:00:00`);

describe('周期：没有信号时照旧按平均周期', () => {
    it('28 天周期，排卵窗还是第 12–16 天', () => {
        const s = calcCycleStatus(period('2026-09-01', '2026-09-29', '2026-10-27'), {}, at('2026-11-01'));
        expect(s.nextPredictedStart).toBe('2026-11-24');
        expect(s.nextSource).toBe('cycle');
        expect(s.ovulationWindow).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
        expect(s.ovulationSource).toBe('predicted');
    });

    it('周期长的人排卵也往后挪（原来写死第 12–16 天）', () => {
        const s = calcCycleStatus(period('2026-08-01', '2026-09-04', '2026-10-08'), {}, at('2026-10-10'));
        expect(s.avgCycleLength).toBe(34);
        expect(s.ovulationWindow).toContain('2026-10-27'); // 11-11 往回 14 天
    });
});

describe('周期：这一轮的信号', () => {
    it('记了出水：排卵窗就是那几天，下次按最后一天湿透 + 14', () => {
        const s = calcCycleStatus(period('2026-10-27'), { discharge: wet('2026-11-08', '2026-11-09', '2026-11-10') }, at('2026-11-13'));
        expect(s.ovulationSource).toBe('observed');
        expect(s.ovulationWindow).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
        expect(s.nextSource).toBe('peak');
        expect(s.nextPredictedStart).toBe('2026-11-24');
        expect(s.signalNote).toBe('估计 11月10日 前后排过卵');
    });

    it('还在出水：说可能就是这几天', () => {
        const s = calcCycleStatus(period('2026-10-27'), { discharge: wet('2026-11-08', '2026-11-09') }, at('2026-11-09'));
        expect(s.signalNote).toBe('这两天在出水，可能就是排卵期');
    });

    it('少 / 黏稠不算排卵信号', () => {
        const s = calcCycleStatus(period('2026-10-27'), { discharge: [{ date: '2026-11-08', amount: 'sticky' }] }, at('2026-11-09'));
        expect(s.ovulationSource).toBe('predicted');
    });

    it('胸痛开始比出水更近，优先按它推；经期那几天的胸痛不算', () => {
        const s = calcCycleStatus(period('2026-10-27'), {
            discharge: wet('2026-11-09'),
            symptoms: [...pain('2026-10-28'), ...pain('2026-11-12', '2026-11-13')],
        }, at('2026-11-14'));
        expect(s.nextSource).toBe('breast');
        expect(s.nextPredictedStart).toBe('2026-11-26');
    });
});

describe('周期：从以前几轮学她自己的间隔', () => {
    const history = {
        discharge: wet('2026-08-14', '2026-09-12', '2026-10-11', '2026-11-08'),
        symptoms: pain('2026-08-16', '2026-09-14', '2026-10-13', '2026-11-11'),
    };
    // 每轮：出水最后一天后 13 天来，胸痛开始后 11 天来
    const starts = period('2026-08-01', '2026-08-27', '2026-09-25', '2026-10-24');

    it('学到的天数替换默认 14，范围收窄到前后一天', () => {
        const s = calcCycleStatus(starts, history, at('2026-11-12'));
        expect(s.learned.afterPeak).toEqual([13, 13, 13]);
        expect(s.learned.afterBreast).toEqual([11, 11, 11]);
        expect(s.nextSource).toBe('breast');
        expect(s.nextPredictedStart).toBe('2026-11-22');
        expect(s.uncertain).toBe(false);
        expect(s.nextRangeStr).toBe('11月21日 ~ 11月23日');
    });

    it('这一轮还没有信号：按平均周期，排卵按学到的间隔往回推', () => {
        const s = calcCycleStatus(starts, history, at('2026-10-30'));
        expect(s.nextSource).toBe('cycle');
        expect(s.ovulationWindow).toContain('2026-11-08');
    });
});

describe('胸那一类症状', () => {
    it('乳头、乳房、胸痛 / 胸胀算，胸闷不算', () => {
        expect(['乳头硬痛', '乳房胀痛', '胸痛', '胸胀'].every(isBreastSymptom)).toBe(true);
        expect(isBreastSymptom('胸闷')).toBe(false);
        expect(isBreastSymptom('头痛')).toBe(false);
    });
});
