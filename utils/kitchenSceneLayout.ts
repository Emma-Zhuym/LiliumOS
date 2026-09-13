import type { KitchenFood, KitchenLot, KitchenFridgePlacement } from './kitchenDb';

export const FRIDGE_PAGE_SIZE = 9;
export type KitchenModelKey = 'egg' | 'carton' | 'meat-raw' | 'bag';

// Display hints only: neither model names nor positions are written to the inventory.
export function kitchenModelFor(name: string): KitchenModelKey {
  if (/鸡蛋|鴨蛋|鸭蛋|鹌鹑蛋|\beggs?\b/i.test(name)) return 'egg';
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
    : (['shelf', 'door-upper', 'door-lower'] as const).map(placement => ({
      placement,
      items: available.filter(lot => (lot.fridgePlacement === 'door-upper' || lot.fridgePlacement === 'door-lower' ? lot.fridgePlacement : 'shelf') === placement),
      capacity: placement === 'shelf' ? FRIDGE_PAGE_SIZE : 2,
    }));
  const pageCount = Math.max(1, ...groups.map(group => Math.ceil(group.items.length / group.capacity)));
  const page = Math.max(0, Math.min(Math.floor(requestedPage), pageCount - 1));
  const names = new Map(foods.map(food => [food.id, food.name]));
  const entries = groups.flatMap(group => group.items.slice(page * group.capacity, (page + 1) * group.capacity).map((lot, index) => {
    const name = names.get(lot.foodId) ?? '未命名食物';
    return {
      lot, name, model: kitchenModelFor(name), placement: group.placement,
      position: (group.placement === 'shelf'
        ? [(index % 3 - 1) * 0.36, zone === 'freezer' ? 1.8525 : [1.3, 0.93, 0.56][Math.floor(index / 3)], 0.12]
        : [0.38 + index * 0.48, group.placement === 'door-upper' ? 0.954 : 0.434, -0.105]) as [number, number, number],
    };
  }));
  return { entries, page, pageCount, total: available.length };
}
