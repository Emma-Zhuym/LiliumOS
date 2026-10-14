/**
 * 菜谱的算账：份数缩放、单位换算、冰箱里够不够、做了扣多少。只读，不写库存。
 *
 * 量是「数字 + 单位」（阿萌 2026-10-14 定），amount 为 null 是「适量」，不缩放、不扣。
 * 单位换算只做靠得住的：克 / 磅 / 盎司互换，毫升对毫升，「个」对按件记的；其余单位得和库存记的一样才算得出。
 */
import type { KitchenAmount, KitchenFood, KitchenLot, KitchenUnit } from './kitchenDb';
import { shoppingMatches } from './kitchenDb';
import { UNIT_LABELS } from './kitchenPresentation';

/** 食材常用单位（做菜的说法，不是小票的说法） */
export const INGREDIENT_UNITS = ['个', '克', '磅', '盎司', '毫升', '片', '根', '瓣', '把', '块', '盒', '袋', '杯'];
/** 酱汁常用单位 */
export const SAUCE_UNITS = ['大勺', '小勺', '克', '毫升', '杯', '个', '瓣', '片'];

/** 好读的数：小于 1 留两位，小于 10 留一位，再大取整；去掉末尾的 0 */
export const niceNumber = (value: number): string => {
  const digits = value < 1 ? 2 : value < 10 ? 1 : 0;
  return String(Number(value.toFixed(digits)));
};
export const formatAmount = (amount: number | null, unit: string): string => amount === null ? '适量' : `${niceNumber(amount)} ${unit}`;
export const scaleAmount = (row: KitchenAmount, factor: number): KitchenAmount => ({ ...row, amount: row.amount === null ? null : row.amount * factor });

/** 每单位多少克 / 多少毫升；「个」和按件记的库存算同一种 */
const GRAMS: Record<string, number> = { 克: 1, 磅: 453.592, 盎司: 28.3495, gram: 1, lb: 453.592, oz: 28.3495 };
const MILLILITERS: Record<string, number> = { 毫升: 1, milliliter: 1 };
const COUNTED = new Set(['个', 'item', 'piece']);

/** 库存单位（KitchenUnit）和菜谱单位（中文）之间换算；换不了就 null */
export const convertAmount = (amount: number, from: string, to: string): number | null => {
  if (from === to) return amount;
  if (GRAMS[from] && GRAMS[to]) return amount * GRAMS[from] / GRAMS[to];
  if (MILLILITERS[from] && MILLILITERS[to]) return amount * MILLILITERS[from] / MILLILITERS[to];
  if (COUNTED.has(from) && COUNTED.has(to)) return amount;
  // 库存记成「盒」「袋」，菜谱也写「盒」「袋」：认中文名
  const label = (unit: string) => UNIT_LABELS[unit as KitchenUnit] ?? unit;
  return label(from) === label(to) ? amount : null;
};

/** 家里能拿来做这一样的批次：名字对得上（「牛奶」对「有机全脂牛奶」），还有的，先过期的先用 */
export const matchLots = (name: string, lots: KitchenLot[], foods: KitchenFood[]): KitchenLot[] => {
  const names = new Map(foods.map(food => [food.id, food.name]));
  return lots
    .filter(lot => lot.quantity > 0 && lot.storageZone !== 'staging' && shoppingMatches(name, names.get(lot.foodId) ?? ''))
    .sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999') || a.createdAt - b.createdAt);
};

export type StockStatus = 'enough' | 'short' | 'missing' | 'unknown';
export interface StockCheck { status: StockStatus; lots: KitchenLot[]; have: number | null }

/** 冰箱里够不够：适量的有就算够、没记着不算缺；单位对不上的只能说「有，但不知道够不够」 */
export const checkStock = (row: KitchenAmount, lots: KitchenLot[], foods: KitchenFood[]): StockCheck => {
  const matched = matchLots(row.name, lots, foods);
  // 适量的多半是盐、油这种不记库存的：家里没记着不算缺
  if (row.amount === null) return { status: matched.length ? 'enough' : 'unknown', lots: matched, have: null };
  if (!matched.length) return { status: 'missing', lots: matched, have: null };
  let have = 0, unknown = false;
  for (const lot of matched) {
    const converted = convertAmount(lot.quantity, lot.unit, row.unit);
    if (converted === null) unknown = true; else have += converted;
  }
  if (have >= row.amount - 1e-6) return { status: 'enough', lots: matched, have };
  return { status: unknown ? 'unknown' : 'short', lots: matched, have: unknown && have === 0 ? null : have };
};

export interface CookLine {
  ingredient: KitchenAmount;
  /** 从哪一批扣（先过期的那批）；家里没有就是 undefined */
  lot?: KitchenLot;
  /** 按那一批的单位扣多少；换算不了就空着让人填 */
  deduct: number | null;
}

/** 做了这道菜：每样食材从哪批扣、扣多少（按份数缩放后）。适量的不预填，酱汁不在这里（不扣） */
export const cookPlan = (ingredients: KitchenAmount[], factor: number, lots: KitchenLot[], foods: KitchenFood[]): CookLine[] =>
  ingredients.map(raw => {
    const ingredient = scaleAmount(raw, factor);
    const lot = matchLots(ingredient.name, lots, foods)[0];
    if (!lot || ingredient.amount === null) return { ingredient, lot, deduct: null };
    const converted = convertAmount(ingredient.amount, ingredient.unit, lot.unit);
    return { ingredient, lot, deduct: converted === null ? null : Math.min(lot.quantity, Number(converted.toFixed(3))) };
  });
