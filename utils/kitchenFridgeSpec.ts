import type { KitchenFridgePlacement } from './kitchenDb';

/**
 * 冰箱的尺寸表：场景（KitchenFridgeScene）和库存投影（kitchenFridgeLayout）共用。
 * 单位：1 = 10 厘米；箱体前脸在 z = 0，冰箱底在 y = 0，左右以中线为 0。
 * 上冷冻、下冷藏（2026-09-13 Emma 定）；冷冻约占两扇门总高的三分之一。
 */
export const FRIDGE = {
  width: 7,
  depth: 6.4,
  height: 17.2,
  wall: 0.5,
  doorThickness: 0.62,
  fridgeDoor: { y0: 0.5, y1: 11.45 },
  freezerDoor: { y0: 11.6, y1: 17.0 },
  /** 层板上沿（东西放在这上面）。冷藏最底下一层是果蔬抽屉的盖板。 */
  shelves: { fridge: [3.45, 6.05, 8.65], freezer: [12.05, 14.35] },
  /** 每层最多放多高的东西：到上一层板还得留点空 */
  rowHeight: { fridge: 2.3, freezer: 2.0 },
  crisper: { y0: 1.05, y1: 3.3 },
  /** 门内置物架：架底的高度（世界坐标 y）。冷冻门只有上下两层。 */
  doorRacks: {
    fridge: { 'door-upper': 9.15, 'door-middle': 6.45, 'door-lower': 3.75 },
    freezer: { 'door-upper': 14.6, 'door-lower': 12.35 },
  } as Record<'fridge' | 'freezer', Partial<Record<KitchenFridgePlacement, number>>>,
} as const;

/** 冷藏 / 冷冻层板能放东西的宽度（内胆左右各让一截） */
export const SHELF_WIDTH = FRIDGE.width - 1.3;
/** 门内置物架的宽度和进深：浅浅一条 */
export const RACK_WIDTH = FRIDGE.width - 1.6;
export const RACK_DEPTH = 0.95;

export function fridgePlacementOptions(zone: 'fridge' | 'freezer') {
  const labels: Record<string, string> = { 'door-upper': '门内上层', 'door-middle': '门内中层', 'door-lower': '门内下层' };
  return [
    { value: 'shelf' as KitchenFridgePlacement, label: zone === 'fridge' ? '冷藏层板' : '冷冻层板' },
    ...Object.keys(FRIDGE.doorRacks[zone]).map(placement => ({ value: placement as KitchenFridgePlacement, label: labels[placement] })),
  ];
}
