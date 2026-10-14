import type { KitchenUnit, KitchenStorageZone, KitchenLot, KitchenEvent } from './kitchenDb';
import { formatPackageAmount, formatPortionFraction } from './kitchenQuantity';

export const UNIT_LABELS: Record<KitchenUnit, string> = {
  item: '件',
  lb: '磅',
  oz: '盎司',
  piece: '个',
  pack: '包',
  bag: '袋',
  box: '盒',
  tray: '盘',
  can: '罐',
  large_bottle: '大瓶',
  small_bottle: '小瓶',
  portion: '份',
  gram: '克',
  milliliter: '毫升',
};

/** 新东西能选的单位：跟小票一样，数件数或者称重（旧单位只留给旧数据显示） */
export const STORAGE_UNIT_OPTIONS: KitchenUnit[] = ['item', 'lb', 'oz', 'gram', 'milliliter'];

/** 编辑一样东西时的单位选项：旧数据的旧单位留在里面，不然一打开就被改掉 */
export const editableUnitsFor = (current: KitchenUnit): KitchenUnit[] =>
  STORAGE_UNIT_OPTIONS.includes(current) ? STORAGE_UNIT_OPTIONS : [current, ...STORAGE_UNIT_OPTIONS];

export const ZONE_LABELS: Record<KitchenStorageZone, string> = {
  staging: '待收纳',
  fridge: '冷藏',
  freezer: '冷冻',
  pantry: '常温柜',
};

export const EVENT_LABELS: Record<KitchenEvent['type'], string> = {
  ADD: '放进厨房',
  CONSUME: '吃掉',
  DISCARD: '丢弃',
  ADJUST: '核对库存',
  UNDO: '撤销操作',
};

export const makeOperationId = (prefix: string): string => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
};

export const formatQuantity = (quantity: number, unit: KitchenUnit): string =>
  `${Number.isInteger(quantity) ? quantity : Number(quantity.toFixed(2))} ${UNIT_LABELS[unit]}`;

export const describeLotStock = (lot: KitchenLot): string => {
  if (lot.trackingMode !== 'divisible') return `剩 ${formatQuantity(lot.quantity, lot.unit)}`;
  const remaining = lot.openContainerRemaining;
  if (remaining === undefined) return `剩 ${formatQuantity(lot.quantity, lot.unit)} · 未开封`;
  const sealedCount = Math.max(0, lot.quantity - 1);
  const measuredAmount = formatPackageAmount(lot.packageSize, remaining);
  const opened = `开封约剩 ${measuredAmount ?? `${formatPortionFraction(remaining)} ${UNIT_LABELS[lot.unit]}`}`;
  return sealedCount > 0 ? `${opened} · 另有 ${sealedCount} ${UNIT_LABELS[lot.unit]}未开封` : opened;
};

export const formatEventAmount = (event: KitchenEvent): string => {
  const delta = event.contentDelta ?? event.quantityDelta;
  const prefix = delta > 0 ? '+' : '';
  const absolute = Math.abs(delta);
  if (absolute > 0 && absolute < 1) return `${prefix}${delta < 0 ? '-' : ''}${formatPortionFraction(absolute)} ${UNIT_LABELS[event.unit]}`;
  return `${prefix}${formatQuantity(delta, event.unit)}`;
};

export const quickAmount = (lot: KitchenLot): number => {
  const normal = lot.unit === 'gram' || lot.unit === 'milliliter' ? 50 : lot.unit === 'lb' ? 0.5 : lot.unit === 'oz' ? 4 : 1;
  return Math.min(normal, lot.quantity);
};

