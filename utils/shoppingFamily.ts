// [EM-START: shopping-family]
/**
 * 投喂站 × 查手机互通，外加「家属关联」。
 *
 * 四种订单：
 * - 我给 TA 买 —— 投喂站下单，不论关联与否都会出现在 TA 查手机的淘宝 / 外卖里（`shopOrdersAsPhoneRecords`）。
 * - TA 给我买 —— 由 TA 在心跳里自己下单（`giftOrderFromLife`），惊喜不惊喜也是 TA 定的；
 *   TA 手机里那条也由这里实时映射（`shopOrdersAsPhoneRecords`）——查手机就是阿萌在看，
 *   所以没送到的惊喜只显示「一个包裹」，送到了才露出买的是什么。
 * - 我给我买 —— 投喂站新下单方式（`selfOrder: 'user'`），只有家属关联的角色才知道
 *   （`buildFamilyShoppingContext`）。
 * - TA 给 TA 买 —— 心跳里 TA 真实下的网购 / 外卖（查手机里带 `agentSourceIds` 的记录），
 *   只对家属关联的角色映射进投喂站（`charSelfOrders`）。查手机点「刷新」让模型编的记录不算。
 *
 * 两边都是实时映射、不复制数据：删掉查手机里那条，投喂站也跟着没了；取消关联就看不到了。
 * 映射出来的只读，不能在另一边删改。
 */

import type { CharacterProfile, PhoneEvidence } from '../types';
import type { ShopOrder, ShopProduct } from './shoppingDb';

export const FAMILY_LINKS_KEY = 'familyLinks';
/** 查手机里由投喂站映射来的记录用这个前缀，据此隐藏删除按钮。 */
export const SHOP_RECORD_PREFIX = 'shop-';

/** 心跳只说「刚下单」，没有送达时间：外卖按 30 分钟、网购按 3 天算。 */
const CHAR_FOOD_ETA_MS = 30 * 60 * 1000;
const CHAR_NET_ETA_MS = 3 * 24 * 60 * 60 * 1000;
/** 家属能看到的「我给我买」：还在路上的，加上一天内送到的。 */
const FAMILY_RECENT_MS = 24 * 60 * 60 * 1000;

export const normalizeFamilyLinks = (value: unknown): string[] =>
    Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && !!id))] : [];

export const isShopRecord = (record: Pick<PhoneEvidence, 'id'>) => record.id.startsWith(SHOP_RECORD_PREFIX);

const isHeartbeatPurchase = (record: PhoneEvidence) =>
    (record.type === 'order' || record.type === 'delivery') && (record.agentSourceIds?.length ?? 0) > 0;

/** 家属关联角色在心跳里给自己下的单，转成投喂站订单（只读，不入库）。 */
export const charSelfOrders = (
    characters: Pick<CharacterProfile, 'id' | 'name' | 'phoneState'>[],
    linkedIds: string[],
    now = Date.now(),
    /** 心跳里给我买的礼物也记在 TA 手机里，但那是「TA 给我」，不是「TA 给 TA」 */
    giftSourceIds: Iterable<string> = [],
): ShopOrder[] => {
    const linked = new Set(linkedIds);
    const gifts = new Set(giftSourceIds);
    return characters.filter(char => linked.has(char.id)).flatMap(char =>
        (char.phoneState?.records ?? []).filter(isHeartbeatPurchase)
            .filter(record => !record.agentSourceIds?.some(id => gifts.has(id))).map(record => {
            const type = record.type === 'delivery' ? 'food' : 'net';
            const etaTimestamp = record.timestamp + (type === 'food' ? CHAR_FOOD_ETA_MS : CHAR_NET_ETA_MS);
            const detail = record.detail?.trim();
            return {
                id: `hb-${char.id}-${record.id}`,
                type,
                receiver: char.name,
                receiverCharId: char.id,
                status: etaTimestamp <= now ? 'done' : 'active',
                note: '',
                placedAt: record.timestamp,
                etaTimestamp,
                lines: [],
                selfOrder: 'char',
                custom: {
                    title: record.title,
                    ...(detail && detail !== '…' ? { detail } : {}),
                    ...(record.value?.trim() ? { price: record.value.trim() } : {}),
                },
            } satisfies ShopOrder;
        }));
};

const productLines = (order: ShopOrder, products: ShopProduct[]) =>
    order.lines.map(line => ({ line, product: products.find(p => p.id === line.id) }))
        .filter((item): item is { line: ShopOrder['lines'][number]; product: ShopProduct } => !!item.product);

/** 送达卡片要的逐行商品：目录商品按行，填单 / 心跳订单算一行。 */
export const orderCardLines = (order: ShopOrder, products: ShopProduct[]) =>
    order.custom
        ? [{ name: order.custom.title, qty: 1, price: parsePrice(order.custom.price) }]
        : productLines(order, products).map(({ line, product }) => ({ name: product.name, qty: line.qty, price: product.price }));

export const parsePrice = (text?: string) => {
    const n = parseFloat(String(text ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
};

export const formatYuan = (n: number) => '¥' + (Math.round(n * 100) / 100).toString().replace(/\.00$/, '');

/** 心跳里 TA 给我买的东西 → 投喂站订单。外卖 40 分钟到，网购 3 天到。 */
export const giftOrderFromLife = (
    event: { messageId: string; createdAt: string; life: { with?: string; detail?: string; value?: string; via?: 'net' | 'food'; surprise?: boolean; note?: string } },
    char: Pick<CharacterProfile, 'id' | 'name'>,
): ShopOrder | null => {
    const title = event.life.with?.trim();
    if (!title) return null;
    const placedAt = Date.parse(event.createdAt) || Date.now();
    const type = event.life.via === 'food' ? 'food' : 'net';
    const detail = event.life.detail?.trim();
    const price = event.life.value?.trim();
    return {
        id: `hb-gift-${event.messageId}`,
        type,
        receiver: char.name,
        receiverCharId: char.id,
        status: 'active',
        note: event.life.note?.trim() ?? '',
        placedAt,
        etaTimestamp: placedAt + (type === 'food' ? 40 * 60 * 1000 : CHAR_NET_ETA_MS),
        lines: [],
        isGiftFromChar: true,
        agentSourceId: event.messageId,
        ...(event.life.surprise ? { surprise: true } : {}),
        custom: { title, ...(detail ? { detail } : {}), ...(price ? { price } : {}) },
    };
};

export const orderItemsText = (order: ShopOrder, products: ShopProduct[]) =>
    order.custom
        ? order.custom.title
        : productLines(order, products).map(({ line, product }) => `${product.name}×${line.qty}`).join('、');

/** 订单金额文字：目录商品按单价合计，心跳订单原样用它写的价格。 */
export const orderPriceText = (order: ShopOrder, products: ShopProduct[]) => {
    if (order.custom) return order.custom.price ?? '';
    return formatYuan(productLines(order, products).reduce((sum, { line, product }) => sum + product.price * line.qty, 0));
};

/** 惊喜礼物还没送到：收礼的一方看不到里面是什么。 */
const isUnrevealedSurprise = (order: ShopOrder, now: number) =>
    !!order.surprise && order.status === 'active' && !(order.etaTimestamp && order.etaTimestamp <= now);
/** TA 送我的惊喜：送到之前投喂站里不显示内容和价格。 */
export const isHiddenFromUser = (order: ShopOrder, now = Date.now()) => isUnrevealedSurprise(order, now) && !!order.isGiftFromChar;
/** 我送 TA 的惊喜：送到之前 TA 那边（聊天、查手机）不知道是什么。 */
export const isHiddenFromChar = (order: ShopOrder, now = Date.now()) =>
    isUnrevealedSurprise(order, now) && !order.isGiftFromChar && !order.selfOrder;

/** 投喂站里跟 TA 有关的订单（我给 TA、TA 给我），映射成 TA 查手机里淘宝 / 外卖的记录。 */
export const shopOrdersAsPhoneRecords = (
    orders: ShopOrder[],
    products: ShopProduct[],
    charId: string,
    userName: string,
    now = Date.now(),
): PhoneEvidence[] =>
    orders.filter(order => !order.selfOrder && order.receiverCharId === charId).flatMap(order => {
        const items = orderItemsText(order, products);
        if (!items) return [];
        const who = userName || '用户';
        const pending = order.status === 'active' ? '（在路上）' : '';
        // TA 给我买的惊喜：TA 自己当然知道买了什么，但查手机是阿萌在看，没送到就先别露
        if (isHiddenFromUser(order, now)) {
            return [{
                id: `${SHOP_RECORD_PREFIX}${order.id}`,
                type: order.type === 'food' ? 'delivery' : 'order',
                title: '一个包裹',
                detail: `给${who}准备的，送到才揭晓${pending}`,
                timestamp: order.placedAt,
            }];
        }
        if (isHiddenFromChar(order, now)) {
            return [{
                id: `${SHOP_RECORD_PREFIX}${order.id}`,
                type: order.type === 'food' ? 'delivery' : 'order',
                title: '神秘包裹',
                detail: `${who}送的惊喜，送到才能拆${pending}`,
                timestamp: order.placedAt,
            }];
        }
        const shop = order.type === 'food' ? productLines(order, products)[0]?.product.shop : undefined;
        const from = order.isGiftFromChar
            ? `给${who}买的${order.surprise ? '惊喜，没告诉TA' : ''}`
            : `${who}投喂的`;
        const note = order.note?.trim() ? `\n留言：${order.note.trim()}` : '';
        return [{
            id: `${SHOP_RECORD_PREFIX}${order.id}`,
            type: order.type === 'food' ? 'delivery' : 'order',
            title: shop || items,
            detail: `${shop ? items + ' · ' : ''}${from}${pending}${note}`,
            timestamp: order.placedAt,
            value: orderPriceText(order, products),
        }];
    });

/** 家属关联的角色能知道的「用户给自己买的」：还在路上的，和一天内送到的。 */
export const buildFamilyShoppingContext = (
    orders: ShopOrder[],
    products: ShopProduct[],
    charId: string,
    linkedIds: string[],
    now = Date.now(),
): string | null => {
    if (!linkedIds.includes(charId)) return null;
    const lines = orders
        .filter(order => order.selfOrder === 'user')
        // 在路上的，和预计送达后一天之内的；没点「确认收货」的旧网购单不会一直挂着
        .filter(order => now - (order.etaTimestamp ?? order.placedAt) < FAMILY_RECENT_MS)
        .sort((a, b) => a.placedAt - b.placedAt)
        .flatMap(order => {
            const items = orderItemsText(order, products);
            if (!items) return [];
            const kind = order.type === 'food' ? '外卖' : '网购';
            if (order.status === 'done') return [`${kind}（${items}）已经送到了`];
            if (order.etaTimestamp && order.etaTimestamp <= now) return [`${kind}（${items}）应该已经到了`];
            if (order.type === 'food' && order.etaTimestamp) {
                return [`${kind}（${items}）在路上，还有约 ${Math.max(1, Math.ceil((order.etaTimestamp - now) / 60000))} 分钟`];
            }
            if (order.etaTimestamp) {
                const d = new Date(order.etaTimestamp);
                return [`${kind}（${items}）在路上，预计 ${d.getMonth() + 1}月${d.getDate()}日 到`];
            }
            return [`${kind}（${items}）在路上`];
        });
    if (lines.length === 0) return null;
    return `👪 你们的购物账号是家属关联的，你能看到用户最近给自己买的东西：${lines.join('；')}。这是你顺手看到的，不是用户专门告诉你的；可以自然地关心一句（好不好吃、到了没），不用每轮都提。`;
};
// [EM-END: shopping-family]
