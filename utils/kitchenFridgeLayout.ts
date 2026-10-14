/**
 * 冰箱里的东西摆在哪：只读投影，不写库存（位置只存语义上的「层板 / 门内上中下层」）。
 *
 * - 层板：一层放不下就挪到最空的那层；一层太挤就整层等比缩小，绝不丢东西。
 * - 果蔬抽屉：冷藏的散装蔬果自动进抽屉（磨砂，只看见色块）。
 * - 不做门内置物架（2026-10-11）：旧数据里选过门架的，照样放层板。
 * 坐标：冰箱坐标（中线 x = 0，前脸 z = 0）。
 */
import type { KitchenFood, KitchenLot } from './kitchenDb';
import { kitchenLookFor, type KitchenLook } from './kitchenAppearance';
import { FRIDGE, SHELF_WIDTH } from './kitchenFridgeSpec';

/** 每种容器的占地（宽、高、深），场景照这个尺寸画 */
export const LOOK_SIZE: Record<KitchenLook, { w: number; h: number; d: number }> = {
  carton: { w: 1.15, h: 2.3, d: 1.15 },
  eggs: { w: 2.5, h: 0.75, d: 1.0 },
  bottle: { w: 0.85, h: 2.4, d: 0.85 },
  jar: { w: 1.1, h: 1.35, d: 1.1 },
  box: { w: 2.2, h: 0.95, d: 1.6 },
  tray: { w: 2.0, h: 0.55, d: 1.4 },
  bag: { w: 1.8, h: 0.7, d: 1.4 },
  produce: { w: 0.9, h: 0.8, d: 0.9 },
};
const GAP = 0.18;

export type FridgeSpot = 'shelf' | 'crisper';

export interface FridgeEntry {
  lot: KitchenLot;
  name: string;
  look: KitchenLook;
  zone: 'fridge' | 'freezer';
  spot: FridgeSpot;
  /** 摆放中心（底面中心） */
  position: [number, number, number];
  scale: number;
}

const zoneOf = (lot: KitchenLot): 'fridge' | 'freezer' | null =>
  lot.quantity > 0 && (lot.storageZone === 'fridge' || lot.storageZone === 'freezer') ? lot.storageZone : null;

/** 一排东西从左到右摆开；超宽就整排缩小 */
function lineUp(items: { width: number }[], available: number) {
  const total = items.reduce((sum, item) => sum + item.width, 0) + GAP * Math.max(0, items.length - 1);
  const scale = Math.min(1, available / (total || 1));
  let cursor = -total * scale / 2;
  return items.map(item => {
    const x = cursor + item.width * scale / 2;
    cursor += (item.width + GAP) * scale;
    return { x, scale };
  });
}

export function fridgeLayout(lots: KitchenLot[], foods: KitchenFood[]): { entries: FridgeEntry[]; total: number } {
  const names = new Map(foods.map(food => [food.id, food.name]));
  const active = lots.filter(lot => zoneOf(lot))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const entries: FridgeEntry[] = [];

  for (const zone of ['fridge', 'freezer'] as const) {
    const inZone = active.filter(lot => lot.storageZone === zone).map(lot => {
      const name = names.get(lot.foodId) ?? '未命名食物';
      const look = kitchenLookFor(name, lot);
      const spot: FridgeSpot = zone === 'fridge' && look === 'produce' ? 'crisper' : 'shelf';
      return { lot, name, look, spot };
    });

    // 层板：按占地均衡分到各层（冷藏从最下层开始放，跟人往冰箱里塞东西的习惯一样）
    const shelves = FRIDGE.shelves[zone];
    const rows = shelves.map(y => ({ y, width: 0, items: [] as typeof inZone }));
    for (const item of inZone.filter(item => item.spot === 'shelf')) {
      const row = rows.reduce((best, next) => next.width < best.width - 1e-6 ? next : best);
      row.items.push(item);
      row.width += LOOK_SIZE[item.look].w + GAP;
    }
    const maxHeight = FRIDGE.rowHeight[zone];
    for (const row of rows) {
      const placed = lineUp(row.items.map(item => ({ width: LOOK_SIZE[item.look].w })), SHELF_WIDTH);
      row.items.forEach((item, index) => {
        const fit = Math.min(placed[index].scale, maxHeight / LOOK_SIZE[item.look].h);
        entries.push({ ...item, zone, position: [placed[index].x, row.y, -FRIDGE.depth / 2 - 0.2], scale: fit });
      });
    }

    // 果蔬抽屉：一样东西一小堆，左右排开
    const produce = inZone.filter(item => item.spot === 'crisper');
    const placed = lineUp(produce.map(() => ({ width: 1.3 })), SHELF_WIDTH);
    produce.forEach((item, index) => {
      entries.push({ ...item, zone, position: [placed[index].x, FRIDGE.crisper.y0 + 0.1, -FRIDGE.depth / 2 + 0.3], scale: placed[index].scale });
    });
  }
  return { entries, total: active.length };
}

/** 鸡蛋按个记录时最多显示 12 个；按盒记录显示满盒 */
export const eggVisibleCount = (lot: KitchenLot) => lot.unit === 'piece' && lot.trackingMode !== 'divisible'
  ? Math.min(12, Math.max(0, Math.floor(lot.quantity))) : 12;
