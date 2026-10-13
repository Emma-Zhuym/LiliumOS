import { describe, expect, it } from 'vitest';
import type { KitchenEvent, KitchenFood, KitchenLot, KitchenShoppingItem } from './kitchenDb';
import { eggVisibleCount, fridgeLayout, LOOK_SIZE } from './kitchenFridgeLayout';
import { FRIDGE, SHELF_WIDTH } from './kitchenFridgeSpec';
import { heatList, kitchenLookFor, lastedText, shoppingPaper, shoppingSuggestions, latestReceipt, pantryList, produceTint, shoppingTrips, stickyReminders, tapeLabel } from './kitchenAppearance';

const lot = (index: number, extra: Partial<KitchenLot> = {}): KitchenLot => ({
  id: `lot-${index}`, foodId: `food-${index}`, createdAt: index, updatedAt: index,
  quantity: 1, unit: 'pack', packageState: 'sealed', foodState: 'raw', storageZone: 'fridge', ...extra,
});
const food = (index: number, name: string): KitchenFood => ({
  id: `food-${index}`, name, normalizedName: name, defaultUnit: 'pack', createdAt: 0, updatedAt: 0,
});

describe('冰箱里的东西长什么样', () => {
  it('包装食品按名字选容器，剩菜一律进保鲜盒，认不出的冷藏进保鲜盒、冷冻进密封袋', () => {
    const base = { foodState: 'raw', storageZone: 'fridge', unit: 'pack' } as const;
    expect(kitchenLookFor('全脂牛奶', base)).toBe('carton');
    expect(kitchenLookFor('鸡蛋', base)).toBe('eggs');
    expect(kitchenLookFor('番茄酱', base)).toBe('jar');
    expect(kitchenLookFor('气泡水', base)).toBe('bottle');
    expect(kitchenLookFor('西兰花', base)).toBe('produce');
    expect(kitchenLookFor('鸡胸肉', base)).toBe('tray');
    expect(kitchenLookFor('鸡胸肉', { ...base, storageZone: 'freezer' })).toBe('bag');
    expect(kitchenLookFor('番茄炖牛腩', { ...base, foodState: 'leftover' })).toBe('box');
    expect(kitchenLookFor('不知道是啥', base)).toBe('box');
    expect(kitchenLookFor('番茄炖牛腩', base)).toBe('box');   // 菜名里带食材，不是食材
    expect(kitchenLookFor('速冻饺子', { ...base, storageZone: 'freezer' })).toBe('bag');
    expect(kitchenLookFor('不知道是啥', { ...base, storageZone: 'freezer' })).toBe('bag');
  });
  it('蔬果颜色和胶带上的字', () => {
    expect(produceTint('小番茄')).toBe('#c4402f');
    expect(produceTint('石头')).toBeNull();
    expect(tapeLabel('番茄炖牛腩', { createdAt: new Date(2026, 9, 8, 20).getTime() })).toBe('番茄炖牛腩 10/8');
    expect(tapeLabel('饺子', { purchasedAt: '2026-10-03', createdAt: 0 })).toBe('饺子 10/3');
  });
});

describe('冰箱里怎么摆', () => {
  it('二十样东西全部放得下：不丢、不重复、同一层不重叠、不出层板', () => {
    const lots = Array.from({ length: 20 }, (_, i) => lot(i));
    const { entries } = fridgeLayout(lots, []);
    expect(entries).toHaveLength(20);
    expect(new Set(entries.map(entry => entry.lot.id)).size).toBe(20);
    for (const y of FRIDGE.shelves.fridge) {
      const row = entries.filter(entry => entry.position[1] === y).sort((a, b) => a.position[0] - b.position[0]);
      for (let i = 1; i < row.length; i++) {
        const left = row[i - 1], right = row[i];
        expect(left.position[0] + LOOK_SIZE[left.look].w * left.scale / 2).toBeLessThanOrEqual(right.position[0] - LOOK_SIZE[right.look].w * right.scale / 2 + 1e-6);
      }
      for (const entry of row) expect(Math.abs(entry.position[0]) + LOOK_SIZE[entry.look].w * entry.scale / 2).toBeLessThanOrEqual(SHELF_WIDTH / 2 + 1e-6);
    }
  });
  it('不做门架：旧数据里选过门架的也放层板', () => {
    const { entries } = fridgeLayout([lot(0, { fridgePlacement: 'door-middle' }), lot(1, { storageZone: 'freezer', fridgePlacement: 'door-upper' })], []);
    expect(entries.map(entry => entry.spot)).toEqual(['shelf', 'shelf']);
    expect(FRIDGE.shelves.fridge).toContain(entries.find(entry => entry.lot.id === 'lot-0')!.position[1]);
  });
  it('冷藏的散装蔬果进抽屉，冷冻的蔬菜不进', () => {
    const { entries } = fridgeLayout([lot(0), lot(1, { storageZone: 'freezer' })], [food(0, '西兰花'), food(1, '豌豆玉米')]);
    expect(entries.find(entry => entry.lot.id === 'lot-0')!.spot).toBe('crisper');
    expect(entries.find(entry => entry.lot.id === 'lot-1')!.spot).toBe('shelf');
  });
  it('不放进冰箱的、吃完的都不出现；东西不会高过这一层', () => {
    const { entries, total } = fridgeLayout([
      lot(0, { storageZone: 'pantry' }), lot(1, { storageZone: 'staging' }), lot(2, { quantity: 0 }),
      lot(3, { storageZone: 'freezer' }), lot(4),
    ], [food(3, '矿泉水')]);
    expect(total).toBe(2);
    expect(entries.map(entry => entry.lot.id).sort()).toEqual(['lot-3', 'lot-4']);
    const water = entries.find(entry => entry.lot.id === 'lot-3')!;
    expect(LOOK_SIZE[water.look].h * water.scale).toBeLessThanOrEqual(FRIDGE.rowHeight.freezer + 1e-6);
  });
  it('鸡蛋显示个数', () => {
    const egg = lot(0, { unit: 'piece', quantity: 5 });
    expect(eggVisibleCount(egg)).toBe(5);
    expect(eggVisibleCount({ ...egg, quantity: 20 })).toBe(12);
    expect(eggVisibleCount({ ...egg, unit: 'box' })).toBe(12);
  });
});

describe('门上的纸', () => {
  const now = new Date(2026, 9, 10, 12).getTime();
  it('便利贴：过期的最前，再是快到期，再是快用完；最多三条；待收纳不提醒', () => {
    const lots = [
      lot(0, { expiresAt: '2026-10-11' }),
      lot(1, { expiresAt: '2026-10-08' }),
      lot(2, { trackingMode: 'divisible', quantity: 1, openContainerRemaining: 0.2 }),
      lot(3, { unit: 'piece', quantity: 1 }),
      lot(4, { expiresAt: '2026-10-10', storageZone: 'staging' }),
      lot(5, { expiresAt: '2026-11-01' }),
    ];
    const foods = ['酸奶', '豆腐', '牛奶', '鸡蛋', '面包', '黄油'].map((name, i) => food(i, name));
    expect(stickyReminders(lots, foods, [], now).map(line => line.text)).toEqual(['豆腐过期了', '酸奶明天到期', '牛奶快用完了']);
    // 鸡蛋买了一盒十二个、现在剩一个才提醒；没有买入记录（或本来就买一个）不提醒
    const bought = [{ id: 'e3', operationId: 'o3', type: 'ADD' as const, lotId: 'lot-3', foodId: 'food-3', quantityDelta: 12, quantityBefore: 0, quantityAfter: 12, unit: 'piece' as const, occurredAt: 0 }];
    expect(stickyReminders([lots[3]], foods, bought, now).map(line => line.text)).toEqual(['鸡蛋只剩一个']);
    expect(stickyReminders([lots[3]], foods, [], now)).toEqual([]);
  });
  it('小票：最近一次采购放进来的几样，撤销掉的不算', () => {
    const add = (i: number, at: number, extra: Partial<KitchenEvent> = {}): KitchenEvent => ({
      id: `e${i}`, operationId: `o${i}`, type: 'ADD', lotId: `lot-${i}`, foodId: `food-${i}`,
      quantityDelta: 2, quantityBefore: 0, quantityAfter: 2, unit: 'box', occurredAt: at, ...extra,
    });
    const day = new Date(2026, 9, 7, 18).getTime();
    const receipt = latestReceipt([
      add(0, day - 86_400_000), add(1, day), add(2, day + 600_000), add(3, day + 1_200_000, { undoneAt: day + 1_300_000 }),
    ], [food(1, '牛奶'), food(2, '鸡蛋')]);
    expect(receipt!.items.map(item => item.name)).toEqual(['牛奶', '鸡蛋']);
    expect(receipt!.items[0].amount).toBe('+2 盒');
    expect(latestReceipt([], [])).toBeNull();
  });
  it('热一热就能吃：自己做的菜和速冻半成品；冷藏的在前、快到期的最前；冷冻生肉不算', () => {
    const lots = [
      lot(0, { storageZone: 'freezer', createdAt: 5 }),
      lot(1, { storageZone: 'fridge', expiresAt: '2026-10-14' }),
      lot(2, { storageZone: 'fridge', expiresAt: '2026-10-10' }),
      lot(3, { storageZone: 'freezer' }),
      lot(4, { storageZone: 'freezer', createdAt: 1 }),
      lot(5, { storageZone: 'pantry' }),
      lot(6, { storageZone: 'fridge', quantity: 0 }),
      lot(7, { storageZone: 'fridge', foodState: 'leftover', expiresAt: '2026-10-11' }),
    ];
    const foods = ['速冻饺子', '番茄炖牛腩', '咖喱饭', '冷冻牛肉', 'Frozen pizza', '方便面', '剩的炒饭', '一盒剩的'].map((name, i) => food(i, name));
    const list = heatList(lots, foods, now)!;
    expect(list.lines.map(line => `${line.text} ${line.amount}`)).toEqual(['咖喱饭 今天吃', '一盒剩的 明天前', '番茄炖牛腩 冷藏', 'Frozen pizza 冷冻', '速冻饺子 冷冻']);
    expect(list.more).toBe(0);
    expect(heatList([lot(0, { storageZone: 'freezer' })], [food(0, '冷冻牛肉')], now)).toBeNull();
  });
  it('要买清单：没划的在前，划掉的留两天；空着也贴', () => {
    const item = (i: number, extra: Partial<KitchenShoppingItem> = {}): KitchenShoppingItem => ({ id: `s${i}`, name: `东西${i}`, normalizedName: `东西${i}`, createdAt: i, updatedAt: i, ...extra });
    const paper = shoppingPaper([
      item(3), item(1), item(2, { checkedAt: now - 3_600_000 }), item(4, { checkedAt: now - 3 * 86_400_000 }),
      ...Array.from({ length: 6 }, (_, i) => item(10 + i)),
    ], now);
    expect(paper.lines.map(line => line.text)).toEqual(['东西1', '东西3', '东西10', '东西11', '东西12', '东西13']);
    expect(paper.more).toBe(2);
    expect(shoppingPaper([item(1), item(2, { checkedAt: now - 1000 })], now).lines).toEqual([
      { id: 's1', text: '东西1', checked: false }, { id: 's2', text: '东西2', checked: true },
    ]);
    expect(shoppingPaper([], now)).toEqual({ lines: [], more: 0 });
  });
  it('建议加上：快用完的、两周内用完又没再买的；清单上有的、自己做的菜不建议', () => {
    const lots = [
      lot(0, { trackingMode: 'divisible', quantity: 1, openContainerRemaining: 0.1 }),
      lot(1, { quantity: 0, updatedAt: now - 86_400_000 }),
      lot(2, { quantity: 0, updatedAt: now - 30 * 86_400_000 }),
      lot(3, { quantity: 0, updatedAt: now - 1000 }),
      lot(4, { quantity: 0, updatedAt: now - 1000, foodId: 'food-5' }), lot(5),
      lot(6, { quantity: 0, updatedAt: now - 1000 }),
    ];
    const foods = ['牛奶', '酸奶', '黄油', '咖喱饭', '面包', '面包', '鸡蛋'].map((name, i) => food(i, name));
    const listed = [{ id: 'x', name: '鸡蛋', normalizedName: '鸡蛋', createdAt: 0, updatedAt: 0 }];
    expect(shoppingSuggestions(lots, foods, [], listed, now)).toEqual(['牛奶', '酸奶']);
  });
  it('柜子里：只列常温柜里还有的，最近动过的在前，最多六样，多的写还有几样', () => {
    const lots = Array.from({ length: 8 }, (_, i) => lot(i, { storageZone: 'pantry', unit: 'bag', quantity: i + 1, updatedAt: i }));
    lots.push(lot(8, { storageZone: 'fridge' }), lot(9, { storageZone: 'pantry', quantity: 0, updatedAt: 99 }));
    lots.push(lot(10, { storageZone: 'pantry', trackingMode: 'divisible', quantity: 1, openContainerRemaining: 0.5, updatedAt: 50 }));
    const foods = Array.from({ length: 11 }, (_, i) => food(i, `零食${i}`));
    const list = pantryList(lots, foods)!;
    expect(list.lines.map(line => line.text)).toEqual(['零食10', '零食7', '零食6', '零食5', '零食4', '零食3']);
    expect(list.lines[0].amount).toBe('开封');
    expect(list.lines[1].amount).toBe('8 袋');
    expect(list.more).toBe(3);
    expect(pantryList([lot(0)], [])).toBeNull();
  });
});

describe('操作记录：一次采购一张小票', () => {
  const ev = (i: number, type: KitchenEvent['type'], at: number, extra: Partial<KitchenEvent> = {}): KitchenEvent => ({
    id: `e${i}`, operationId: `o${i}`, type, lotId: `lot-${i}`, foodId: `food-${i}`,
    quantityDelta: type === 'ADD' ? 2 : -1, quantityBefore: 0, quantityAfter: 0, unit: 'box', occurredAt: at, ...extra,
  });
  const h = 3_600_000;
  const t0 = new Date(2026, 9, 4, 10).getTime(), t1 = new Date(2026, 9, 11, 17).getTime();
  const foods = ['牛奶', '鸡蛋', '薯片', '番茄炖牛腩', '酸奶', '面包'].map((name, i) => food(i, name));

  it('两小时内放进来的算一次；之后吃掉、做的菜接在后半截；隔一周再买开新的一张', () => {
    const trips = shoppingTrips([
      ev(0, 'ADD', t0), ev(1, 'ADD', t0 + 0.5 * h), ev(2, 'ADD', t0 + 2 * h),         // 同一次（每次都跟上一样不到两小时）
      ev(3, 'ADD', t0 + 30 * h),                                                     // 自己做的菜，不算采购
      ev(4, 'CONSUME', t0 + 50 * h, { lotId: 'lot-1', foodId: 'food-1' }),
      ev(5, 'CONSUME', t0 + 60 * h, { lotId: 'lot-0', foodId: 'food-0', undoneAt: t0 + 61 * h }),
      ev(6, 'UNDO', t0 + 61 * h),
      ev(7, 'ADD', t1, { foodId: 'food-4' }),
    ], foods);
    expect(trips).toHaveLength(2);
    const [latest, first] = trips;
    expect(latest.bought.map(l => l.name)).toEqual(['酸奶']);
    expect(first.bought.map(l => l.name)).toEqual(['牛奶', '鸡蛋', '薯片']);
    expect(first.after.map(l => `${l.verb} ${l.name}`)).toEqual(['做了 番茄炖牛腩', '吃掉 鸡蛋', '吃掉 牛奶']);
    expect(first.after[2].undone).toBe(true);
    expect(first.opening).toBe(false);
    expect(first.no).toMatch(/^[0-9A-F]{6}$/);
    expect(first.no).not.toBe(latest.no);
  });
  it('拍小票放进来的速冻饺子算买的，手动放进来的饺子算做的菜', () => {
    const names = [food(0, '速冻饺子'), food(1, '饺子')];
    const [trip] = shoppingTrips([
      ev(0, 'ADD', t0, { operationId: 'receipt_a' }), ev(1, 'ADD', t0 + 5 * h, { operationId: 'add_b' }),
    ], names);
    expect(trip.bought.map(l => l.name)).toEqual(['速冻饺子']);
    expect(trip.after.map(l => `${l.verb} ${l.name}`)).toEqual(['做了 饺子']);
  });
  it('买回来的已经吃完 / 丢了：小票上那行标出来，门上那张也是', () => {
    const lots = [lot(0, { quantity: 0 }), lot(1, { quantity: 0 }), lot(2, { quantity: 1 })];
    const events = [
      ev(0, 'ADD', t0), ev(1, 'ADD', t0 + h), ev(2, 'ADD', t0 + 1.5 * h),
      ev(3, 'CONSUME', t0 + 20 * h, { lotId: 'lot-0', foodId: 'food-0' }),
      ev(4, 'DISCARD', t0 + 30 * h, { lotId: 'lot-1', foodId: 'food-1' }),
    ];
    const [trip] = shoppingTrips(events, foods, lots);
    expect(trip.bought.map(l => l.gone)).toEqual(['吃完', '丢了', undefined]);
    expect(latestReceipt(events, foods, lots)!.items.map(it => it.gone)).toEqual(['当天吃完', '1 天丢了', undefined]);
    expect([lastedText(0, 13 * 86_400_000), lastedText(0, 20 * 86_400_000), lastedText(0, 95 * 86_400_000)]).toEqual(['13 天', '3 周', '3 个月']);
  });
  it('第一次买东西之前的零碎记在开张那张；撤销掉的买入不单开一张', () => {
    const trips = shoppingTrips([
      ev(0, 'CONSUME', t0), ev(1, 'ADD', t0 + 5 * h, { undoneAt: t0 + 6 * h }), ev(2, 'ADD', t1),
    ], foods);
    expect(trips.map(t => t.opening)).toEqual([false, true]);
    expect(trips[1].after.map(l => l.id)).toEqual(['e0', 'e1']);
    expect(trips[0].bought.map(l => l.id)).toEqual(['e2']);
  });
});
