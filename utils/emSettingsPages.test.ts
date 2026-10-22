import { describe, expect, it } from 'vitest';
import { mcpRowValue, miniRowValue, relativeAgo, settingsAlerts } from './emSettingsPages';

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

describe('relativeAgo', () => {
    it('说刚刚、分钟、小时、天', () => {
        expect(relativeAgo(NOW - 20_000, NOW)).toBe('刚刚');
        expect(relativeAgo(NOW - 12 * 60_000, NOW)).toBe('12 分钟前');
        expect(relativeAgo(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前');
        expect(relativeAgo(NOW - 4 * 86_400_000, NOW)).toBe('4 天前');
    });

    it('钟不准、时间在未来也算刚刚', () => {
        expect(relativeAgo(NOW + 60_000, NOW)).toBe('刚刚');
    });
});

describe('mcpRowValue', () => {
    const result = (ok: boolean) => ({ id: String(Math.random()), name: 'x', ok, message: '', toolCount: 1 });

    it('没配服务器就写未设置', () => {
        expect(mcpRowValue(null, 0, false)).toEqual({ text: '未设置', bad: false, dot: false });
    });

    it('还没测完时不冒红点', () => {
        expect(mcpRowValue(null, 3, true)).toEqual({ text: '正在测…', bad: false, dot: false });
    });

    it('有一台连不上就标红', () => {
        const health = { checkedAt: NOW, results: [result(true), result(true), result(false)] };
        expect(mcpRowValue(health, 3, false)).toEqual({ text: '2/3 在线', bad: true, dot: true });
    });

    it('全在线是绿点', () => {
        const health = { checkedAt: NOW, results: [result(true), result(true)] };
        expect(mcpRowValue(health, 2, false)).toEqual({ text: '2/2 在线', bad: false, dot: true });
    });
});

describe('miniRowValue', () => {
    it('休息中不算故障，不冒红点', () => {
        expect(miniRowValue('resting').dot).toBeNull();
        expect(miniRowValue('revoked').dot).toBe('bad');
        expect(miniRowValue('online')).toEqual({ text: '在线', dot: 'ok' });
    });
});

describe('settingsAlerts', () => {
    it('一切正常时一条都没有', () => {
        expect(settingsAlerts({ staleBackupDays: null, instantPushOn: false, miniState: 'online' })).toEqual([]);
    });

    it('没备份、Instant Push 还开着、mini 钥匙失效各冒一条', () => {
        const alerts = settingsAlerts({ staleBackupDays: 4, instantPushOn: true, miniState: 'revoked' });
        expect(alerts.map(a => a.id)).toEqual(['backup-stale', 'instant-push-on', 'mini-revoked']);
        expect(alerts[0].title).toBe('已经 4 天没备份');
        expect(alerts[1].page).toBe('push');
    });

    it('从没成功备份过换一种说法', () => {
        const [alert] = settingsAlerts({ staleBackupDays: Infinity, instantPushOn: false, miniState: 'unpaired' });
        expect(alert.title).toBe('云端备份还没成功过');
    });

    it('mini 只是在休息不提醒', () => {
        expect(settingsAlerts({ staleBackupDays: null, instantPushOn: false, miniState: 'resting' })).toEqual([]);
    });
});
