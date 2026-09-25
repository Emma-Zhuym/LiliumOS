// [EM-START: shopping-family]
import { describe, expect, it } from 'vitest';

import type { CharacterProfile, PhoneEvidence } from '../types';
import type { ShopOrder, ShopProduct } from './shoppingDb';
import {
    buildFamilyShoppingContext,
    charSelfOrders,
    giftOrderFromLife,
    orderCardLines,
    isHiddenFromChar,
    isHiddenFromUser,
    isShopRecord,
    normalizeFamilyLinks,
    orderPriceText,
    shopOrdersAsPhoneRecords,
} from './shoppingFamily';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const MIN = 60 * 1000;

const products: ShopProduct[] = [
    { id: 'p5', name: '招牌热奶茶', brand: '霸王茶姬', price: 18, note: '', type: 'food', shop: '霸王茶姬', cat: 'drink', fav: false },
    { id: 'p1', name: '小熊玩偶', brand: 'Jellycat', price: 89, note: '', type: 'net', cat: 'toy', fav: false },
];

const record = (overrides: Partial<PhoneEvidence>): PhoneEvidence => ({
    id: 'ag-hb:1:life', type: 'order', title: '机械键盘', detail: '茶轴 · 已发货', timestamp: NOW - 60 * MIN,
    value: '¥399', agentSourceIds: ['hb:1:life'], ...overrides,
});
const char = (id: string, records: PhoneEvidence[]): Pick<CharacterProfile, 'id' | 'name' | 'phoneState'> => ({
    id, name: id === 'c1' ? '沈砚' : '别人', phoneState: { records } as CharacterProfile['phoneState'],
});
const order = (overrides: Partial<ShopOrder>): ShopOrder => ({
    id: 'o1', type: 'food', receiver: '沈砚', receiverCharId: 'c1', status: 'active', note: '',
    placedAt: NOW - 5 * MIN, etaTimestamp: NOW + 15 * MIN, lines: [{ id: 'p5', qty: 2 }], ...overrides,
});

describe('charSelfOrders · TA 给 TA 买', () => {
    it('只映射家属关联角色在心跳里下的单；查手机刷新编出来的不算', () => {
        const chars = [
            char('c1', [
                record({}),
                record({ id: 'gen-1', agentSourceIds: undefined }),
                record({ id: 'ag-hb:2:life', type: 'social', agentSourceIds: ['hb:2:life'] }),
            ]),
            char('c2', [record({ id: 'ag-hb:3:life', agentSourceIds: ['hb:3:life'] })]),
        ];
        const result = charSelfOrders(chars, ['c1'], NOW);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: 'hb-c1-ag-hb:1:life', type: 'net', receiver: '沈砚', receiverCharId: 'c1', selfOrder: 'char', status: 'active',
            custom: { title: '机械键盘', detail: '茶轴 · 已发货', price: '¥399' },
        });
    });

    it('外卖 30 分钟后算送到，网购 3 天后算送到', () => {
        const chars = [char('c1', [
            record({ id: 'a', type: 'delivery', title: '老乡鸡', timestamp: NOW - 31 * MIN }),
            record({ id: 'b', type: 'delivery', title: '老乡鸡', timestamp: NOW - 10 * MIN }),
        ])];
        expect(charSelfOrders(chars, ['c1'], NOW).map(o => [o.type, o.status])).toEqual([['food', 'done'], ['food', 'active']]);
    });

    it('没关联就一条都没有', () => {
        expect(charSelfOrders([char('c1', [record({})])], [], NOW)).toEqual([]);
    });
});

describe('shopOrdersAsPhoneRecords · 投喂站进 TA 的查手机', () => {
    it('我给 TA 点的外卖：店名做标题，带上是谁投喂的和留言', () => {
        const [rec] = shopOrdersAsPhoneRecords([order({ note: '趁热喝' })], products, 'c1', '阿萌');
        expect(rec).toMatchObject({ id: 'shop-o1', type: 'delivery', title: '霸王茶姬', value: '¥36', timestamp: NOW - 5 * MIN });
        expect(rec.detail).toBe('招牌热奶茶×2 · 阿萌投喂的（在路上）\n留言：趁热喝');
        expect(isShopRecord(rec)).toBe(true);
    });

    it('TA 给我买的网购也在 TA 的淘宝里；自己给自己买的、别人的单不进来', () => {
        const result = shopOrdersAsPhoneRecords([
            order({ id: 'gift', type: 'net', lines: [{ id: 'p1', qty: 1 }], isGiftFromChar: true, status: 'done' }),
            order({ id: 'self', selfOrder: 'user', receiverCharId: undefined }),
            order({ id: 'other', receiverCharId: 'c2' }),
        ], products, 'c1', '阿萌');
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ id: 'shop-gift', type: 'order', title: '小熊玩偶×1', detail: '给阿萌买的', value: '¥89' });
    });
});

describe('buildFamilyShoppingContext · 我给我买', () => {
    const mine = order({ id: 'mine', selfOrder: 'user', receiver: '我', receiverCharId: undefined });

    it('关联的角色知道还在路上的', () => {
        const text = buildFamilyShoppingContext([mine], products, 'c1', ['c1'], NOW)!;
        expect(text).toContain('家属关联');
        expect(text).toContain('外卖（招牌热奶茶×2）在路上，还有约 15 分钟');
    });

    it('没关联的角色不知道；给 TA 的投喂也不算在这里', () => {
        expect(buildFamilyShoppingContext([mine], products, 'c1', ['c2'], NOW)).toBeNull();
        expect(buildFamilyShoppingContext([order({})], products, 'c1', ['c1'], NOW)).toBeNull();
    });

    it('送到超过一天的就不再提；没确认收货的网购过了预计时间说「应该到了」', () => {
        const old = order({ id: 'old', selfOrder: 'user', status: 'done', etaTimestamp: NOW - 25 * 60 * MIN });
        const net = order({ id: 'net', selfOrder: 'user', type: 'net', lines: [{ id: 'p1', qty: 1 }], etaTimestamp: NOW - 60 * MIN });
        const text = buildFamilyShoppingContext([old, net], products, 'c1', ['c1'], NOW)!;
        expect(text).not.toContain('招牌热奶茶');
        expect(text).toContain('网购（小熊玩偶×1）应该已经到了');
    });
});

describe('惊喜礼物', () => {
    it('我送 TA 的惊喜：送到前 TA 的查手机只看到神秘包裹，没有价格', () => {
        const [rec] = shopOrdersAsPhoneRecords([order({ surprise: true })], products, 'c1', '阿萌', NOW);
        expect(rec).toMatchObject({ title: '神秘包裹', detail: '阿萌送的惊喜，送到才能拆（在路上）' });
        expect(rec.value).toBeUndefined();
        expect(isHiddenFromChar(order({ surprise: true }), NOW)).toBe(true);
        expect(isHiddenFromUser(order({ surprise: true }), NOW)).toBe(false);
    });

    it('送到了（或过了预计时间）就揭晓', () => {
        const [rec] = shopOrdersAsPhoneRecords([order({ surprise: true, status: 'done' })], products, 'c1', '阿萌', NOW);
        expect(rec.title).toBe('霸王茶姬');
        expect(isHiddenFromChar(order({ surprise: true, etaTimestamp: NOW - MIN }), NOW)).toBe(false);
    });

    it('TA 送我的惊喜：投喂站和 TA 的查手机都不露内容——查手机也是我在翻', () => {
        const gift = order({ surprise: true, isGiftFromChar: true });
        expect(isHiddenFromUser(gift, NOW)).toBe(true);
        expect(isHiddenFromChar(gift, NOW)).toBe(false);
        const [rec] = shopOrdersAsPhoneRecords([gift], products, 'c1', '阿萌', NOW);
        expect(rec).toMatchObject({ title: '一个包裹', detail: '给阿萌准备的，送到才揭晓（在路上）' });
        expect(rec.value).toBeUndefined();
    });

    it('TA 送我的惊喜送到后，查手机里正常显示买了什么', () => {
        const gift = order({ surprise: true, isGiftFromChar: true, etaTimestamp: NOW - MIN });
        const [rec] = shopOrdersAsPhoneRecords([gift], products, 'c1', '阿萌', NOW);
        expect(rec.title).toBe('霸王茶姬');
        expect(rec.detail).toContain('给阿萌买的惊喜');
    });
});

describe('TA 在心跳里给我买', () => {
    const event = { messageId: 'hb:9:life', createdAt: new Date(NOW).toISOString(), life: { with: '奶茶店', via: 'food' as const, detail: '杨枝甘露', value: '¥19', note: '趁热', surprise: true } };

    it('变成「来自 TA」的投喂站订单：外卖 40 分钟到，惊喜由 TA 定', () => {
        const o = giftOrderFromLife(event, { id: 'c1', name: '沈砚' })!;
        expect(o).toMatchObject({
            id: 'hb-gift-hb:9:life', type: 'food', receiver: '沈砚', receiverCharId: 'c1', isGiftFromChar: true, surprise: true,
            note: '趁热', agentSourceId: 'hb:9:life', etaTimestamp: NOW + 40 * MIN, custom: { title: '奶茶店', detail: '杨枝甘露', price: '¥19' },
        });
        expect(isHiddenFromUser(o, NOW)).toBe(true);
        expect(orderCardLines(o, products)).toEqual([{ name: '奶茶店', qty: 1, price: 19 }]);
    });

    it('礼物单实时映射进 TA 的查手机；惊喜没送到只显示一个包裹', () => {
        const gift = giftOrderFromLife(event, { id: 'c1', name: '沈砚' })!;
        const [pending] = shopOrdersAsPhoneRecords([gift], products, 'c1', '阿萌', NOW);
        expect(pending).toMatchObject({ type: 'delivery', title: '一个包裹' });
        expect(pending.detail).not.toContain('杨枝甘露');
        const [arrived] = shopOrdersAsPhoneRecords([gift], products, 'c1', '阿萌', NOW + 41 * MIN);
        expect(arrived.title).toBe('奶茶店');
    });

    it('万一 TA 手机里还留着旧版写下的礼物记录，也不会被当成「TA 给自己买的」', () => {
        const chars = [char('c1', [record({ id: 'ag-hb:9:life', agentSourceIds: ['hb:9:life'] }), record({})])];
        expect(charSelfOrders(chars, ['c1'], NOW, ['hb:9:life']).map(o => o.id)).toEqual(['hb-c1-ag-hb:1:life']);
    });

    it('没写买了什么就不落单', () => {
        expect(giftOrderFromLife({ ...event, life: { via: 'net' } }, { id: 'c1', name: '沈砚' })).toBeNull();
    });
});

describe('小工具', () => {
    it('normalizeFamilyLinks 容忍坏数据并去重', () => {
        expect(normalizeFamilyLinks(['c1', 'c1', 3, '', null])).toEqual(['c1']);
        expect(normalizeFamilyLinks(undefined)).toEqual([]);
    });

    it('orderPriceText：心跳订单用原价格文字', () => {
        expect(orderPriceText(order({ custom: { title: 'x', price: '¥12.5' }, lines: [] }), products)).toBe('¥12.5');
        expect(orderPriceText(order({}), products)).toBe('¥36');
    });
});
// [EM-END: shopping-family]
