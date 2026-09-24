// [EM-START: agent-life]
import { describe, expect, it } from 'vitest';

import type { CharacterProfile, PhoneContact } from '../types';
import { applyLifeEpisode, type LifeEvent } from './emLife';

type Phone = NonNullable<CharacterProfile['phoneState']>;
const AT = '2026-09-24T01:30:00.000Z';

const chat = (id: string, extra: Partial<LifeEvent['life']> = {}): LifeEvent => ({
    messageId: id,
    createdAt: AT,
    life: { kind: 'chat', with: '老周', relation: '发小', group: 'friend', lines: [{ who: '老周', text: '周末打球？' }, { who: '我', text: '行啊' }], ...extra },
});
const contact = (overrides: Partial<PhoneContact>): PhoneContact => ({
    id: 'c1', name: '老周', kind: 'npc', affinity: 0, status: 'friend', createdAt: 0, ...overrides,
});

describe('applyLifeEpisode · 聊天', () => {
    it('新的人：进通讯录（带称呼和分组），聊天记成「我 / 对方」格式', () => {
        const next = applyLifeEpisode(undefined, chat('hb:1:life'))!;
        expect(next.contacts).toHaveLength(1);
        expect(next.contacts![0]).toMatchObject({ name: '老周', kind: 'npc', identity: '发小', group: 'friend' });
        expect(next.records).toHaveLength(1);
        expect(next.records[0]).toMatchObject({ type: 'chat', title: '老周', contactId: next.contacts![0].id });
        expect(next.records[0].detail).toBe('对方: 周末打球？\n我: 行啊');
    });

    it('认识的人：接在原来那段聊天后面，不另起一条；已有的称呼和分组不被改', () => {
        const phone: Phone = {
            contacts: [contact({ identity: '大学室友', group: 'school' })],
            records: [{ id: 'r1', type: 'chat', title: '老周', detail: '我: 在吗', timestamp: 1, contactId: 'c1' }],
        };
        const next = applyLifeEpisode(phone, chat('hb:2:life'))!;
        expect(next.records).toHaveLength(1);
        expect(next.records[0].detail).toBe('我: 在吗\n对方: 周末打球？\n我: 行啊');
        expect(next.records[0].agentSourceIds).toEqual(['hb:2:life']);
        expect(next.contacts![0]).toMatchObject({ identity: '大学室友', group: 'school' });
    });

    it('幂等：同一段取回两次不重复接', () => {
        const once = applyLifeEpisode(undefined, chat('hb:3:life'))!;
        expect(applyLifeEpisode(once, chat('hb:3:life'))).toBeNull();
    });

    it('真人角色、被删被拉黑的人、阿萌本人都不写', () => {
        expect(applyLifeEpisode({ records: [], contacts: [contact({ kind: 'real', linkedCharId: 'x' })] }, chat('a'))).toBeNull();
        expect(applyLifeEpisode({ records: [], contacts: [contact({ status: 'blocked' })] }, chat('b'))).toBeNull();
        expect(applyLifeEpisode(undefined, chat('c', { with: '阿萌' }), { userName: '阿萌' })).toBeNull();
    });
});

describe('applyLifeEpisode · 外卖 / 网购 / 朋友圈', () => {
    it('各进各的 App，带价格；朋友圈用时间当标题', () => {
        const delivery = applyLifeEpisode(undefined, { messageId: 'd', createdAt: AT, life: { kind: 'delivery', with: '老王麻辣烫', detail: '加麻加辣', value: '¥32' } })!;
        expect(delivery.records[0]).toMatchObject({ id: 'ag-d', type: 'delivery', title: '老王麻辣烫', detail: '加麻加辣', value: '¥32' });
        const order = applyLifeEpisode(undefined, { messageId: 'o', createdAt: AT, life: { kind: 'order', with: '机械键盘' } })!;
        expect(order.records[0]).toMatchObject({ type: 'order', title: '机械键盘', detail: '…' });
        const moment = applyLifeEpisode(undefined, { messageId: 'm', createdAt: AT, life: { kind: 'moment', detail: '今天的云很好看', value: '不该有' } })!;
        expect(moment.records[0].type).toBe('social');
        expect(moment.records[0].detail).toBe('今天的云很好看');
        expect(moment.records[0].value).toBeUndefined();
        expect(applyLifeEpisode(moment, { messageId: 'm', createdAt: AT, life: { kind: 'moment', detail: 'x' } })).toBeNull();
    });

    it('缺必填的不写', () => {
        expect(applyLifeEpisode(undefined, { messageId: 'x', createdAt: AT, life: { kind: 'delivery' } })).toBeNull();
        expect(applyLifeEpisode(undefined, { messageId: 'y', createdAt: AT, life: { kind: 'moment' } })).toBeNull();
    });

    it('原有的记录和联系人原样保留', () => {
        const phone: Phone = { records: [{ id: 'old', type: 'order', title: '旧单', detail: '', timestamp: 1 }], contacts: [contact({})] };
        const next = applyLifeEpisode(phone, { messageId: 'z', createdAt: AT, life: { kind: 'delivery', with: '店' } })!;
        expect(next.records.map(record => record.id)).toEqual(['old', 'ag-z']);
        expect(next.contacts).toBe(phone.contacts);
    });
});
describe('applyLifeEpisode · 给阿萌买东西', () => {
    it('记进 TA 自己的淘宝 / 外卖，写明是送给谁的、是不是惊喜', () => {
        const next = applyLifeEpisode(undefined, {
            messageId: 'hb:7:life', createdAt: AT,
            life: { kind: 'gift', with: '羊毛围巾', via: 'net', detail: '灰色的，她怕冷', value: '¥129', surprise: true },
        }, { userName: '阿萌' })!;
        expect(next.records[0]).toMatchObject({
            id: 'ag-hb:7:life', type: 'order', title: '羊毛围巾', value: '¥129', agentSourceIds: ['hb:7:life'],
            detail: '灰色的，她怕冷 · 送给阿萌的惊喜，还没告诉阿萌',
        });
    });

    it('点外卖送过去记在外卖里；重复送达不重复记', () => {
        const event: LifeEvent = { messageId: 'hb:8:life', createdAt: AT, life: { kind: 'gift', with: '老乡鸡', via: 'food' } };
        const once = applyLifeEpisode(undefined, event, { userName: '阿萌' })!;
        expect(once.records[0]).toMatchObject({ type: 'delivery', detail: '送给阿萌' });
        expect(applyLifeEpisode(once, event, { userName: '阿萌' })).toBeNull();
    });
});
describe('applyLifeEpisode · 朋友圈带亲友评论', () => {
    it('评论、赞数、屏蔽分组挂在记录的 moment 上', () => {
        const next = applyLifeEpisode(undefined, {
            messageId: 'hb:5:life', createdAt: AT,
            life: { kind: 'moment', detail: '下雨了', comments: [{ who: '老周', relation: '发小', text: '带伞没' }], likes: 9, hide: ['work'] },
        })!;
        expect(next.records[0]).toMatchObject({ type: 'social', detail: '下雨了', moment: { comments: [{ who: '老周', relation: '发小', text: '带伞没' }], likes: 9, hide: ['work'] } });
    });
});
// [EM-END: agent-life]
