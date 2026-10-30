// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { afterAll, vi } from 'vitest';
import {
    buildContactRemarkInjection, contactRemarkForSnapshot, exportContactRemarkChanges, getContactRemarkChange,
    importContactRemarkChanges, pendingContactRemarkChange, remarkChangeNotice, saveContactRemark,
} from './contactRemarks';
import { saveContactRemarkWithNotice } from './contactRemarkActions';
import { DB } from './db';
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
    expect(saveContactRemark('c1', '小狗', T0)).toEqual({ from: '', to: '小狗', changedAt: T0 });
    expect(getContactRemarkChange('c1')).toEqual({ from: '', to: '小狗', changedAt: T0 });
    expect(buildContactRemarkInjection('c1', '阿萌', { now: T0 + 60_000 })).toContain('「阿萌给你写了备注」的系统提示');
});

it('改备注生成提醒：系统提示写从什么改成什么，提示词教 TA 怎么反应', () => {
    saveContactRemark('c1', '小狗', T0 - 10 * HOUR);
    const change = saveContactRemark('c1', '大笨狗', T0)!;
    expect(remarkChangeNotice(change, '阿萌', '露米')).toBe('阿萌把露米的备注从「小狗」改成了「大笨狗」');
    expect(remarkChangeNotice({ ...change, from: '' }, '阿萌', '露米')).toBe('阿萌给露米写了备注「大笨狗」');
    expect(remarkChangeNotice({ ...change, to: '' }, '阿萌', '露米')).toBe('阿萌删掉了露米的备注「小狗」');
    const text = buildContactRemarkInjection('c1', '阿萌', { messages: [reply(T0 - HOUR)], now: T0 + 5 * 60_000 });
    expect(text).toContain('「阿萌把你的备注从…改成了…」的系统提示');
    // 没改（同一个字）不记
    expect(saveContactRemark('c1', ' 大笨狗 ', T0 + HOUR)).toBeNull();
    expect(getContactRemarkChange('c1')?.changedAt).toBe(T0);
});

it('保存备注：真改了才在私聊里留一条系统提示', async () => {
    const saved: any[] = [];
    const spy = vi.spyOn(DB, 'saveMessage').mockImplementation(async (m: any) => { saved.push(m); return saved.length; });
    const char = { id: 'c1', name: '露米' };
    expect(await saveContactRemarkWithNotice(char, '小狗', '阿萌', T0)).toBe(true);
    expect(await saveContactRemarkWithNotice(char, '小狗 ', '阿萌', T0 + 1)).toBe(false);
    expect(saved).toEqual([{
        charId: 'c1', role: 'system', type: 'text', content: '阿萌给露米写了备注「小狗」', timestamp: T0,
        metadata: { kind: 'contact_remark_change', from: '', to: '小狗' },
    }]);
    // 提示写不进去：备注照样存好，不算保存失败
    spy.mockRejectedValueOnce(new Error('db'));
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    expect(await saveContactRemarkWithNotice(char, '大笨狗', '阿萌', T0 + 2)).toBe(false);
    expect(getContactRemarkChange('c1')?.to).toBe('大笨狗');
});
afterAll(() => vi.restoreAllMocks());

it('提醒提过就不再出现：TA 回过一次、或者超过一天', () => {
    saveContactRemark('c1', '小狗', T0);
    expect(pendingContactRemarkChange('c1', [], T0 + HOUR)).not.toBeNull();
    expect(pendingContactRemarkChange('c1', [reply(T0 + 1000)], T0 + HOUR)).toBeNull();
    expect(pendingContactRemarkChange('c1', [{ ...reply(T0 + 1000), type: 'system' } as Message], T0 + HOUR)).not.toBeNull();
    expect(pendingContactRemarkChange('c1', [], T0 + 25 * HOUR)).toBeNull();
    // 主动消息打包不带「刚改了」
    expect(buildContactRemarkInjection('c1', '阿萌', { now: T0 + HOUR, includeChange: false })).not.toContain('系统提示');
    expect(buildContactRemarkInjection('c1', '阿萌', { messages: [reply(T0 + 1000)], now: T0 + HOUR })).not.toContain('系统提示');
});

it('删掉备注：只剩改动提醒，提过之后什么都不注入', () => {
    saveContactRemark('c1', '小狗', T0 - 2 * HOUR);
    saveContactRemark('c1', '', T0);
    expect(buildContactRemarkInjection('c1', '阿萌', { now: T0 + HOUR })).toContain('「阿萌删掉了你的备注」的系统提示');
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
