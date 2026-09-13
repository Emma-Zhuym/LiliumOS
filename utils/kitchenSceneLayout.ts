import type { KitchenFood, KitchenLot, KitchenFridgePlacement } from './kitchenDb';

export const FRIDGE_PAGE_SIZE = 9;
export type KitchenModelKey = 'egg-carton' | 'carton' | 'meat-raw' | 'bag';
export const eggVisibleCount = (lot: KitchenLot) => lot.unit === 'piece' && lot.trackingMode !== 'divisible'
  ? Math.min(12, Math.max(0, Math.floor(lot.quantity))) : 12;

// Display hints only: neither model names nor positions are written to the inventory.
export function kitchenModelFor(name: string): KitchenModelKey {
  if (/鸡蛋|鴨蛋|鸭蛋|鹌鹑蛋|\beggs?\b/i.test(name)) return 'egg-carton';
  if (/牛奶|酸奶|橙汁|果汁|燕麦奶|豆奶|\b(milk|juice|yogurt)\b/i.test(name)) return 'carton';
  if (/牛肉|猪肉|鸡肉|羊肉|牛排|\b(beef|pork|chicken|steak|meat)\b/i.test(name)) return 'meat-raw';
  return 'bag';
}

export function fridgeLots(lots: KitchenLot[], zone: 'fridge' | 'freezer' = 'fridge'): KitchenLot[] {
  return lots.filter(lot => lot.quantity > 0 && lot.storageZone === zone)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function fridgePage(lots: KitchenLot[], foods: KitchenFood[], requestedPage: number, zone: 'fridge' | 'freezer' = 'fridge') {
  const available = fridgeLots(lots, zone);
  const groups: { placement: KitchenFridgePlacement; items: KitchenLot[]; capacity: number }[] = zone === 'freezer'
    ? [{ placement: 'shelf', items: available, capacity: 3 }]
    : (['shelf', 'door-upper', 'door-middle', 'door-lower'] as const).map(placement => ({
      placement,
      items: available.filter(lot => (lot.fridgePlacement === 'door-upper' || lot.fridgePlacement === 'door-middle' || lot.fridgePlacement === 'door-lower' ? lot.fridgePlacement : 'shelf') === placement),
      capacity: placement === 'shelf' ? FRIDGE_PAGE_SIZE : 2,
    }));
  const names = new Map(foods.map(food => [food.id, food.name]));
  // A carton takes the full width of a shelf row or door bin; never overlap bottles.
  const packed = groups.map(group => {
    const pages: { lot: KitchenLot; index: number; wide: boolean }[][] = [[]];
    let cursor = 0;
    for (const lot of group.items) {
      const wide = kitchenModelFor(names.get(lot.foodId) ?? '') === 'egg-carton';
      const rowWidth = group.placement === 'shelf' ? 3 : 2;
      if (wide && cursor % rowWidth) cursor += rowWidth - cursor % rowWidth;
      const width = wide ? rowWidth : 1;
      if (cursor + width > group.capacity) { pages.push([]); cursor = 0; }
      pages[pages.length - 1].push({ lot, index: cursor, wide });
      cursor += width;
    }
    return { ...group, pages };
  });
  const pageCount = Math.max(1, ...packed.map(group => group.pages.length));
  const page = Math.max(0, Math.min(Math.floor(requestedPage), pageCount - 1));
  const entries = packed.flatMap(group => (group.pages[page] ?? []).map(({ lot, index, wide }) => {
    const name = names.get(lot.foodId) ?? '未命名食物';
    return {
      lot, name, model: kitchenModelFor(name), placement: group.placement,
      position: (group.placement === 'shelf'
        ? [wide ? 0 : (index % 3 - 1) * 0.36, zone === 'freezer' ? 1.8525 : [1.3, 0.93, 0.56][Math.floor(index / 3)], -0.1]
        : [wide ? 0.62 : 0.38 + index * 0.48, group.placement === 'door-upper' ? 1.414 : group.placement === 'door-middle' ? 0.954 : 0.434, -0.18]) as [number, number, number],
    };
  }));
  return { entries, page, pageCount, total: available.length };
}
