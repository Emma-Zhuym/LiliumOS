/**
 * 冰箱的尺寸表：场景（KitchenFridgeScene）和库存投影（kitchenFridgeLayout）共用。
 * 单位：1 = 10 厘米；箱体前脸在 z = 0，冰箱底在 y = 0，左右以中线为 0。
 * 上冷冻、下冷藏（2026-09-13 Emma 定）；冷冻约占两扇门总高的三分之一。
 * 不做门内置物架（2026-10-11 Emma 定）：门架上多是酱料黄油这类不常动的东西，为它多一套转镜头不划算；
 * 批次上旧的 fridgePlacement 留着不迁移，画面上一律放层板。
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
} as const;

/** 冷藏 / 冷冻层板能放东西的宽度（内胆左右各让一截） */
export const SHELF_WIDTH = FRIDGE.width - 1.3;
