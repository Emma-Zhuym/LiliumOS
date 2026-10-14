import { describe, expect, it } from 'vitest';
import type { KitchenFood, KitchenLot } from './kitchenDb';
import { checkStock, convertAmount, cookPlan, formatAmount, niceNumber, scaleAmount } from './kitchenRecipes';

const lot = (id: string, foodId: string, extra: Partial<KitchenLot> = {}): KitchenLot => ({
  id, foodId, createdAt: 0, updatedAt: 0, quantity: 1, unit: 'item', packageState: 'sealed', foodState: 'raw', storageZone: 'fridge', ...extra,
});
const food = (id: string, name: string): KitchenFood => ({ id, name, normalizedName: name, defaultUnit: 'item', createdAt: 0, updatedAt: 0 });

describe('菜谱算账', () => {
  it('份数缩放、适量不缩放、数字好读', () => {
    expect(scaleAmount({ name: '番茄', amount: 2, unit: '个' }, 1.5).amount).toBe(3);
    expect(scaleAmount({ name: '盐', amount: null, unit: '适量' }, 3).amount).toBeNull();
    expect([niceNumber(0.333), niceNumber(2.25), niceNumber(12.6)]).toEqual(['0.33', '2.3', '13']);
    expect(formatAmount(null, '适量')).toBe('适量');
    expect(formatAmount(1.5, '大勺')).toBe('1.5 大勺');
  });
  it('单位换算：克磅盎司互换、毫升对毫升、个对按件记的、同名单位；其余换不了', () => {
    expect(convertAmount(1, 'lb', '克')).toBeCloseTo(453.6, 0);
    expect(convertAmount(300, '克', 'lb')).toBeCloseTo(0.661, 2);
    expect(convertAmount(16, '盎司', 'lb')).toBeCloseTo(1, 3);
    expect(convertAmount(200, '毫升', 'milliliter')).toBe(200);
    expect(convertAmount(2, '个', 'item')).toBe(2);
    expect(convertAmount(1, 'box', '盒')).toBe(1);
    expect(convertAmount(2, '片', 'lb')).toBeNull();
  });
  it('冰箱里够不够：够、不够、没有、单位对不上', () => {
    const foods = [food('f1', '番茄'), food('f2', '牛腩'), food('f3', '洋葱'), food('f4', '小葱')];
    const lots = [lot('a', 'f1', { quantity: 1 }), lot('b', 'f2', { quantity: 1.3, unit: 'lb' }), lot('c', 'f4', { quantity: 1, unit: 'bag' })];
    expect(checkStock({ name: '番茄', amount: 2, unit: '个' }, lots, foods)).toMatchObject({ status: 'short', have: 1 });
    expect(checkStock({ name: '牛腩', amount: 500, unit: '克' }, lots, foods).status).toBe('enough');
    expect(checkStock({ name: '洋葱', amount: 1, unit: '个' }, lots, foods).status).toBe('missing');
    expect(checkStock({ name: '葱', amount: 3, unit: '根' }, lots, foods).status).toBe('unknown');
    expect(checkStock({ name: '葱', amount: null, unit: '适量' }, lots, foods).status).toBe('enough');
    expect(checkStock({ name: '盐', amount: null, unit: '适量' }, lots, foods).status).toBe('unknown');
  });
  it('做了扣多少：按份数缩放后换成那批的单位，不超过那批还剩的；适量、换不了的空着', () => {
    const foods = [food('f1', '番茄'), food('f2', '牛腩'), food('f4', '小葱')];
    const lots = [lot('a', 'f1', { quantity: 5 }), lot('b', 'f2', { quantity: 0.5, unit: 'lb' }), lot('c', 'f4', { quantity: 1, unit: 'bag' })];
    const plan = cookPlan([
      { name: '番茄', amount: 2, unit: '个' }, { name: '牛腩', amount: 300, unit: '克' },
      { name: '小葱', amount: 2, unit: '根' }, { name: '盐', amount: null, unit: '适量' },
    ], 2, lots, foods);
    expect(plan.map(line => [line.lot?.id, line.deduct])).toEqual([['a', 4], ['b', 0.5], ['c', null], [undefined, null]]);
  });
});

describe('名字配对', () => {
  it('番茄不算番茄酱；名字一模一样的那批先用', async () => {
    const { shoppingMatches } = await import('./kitchenDb');
    const { matchLots } = await import('./kitchenRecipes');
    expect(shoppingMatches('番茄', '番茄酱')).toBe(false);
    expect(shoppingMatches('番茄酱', '番茄')).toBe(false);
    expect(shoppingMatches('鸡蛋', '鸡蛋面')).toBe(false);
    expect(shoppingMatches('牛肉', '牛肉干')).toBe(false);
    expect(shoppingMatches('牛奶', '有机全脂牛奶')).toBe(true);
    expect(shoppingMatches('番茄', '樱桃番茄')).toBe(true);
    expect(shoppingMatches('牛肉', '牛肉片')).toBe(true);
    const foods = [food('f1', '樱桃番茄'), food('f2', '番茄'), food('f3', '番茄酱')];
    const lots = [lot('a', 'f1', { expiresAt: '2026-10-01' }), lot('b', 'f2', { expiresAt: '2026-12-01' }), lot('c', 'f3')];
    expect(matchLots('番茄', lots, foods).map(item => item.id)).toEqual(['b', 'a']);
    expect(checkStock({ name: '番茄', amount: 5, unit: '个' }, [lot('c', 'f3', { quantity: 9 })], foods).status).toBe('missing');
  });
});
