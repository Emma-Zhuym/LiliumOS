/**
 * shoppingDeliverySweep.ts — 外卖到点自动收货
 *
 * 外卖 ETA 精确到分钟：到时间自动把订单标 done + awaitingReply，
 * 并把送达卡片（interaction 消息）发进对应角色聊天，卡片时间戳 = 送达时刻。
 * 快递（net）仍保持手动确认收货（现实里也要签收）。
 *
 * 调用点：
 * - ShoppingApp refresh（打开投喂站时）
 * - shoppingContextBuilder 开头（跟任何角色聊天时）
 * 两处都调，谁先跑到谁负责发卡片；status 翻转在发卡片之前，天然防重复。
 */

import { ShoppingDB } from './shoppingDb';
import { DB } from './db';
import { orderCardLines } from './shoppingFamily'; // [EM: shopping-family]

export async function sweepFoodDeliveries(): Promise<void> {
  try {
    const [orders, products] = await Promise.all([ShoppingDB.getOrders(), ShoppingDB.getProducts()]);
    const now = Date.now();

    for (const o of orders) {
      if (o.type !== 'food' || o.status !== 'active' || !o.etaTimestamp || o.etaTimestamp > now) continue;

      // 先翻状态再发卡片：两个调用点并发时，第二个进来看到 status 已变就跳过
      await ShoppingDB.saveOrder({ ...o, status: 'done', awaitingReply: true });

      if (!o.receiverCharId) continue;

      const orderLines = orderCardLines(o, products); // [EM: shopping-family]
      const items = orderLines.map(l => l.name);
      const total = orderLines.reduce((s, l) => s + l.price * l.qty, 0);
      const kind = o.isGiftFromChar ? 'gift_delivered' : 'delivery_arrived';

      await DB.saveMessage({
        charId: o.receiverCharId,
        role: 'user',
        type: 'interaction',
        content: '📦',
        metadata: {
          kind,
          typeLabel: '外卖',
          items,
          receiver: o.receiver,
          isGiftFromChar: !!o.isGiftFromChar,
          orderLines,
          total,
          orderType: o.type,
          note: o.note,
        },
        timestamp: o.etaTimestamp, // 卡片盖"送达那一刻"的时间，聊天记录时间线正确
      } as any);
    }
  } catch (e) {
    console.error('[ShoppingSweep] 外卖自动收货失败', e);
  }
}
