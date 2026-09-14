import type { KitchenFood, KitchenLot } from './kitchenDb';
import { FRIDGE_SHELVES, FRIDGE_DOOR_RACKS, fridgePlacementOptions } from './kitchenFridgeSpec';

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

export function fridgeLayout(lots: KitchenLot[], foods: KitchenFood[], zone: 'fridge' | 'freezer' = 'fridge') {
  const available = fridgeLots(lots, zone);
  const names = new Map(foods.map(food => [food.id, food.name]));
  const placements = fridgePlacementOptions(zone).map(option => option.value);
  const entries = placements.flatMap(placement => {
    const items = available.filter(lot => {
      const saved = placements.includes(lot.fridgePlacement!) ? lot.fridgePlacement : 'shelf';
      return saved === placement;
    });
    const rack = FRIDGE_DOOR_RACKS[zone].find(item => item.placement === placement);
    const heights = rack ? [rack.baseY + 0.014] : FRIDGE_SHELVES[zone];
    const maxHeight = rack?.foodHeight ?? (zone === 'freezer' ? 0.17 : 0.31);
    const rows = heights.map(y => ({ y, width: 0, items: [] as { lot: KitchenLot; name: string; model: KitchenModelKey; width: number }[] }));
    for (const lot of items) {
      const name = names.get(lot.foodId) ?? '未命名食物';
      const model = kitchenModelFor(name);
      const width = model === 'egg-carton' ? 0.88 : 0.32;
      // Balance shelf occupancy; retain the user's chosen door rack.
      const row = rows.reduce((best, next) => next.width < best.width ? next : best);
      row.items.push({ lot, name, model, width });
      row.width += width;
    }
    return rows.flatMap(row => {
      const scale = Math.min(1, (placement === 'shelf' ? 1.08 : 0.9) / (row.width || 1));
      let cursor = -row.width * scale / 2;
      return row.items.map(item => {
        const x = cursor + item.width * scale / 2;
        cursor += item.width * scale;
        return { ...item, placement, scale, maxHeight,
          position: [x + (placement === 'shelf' ? 0 : 0.62), row.y, placement === 'shelf' ? -0.1 : -0.18] as [number, number, number] };
      });
    });
  });
  return { entries, total: available.length };
}
