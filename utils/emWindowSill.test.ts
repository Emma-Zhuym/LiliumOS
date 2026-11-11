import { beforeEach, describe, expect, it } from 'vitest';

import { beatText, pickBigCard, runApp, saveSillTheme, sillThemeFor, strongestLine, takeDealToday, weekdayLabels } from './emWindowSill';

const run = (patch: Record<string, unknown>) => ({
    id: 1, charId: 'c', runtime: 'api', startedAt: '2026-11-10T15:00:00Z', durationMs: 1, ok: true, outcome: 'noop',
    shadow: false, reason: null, activity: '看完了综述', proposedText: null, skipGate: null, error: null, ...patch,
}) as any;

describe('窗台', () => {
    beforeEach(() => localStorage.clear());

    it('颜色：没选过按顺序轮着给，选过的记在本机', () => {
        expect([0, 1, 2, 3].map(i => sillThemeFor(`c${i}`, i))).toEqual(['spring', 'summer', 'earlyWinter', 'spring']);
        saveSillTheme('c0', 'earlyWinter');
        expect(sillThemeFor('c0', 0)).toBe('earlyWinter');
        expect(sillThemeFor('x', 1, { x: 'nonsense' })).toBe('summer');
    });

    it('胶囊：过日子的事优先，礼物只说渠道，发消息算聊天，没醒没有胶囊', () => {
        expect(runApp(run({ episode: { life: { kind: 'delivery' } } }))).toBe('外卖');
        expect(runApp(run({ outcome: 'message', episode: { life: { kind: 'gift', via: 'food' } } }))).toBe('外卖');
        expect(runApp(run({ episode: { channel: 'email', with: '导师' } }))).toBe('邮件');
        expect(runApp(run({ outcome: 'message' }))).toBe('聊天');
        expect(runApp(run({ outcome: 'noop' }))).toBeNull();
        expect(runApp(run({ outcome: 'skipped', episode: { life: { kind: 'xhs' } } }))).toBeNull();
        expect(beatText(run({ ok: false, outcome: 'error', error: '超时' }))).toEqual({ text: '这一跳没醒过来', faint: true });
    });

    it('七日心事：星期几、最重的一笔怎么说', () => {
        const days = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'];
        expect(weekdayLabels(days)).toEqual(['三', '四', '五', '六', '日', '一', '今']);
        expect(strongestLine([{ drive: 'miss', levels: [0, 0, 0, 0, 1, 2, 3] }], days)).toEqual({ label: '想你', text: '这几天一天比一天浓，今天最浓' });
        expect(strongestLine([{ drive: 'tired', levels: [0, 0, 4, 1, 0, 0, 0] }, { drive: 'miss', levels: [0, 0, 0, 0, 0, 0, 2] }], days))
            .toEqual({ label: '疲惫', text: '周五最浓，现在缓下来了' });
        expect(strongestLine([{ drive: 'sulk', levels: [0, 0, 0, 0, 0, 3, 1] }], days)).toEqual({ label: '芥蒂', text: '昨天最浓，现在还在' });
        expect(strongestLine([{ drive: 'miss', levels: [0, 0, 0, 0, 0, 0, 0] }], days)).toBeNull();
    });

    it('大牌：朝着她的心思最强的那个；都平平就没有大牌', () => {
        expect(pickBigCard([
            { charId: 'a', drives: [{ drive: 'tired', level: 'high' }] },
            { charId: 'b', drives: [{ drive: 'miss', level: 'mid' }], lastAt: '2026-11-10T10:00:00Z' },
            { charId: 'c', drives: [{ drive: 'concern', level: 'mid' }], lastAt: '2026-11-10T12:00:00Z' },
        ])).toBe('c');
        expect(pickBigCard([{ charId: 'a', drives: [{ drive: 'curious', level: 'high' }] }])).toBeNull();
    });

    it('发牌：一天只发一次', () => {
        const now = new Date(2026, 10, 10, 9);
        expect(takeDealToday(now)).toBe(true);
        expect(takeDealToday(now)).toBe(false);
        expect(takeDealToday(new Date(2026, 10, 11, 9))).toBe(true);
    });
});
