// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import {
    buildContactRemarkInjection, contactRemarkForSnapshot, exportContactRemarkChanges, getContactRemarkChange,
    importContactRemarkChanges, pendingContactRemarkChange, saveContactRemark,
} from './contactRemarks';
import type { Message } from '../types';

afterEach(() => localStorage.clear());
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 29, 12);
const reply = (timestamp: number) => ({ role: 'assistant', type: 'text', timestamp }) as Message;

it('写入备注：每轮都告诉 TA 当前备注；没写就什么都不加', () => {
    expect(buildContactRemarkInjection('c1', '阿萌', { now: T0 })).toBe('');
    saveContactRemark('c1', ' 小狗 ', T0);
    const text = buildContactRemarkInjection('c1', '阿萌', { messages: [reply(T0 + 1000)], now: T0 + 2000 });
    expect(text).toContain('阿萌在自己手机通讯录里给你的备注是「小狗」');
    expect(text).not.toContain('改成');
});

it('第一次写备注也算一次改动', () => {
    saveContactRemark('c1', '小狗', T0);
    expect(getContactRemarkChange('c1')).toEqual({ from: '', to: '小狗', changedAt: T0 });
    expect(buildContactRemarkInjection('c1', '阿萌', { now: T0 + 60_000 })).toContain('给你在通讯录里写了备注「小狗」（原来没写备注）');
});

it('改备注生成提醒：从什么改成什么、多久以前', () => {
    saveContactRemark('c1', '小狗', T0 - 10 * HOUR);
    saveContactRemark('c1', '大笨狗', T0);
    const text = buildContactRemarkInjection('c1', '阿萌', { messages: [reply(T0 - HOUR)], now: T0 + 5 * 60_000 });
    expect(text).toContain('把通讯录里给你的备注从「小狗」改成了「大笨狗」（5 分钟前）');
    // 没改（同一个字）不记
    saveContactRemark('c1', ' 大笨狗 ', T0 + HOUR);
    expect(getContactRemarkChange('c1')?.changedAt).toBe(T0);
});

it('提醒提过就不再出现：TA 回过一次、或者超过一天', () => {
    saveContactRemark('c1', '小狗', T0);
    expect(pendingContactRemarkChange('c1', [], T0 + HOUR)).not.toBeNull();
    expect(pendingContactRemarkChange('c1', [reply(T0 + 1000)], T0 + HOUR)).toBeNull();
    expect(pendingContactRemarkChange('c1', [{ ...reply(T0 + 1000), type: 'system' } as Message], T0 + HOUR)).not.toBeNull();
    expect(pendingContactRemarkChange('c1', [], T0 + 25 * HOUR)).toBeNull();
    // 主动消息打包不带「刚改了」
    expect(buildContactRemarkInjection('c1', '阿萌', { now: T0 + HOUR, includeChange: false })).not.toContain('写了备注');
});

it('删掉备注：只剩改动提醒，提过之后什么都不注入', () => {
    saveContactRemark('c1', '小狗', T0 - 2 * HOUR);
    saveContactRemark('c1', '', T0);
    expect(buildContactRemarkInjection('c1', '阿萌', { now: T0 + HOUR })).toContain('备注「小狗」删掉了');
    expect(buildContactRemarkInjection('c1', '阿萌', { messages: [reply(T0 + 1000)], now: T0 + HOUR })).toBe('');
});

it('心跳快照带当前备注和还没提过的改动', () => {
    saveContactRemark('c1', '小狗', T0);
    expect(contactRemarkForSnapshot('c1', [], T0 + HOUR)).toEqual({
        contactRemark: '小狗',
        contactRemarkChange: { from: '', to: '小狗', at: new Date(T0).toISOString() },
    });
    expect(contactRemarkForSnapshot('c1', [reply(T0 + 1)], T0 + HOUR)).toEqual({ contactRemark: '小狗' });
    expect(contactRemarkForSnapshot('c2', [], T0)).toEqual({});
});

it('改动记录导出再导入，备份没提到的角色保留原记录；不混进备注本身', async () => {
    saveContactRemark('c1', '小狗', T0);
    saveContactRemark('c2', '小猫', T0);
    const { exportContactRemarks } = await import('./contactRemarks');
    expect(exportContactRemarks()).toEqual({ c1: '小狗', c2: '小猫' });
    const changes = exportContactRemarkChanges();
    localStorage.clear();
    saveContactRemark('c3', '本机才有', T0);
    importContactRemarkChanges({ c1: changes!.c1, bad: { from: 1 } });
    expect(getContactRemarkChange('c1')).toEqual({ from: '', to: '小狗', changedAt: T0 });
    expect(getContactRemarkChange('c3')?.to).toBe('本机才有');
    expect(getContactRemarkChange('bad')).toBeNull();
});
