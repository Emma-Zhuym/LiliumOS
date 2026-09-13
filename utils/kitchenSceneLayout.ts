import type { KitchenFood, KitchenLot } from './kitchenDb';

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
  const pageSize = zone === 'freezer' ? 3 : FRIDGE_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(available.length / pageSize));
  const page = Math.max(0, Math.min(Math.floor(requestedPage), pageCount - 1));
  const names = new Map(foods.map(food => [food.id, food.name]));
  const entries = available.slice(page * pageSize, (page + 1) * pageSize).map((lot, index) => {
    const name = names.get(lot.foodId) ?? '未命名食物';
    return {
      lot, name, model: kitchenModelFor(name),
      position: [(index % 3 - 1) * 0.36, zone === 'freezer' ? 1.8525 : [1.3, 0.93, 0.56][Math.floor(index / 3)], 0.12] as [number, number, number],
    };
  });
  return { entries, page, pageCount, total: available.length };
}
