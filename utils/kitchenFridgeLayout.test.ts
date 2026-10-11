import { describe, expect, it } from 'vitest';
import type { KitchenEvent, KitchenFood, KitchenLot } from './kitchenDb';
import { eggVisibleCount, fridgeLayout, LOOK_SIZE } from './kitchenFridgeLayout';
import { FRIDGE, SHELF_WIDTH, fridgePlacementOptions } from './kitchenFridgeSpec';
import { kitchenLookFor, latestReceipt, produceTint, stickyReminders, tapeLabel } from './kitchenAppearance';

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
  it('门架保留用户选的那层；冷冻门没有中层时退回层板', () => {
    const { entries } = fridgeLayout([
      lot(0, { fridgePlacement: 'door-middle' }),
      lot(1, { storageZone: 'freezer', fridgePlacement: 'door-middle' }),
      lot(2, { storageZone: 'freezer', fridgePlacement: 'door-upper' }),
    ], []);
    expect(entries.find(entry => entry.lot.id === 'lot-0')).toMatchObject({ spot: 'door-middle', zone: 'fridge' });
    expect(entries.find(entry => entry.lot.id === 'lot-1')).toMatchObject({ spot: 'shelf', zone: 'freezer' });
    expect(entries.find(entry => entry.lot.id === 'lot-2')!.position[1]).toBe(FRIDGE.doorRacks.freezer['door-upper']);
  });
  it('冷藏层板上的散装蔬果进抽屉；放在门架上的蔬果照样在门架', () => {
    const { entries } = fridgeLayout([lot(0), lot(1, { fridgePlacement: 'door-lower' })], [food(0, '西兰花'), food(1, '柠檬')]);
    expect(entries.find(entry => entry.lot.id === 'lot-0')!.spot).toBe('crisper');
    expect(entries.find(entry => entry.lot.id === 'lot-1')!.spot).toBe('door-lower');
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
  it('鸡蛋显示个数、摆放选项', () => {
    const egg = lot(0, { unit: 'piece', quantity: 5 });
    expect(eggVisibleCount(egg)).toBe(5);
    expect(eggVisibleCount({ ...egg, quantity: 20 })).toBe(12);
    expect(eggVisibleCount({ ...egg, unit: 'box' })).toBe(12);
    expect(fridgePlacementOptions('fridge').map(option => option.value)).toEqual(['shelf', 'door-upper', 'door-middle', 'door-lower']);
    expect(fridgePlacementOptions('freezer').map(option => option.value)).toEqual(['shelf', 'door-upper', 'door-lower']);
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
    expect(stickyReminders(lots, foods, now).map(line => line.text)).toEqual(['豆腐过期了', '酸奶明天到期', '牛奶快用完了']);
  });
  it('小票：最近一天放进来的几样，撤销掉的不算', () => {
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
});
