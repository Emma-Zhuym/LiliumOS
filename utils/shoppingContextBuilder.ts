/**
 * shoppingContextBuilder.ts — 购物感知注入
 *
 * 外卖（food）：ETA 精确到分钟，到时间自动标 done
 * 快递（net）：ETA 只有日期，到日期提醒但不自动标 done，等用户手动确认收货
 */

import { ShoppingDB, type ShopOrder } from './shoppingDb';
import { sweepFoodDeliveries } from './shoppingDeliverySweep';
import { buildFamilyShoppingContext, FAMILY_LINKS_KEY, isHiddenFromChar, normalizeFamilyLinks, orderItemsText } from './shoppingFamily'; // [EM: shopping-family]

function isEtaDateReached(etaTimestamp: number): boolean {
  const eta = new Date(etaTimestamp);
  const today = new Date();
  return today.getFullYear() > eta.getFullYear()
    || (today.getFullYear() === eta.getFullYear() && today.getMonth() > eta.getMonth())
    || (today.getFullYear() === eta.getFullYear() && today.getMonth() === eta.getMonth() && today.getDate() >= eta.getDate());
}

export async function buildShoppingDeliveryContext(charId: string): Promise<string | null> {
  try {
    // 外卖到点自动收货+发卡片（先于读订单，保证下面读到的状态是最新的）
    await sweepFoodDeliveries();
    const [orders, products] = await Promise.all([ShoppingDB.getOrders(), ShoppingDB.getProducts()]);
    const now = Date.now();

    const parts: string[] = [];
    const justDelivered: string[] = [];
    const netArrived: string[] = [];
    const inTransit: string[] = [];
    const justOrdered: string[] = [];
    const giftDelivered: string[] = [];
    const giftInTransit: string[] = [];

    for (const o of orders) {
      if (!o.receiverCharId || o.receiverCharId !== charId) continue;
      if (o.selfOrder) continue; // [EM: shopping-family] 自己给自己买的不是投喂

      const items = orderItemsText(o, products); // [EM: shopping-family] 填单 / 心跳订单不在商品目录里

      if (!items) continue;
      // [EM-START: shopping-family] 惊喜礼物：送到前收礼一方不知道内容，送达那轮正常揭晓
      const hiddenFromChar = isHiddenFromChar(o, now);
      const shownItems = hiddenFromChar ? '一个惊喜包裹，用户没告诉你里面是什么' : items;
      const keepSecret = o.surprise && o.isGiftFromChar ? '。这是惊喜，别提前说漏里面是什么' : '';
      // [EM-END: shopping-family]

      const isGift = !!o.isGiftFromChar;
      const noteClause = o.note ? `，${isGift ? '你的留言' : '用户附言'}：「${o.note}」` : '';

      // 已确认收货但角色还没回应 → 强提醒
      if (o.status === 'done' && o.awaitingReply) {
        if (isGift) {
          giftDelivered.push(`你买的${o.type === 'food' ? '外卖' : '快递'}（${items}）已送达给用户${noteClause}`);
        } else if (o.type === 'food') {
          justDelivered.push(`外卖（${items}）已送达${noteClause}`);
        } else {
          netArrived.push(`快递（${items}）已送达${noteClause}`);
        }
        continue;
      }

      if (o.status !== 'active' || !o.etaTimestamp) continue;

      if (isGift) {
        if (o.etaTimestamp <= now) {
          giftDelivered.push(`你买的${o.type === 'food' ? '外卖' : '快递'}（${items}）刚送到用户手上了${noteClause}`);
          await ShoppingDB.saveOrder({ ...o, status: 'done', awaitingReply: true });
        } else {
          const remainMin = Math.ceil((o.etaTimestamp - now) / 60000);
          if (o.type === 'food') {
            giftInTransit.push(`你给用户点的外卖（${items}）在路上，还有约 ${remainMin} 分钟${keepSecret}`); // [EM: shopping-family]
          } else {
            const d = new Date(o.etaTimestamp);
            giftInTransit.push(`你给用户买的快递（${items}）在路上，预计 ${d.getMonth() + 1}月${d.getDate()}日 到${keepSecret}`); // [EM: shopping-family]
          }
        }
      } else if (o.type === 'food') {
        if (o.etaTimestamp <= now) {
          justDelivered.push(`外卖（${items}）刚刚送到了${noteClause}`);
          await ShoppingDB.saveOrder({ ...o, status: 'done', awaitingReply: true });
        } else {
          const remainMin = Math.ceil((o.etaTimestamp - now) / 60000);
          if (now - o.placedAt < 5 * 60 * 1000) {
            justOrdered.push(`用户刚给你点了外卖（${shownItems}），大概 ${remainMin} 分钟后到${noteClause}`); // [EM: shopping-family]
          } else {
            inTransit.push(`你有一份外卖（${shownItems}）在路上，还有约 ${remainMin} 分钟`); // [EM: shopping-family]
          }
        }
      } else {
        if (isEtaDateReached(o.etaTimestamp)) {
          netArrived.push(`快递（${items}）今天应该到了${noteClause}`); // 到了就揭晓
        } else {
          const d = new Date(o.etaTimestamp);
          const etaStr = `${d.getMonth() + 1}月${d.getDate()}日`;
          if (now - o.placedAt < 5 * 60 * 1000) {
            justOrdered.push(`用户刚给你买了快递（${shownItems}），预计 ${etaStr} 到${noteClause}`); // [EM: shopping-family]
          } else {
            inTransit.push(`你有一个快递（${shownItems}）在路上，预计 ${etaStr} 到`); // [EM: shopping-family]
          }
        }
      }
    }

    if (justDelivered.length > 0) {
      parts.push(`⚠️🍜 外卖已送达：${justDelivered.join('；')}。**你必须在这轮回复中提到你收到了这些具体的食物**，自然地表现出反应——惊喜、感谢、评价味道都行，用你自己的方式，不要生硬复述菜名但要让用户知道你清楚收到了什么。`);
    }
    if (netArrived.length > 0) {
      parts.push(`⚠️📦 快递已送达：${netArrived.join('；')}。**你必须在这轮回复中提到你收到了这些具体的东西**，表现出拆快递的反应——好奇、开心、评价礼物都行，用你自己的方式表达。`);
    }
    if (giftDelivered.length > 0) {
      parts.push(`⚠️🎁 你送的礼物已送达：${giftDelivered.join('；')}。**你必须在这轮回复中跟进你送出的东西**——问用户喜不喜欢、好不好用、合不合适等，用你自己的方式关心。`);
    }
    if (justOrdered.length > 0) {
      parts.push(`🛒 新订单：${justOrdered.join('；')}。可以表现出期待，但不必每句话都提。`);
    }
    if (inTransit.length > 0) {
      parts.push(`🚚 配送中：${inTransit.join('；')}。知道有东西在路上就好，偶尔提一嘴但不用刻意。`);
    }
    if (giftInTransit.length > 0) {
      parts.push(`🎁 你送的礼物配送中：${giftInTransit.join('；')}。你知道自己给用户买了东西在路上，可以偶尔提一嘴期待。`);
    }

    // [EM-START: shopping-family]
    const familyLinks = normalizeFamilyLinks(await ShoppingDB.getSetting(FAMILY_LINKS_KEY));
    const family = buildFamilyShoppingContext(orders, products, charId, familyLinks, now);
    if (family) parts.push(family);
    // [EM-END: shopping-family]

    if (parts.length === 0) return null;

    return `\n\n【购物感知】\n${parts.join('\n')}`;
  } catch {
    return null;
  }
}
