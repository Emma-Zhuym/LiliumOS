import { describe, expect, it } from 'vitest';

import type { Anniversary } from '../types';
import { awareAnniversaries, buildAnniversaryInjection, nearestOccurrence } from './emAnniversaryContext';

const anni = (over: Partial<Anniversary>): Anniversary => ({ id: 'a', title: '在一起', date: '2024-11-09', charId: 'c1', ...over });
const NOW = new Date(2026, 10, 9, 15, 0); // 2026-11-09 下午

describe('哪些日子 TA 记得', () => {
    it('只算这个角色的、没关「让 TA 记住」的；没设置 charAware 视为记得', () => {
        const all = [anni({ id: '1' }), anni({ id: '2', charAware: false }), anni({ id: '3', charId: 'c2' }), anni({ id: '4', charAware: true }), anni({ id: '5', date: '乱写' })];
        expect(awareAnniversaries(all, 'c1').map(a => a.id)).toEqual(['1', '4']);
    });
});

describe('最近的那一次', () => {
    it('每年重复：今天就是，算第几周年', () => {
        expect(nearestOccurrence(anni({}), NOW)).toMatchObject({ days: 0, years: 2 });
    });
    it('每年重复：昨天的认作昨天，前天的算明年', () => {
        expect(nearestOccurrence(anni({ date: '2024-11-08' }), NOW)).toMatchObject({ days: -1, years: 2 });
        expect(nearestOccurrence(anni({ date: '2024-11-07' }), NOW)?.days).toBe(363);
    });
    it('跨年：12 月底看 1 月初的', () => {
        expect(nearestOccurrence(anni({ date: '2020-01-02' }), new Date(2026, 11, 30))).toMatchObject({ days: 3, years: 7 });
    });
    it('只一次的：就是那一天，过了就是负数', () => {
        expect(nearestOccurrence(anni({ date: '2026-11-12', repeatYearly: false }), NOW)?.days).toBe(3);
        expect(nearestOccurrence(anni({ date: '2025-11-09', repeatYearly: false }), NOW)?.days).toBe(-365);
    });
    it('2 月 29 日在平年按 2 月 28 日过', () => {
        expect(nearestOccurrence(anni({ date: '2024-02-29' }), new Date(2027, 1, 28))).toMatchObject({ days: 0, years: 3 });
    });
    it('还没到起始那年的不算周年', () => {
        expect(nearestOccurrence(anni({ date: '2026-11-12' }), NOW)).toMatchObject({ days: 3, years: 0 });
    });
});

describe('写进提示词', () => {
    it('没有记着的日子就什么都不写', () => {
        expect(buildAnniversaryInjection([anni({ charAware: false })], 'c1', { now: NOW })).toBe('');
    });
    it('今天是纪念日：列出来、说是今天、几周年，按她那边的日历', () => {
        const s = buildAnniversaryInjection([anni({})], 'c1', { userName: '阿萌', now: NOW });
        expect(s).toContain('「在一起」：每年11月9日（2024年起）');
        expect(s).toContain('今天是「在一起」（2 周年）');
        expect(s).toContain('今天就是这一天');
        expect(s).toContain('按阿萌那边的日历算');
    });
    it('一周内快到的提前说，远的只在清单里', () => {
        const s = buildAnniversaryInjection([anni({ id: '1', title: '初见', date: '2023-11-13' }), anni({ id: '2', title: '生日', date: '2000-03-01' })], 'c1', { now: NOW });
        expect(s).toContain('4 天后（11月13日）是「初见」（3 周年）');
        expect(s).toContain('「生日」：每年3月1日（2000年起）');
        expect(s).not.toContain('是「生日」');
        expect(s).toContain('快到了');
    });
    it('只一次的日子写完整日期，过了就不在眼下', () => {
        const s = buildAnniversaryInjection([anni({ title: '搬家', date: '2026-10-01', repeatYearly: false })], 'c1', { now: NOW });
        expect(s).toContain('「搬家」：2026年10月1日');
        expect(s).not.toContain('眼下');
    });
});
