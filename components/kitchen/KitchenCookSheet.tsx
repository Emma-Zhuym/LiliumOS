import React, { useMemo, useState } from 'react';
import type { KitchenFood, KitchenLot, KitchenRecipe, KitchenStorageZone } from '../../utils/kitchenDb';
import { cookPlan, formatAmount, niceNumber } from '../../utils/kitchenRecipes';
import { formatQuantity, UNIT_LABELS, ZONE_LABELS } from '../../utils/kitchenPresentation';

export interface CookDeduction { lotId: string; amount: number; name: string }
export interface CookResult { deductions: CookDeduction[]; leftover: { quantity: number; zone: KitchenStorageZone } | null }

/**
 * 做了这道菜：先核对再扣（阿萌 2026-10-14 定，不悄悄扣）。
 * 每样食材从先过期的那批扣，数量按份数缩放、换成那批的单位预填，能改、能不扣；家里没有的、适量的、换不了单位的空着。
 * 按分次记的（一瓶牛奶记「还剩 1/3」那种）这里不扣，去它那页记。酱汁不扣。
 * 做出来的可以顺手放进冰箱（记成做好的菜，冷冻门「热一热就能吃」里就有它）。
 */
export default function KitchenCookSheet({ recipe, servings, lots, foods, busy, onCook }: {
  recipe: KitchenRecipe; servings: number; lots: KitchenLot[]; foods: KitchenFood[]; busy: boolean;
  onCook: (result: CookResult) => void;
}) {
  const plan = useMemo(() => cookPlan(recipe.ingredients, servings / recipe.servings, lots, foods), [recipe, servings, lots, foods]);
  const names = useMemo(() => new Map(foods.map(food => [food.id, food.name])), [foods]);
  const [amounts, setAmounts] = useState(() => plan.map(line => line.lot && line.lot.trackingMode !== 'divisible' && line.deduct !== null ? String(line.deduct) : ''));
  const [include, setInclude] = useState(() => plan.map(line => !!line.lot && line.lot.trackingMode !== 'divisible' && line.deduct !== null));
  const [keep, setKeep] = useState(false);
  const [portions, setPortions] = useState(String(servings));
  const [zone, setZone] = useState<KitchenStorageZone>('fridge');

  const deductions = plan.flatMap((line, i) => {
    const amount = Number(amounts[i]);
    if (!include[i] || !line.lot || !(amount > 0)) return [];
    return [{ lotId: line.lot.id, amount: Math.min(amount, line.lot.quantity), name: line.ingredient.name }];
  });

  return <form className="kitchen-form" onSubmit={event => {
    event.preventDefault();
    const quantity = Number(portions);
    onCook({ deductions, leftover: keep && quantity > 0 ? { quantity, zone } : null });
  }}>
    <p className="kitchen-note">按 {servings} 人份算好了从冰箱里扣多少，可以改；不想扣的取消勾。酱汁不扣。</p>
    <ul className="kitchen-cook-lines">
      {plan.map((line, i) => {
        const lot = line.lot, divisible = lot?.trackingMode === 'divisible';
        return <li key={`${line.ingredient.name}-${i}`} className={include[i] ? undefined : 'is-off'}>
          <label className="kitchen-cook-check">
            <input type="checkbox" checked={include[i]} disabled={busy || !lot || divisible} aria-label={`扣${line.ingredient.name}`}
              onChange={event => setInclude(list => list.map((value, j) => j === i ? event.target.checked : value))} />
            <span><strong>{line.ingredient.name}</strong> <small>菜谱 {formatAmount(line.ingredient.amount, line.ingredient.unit)}</small></span>
          </label>
          {!lot ? <p className="kitchen-cook-hint">家里没有，不扣</p>
            : divisible ? <p className="kitchen-cook-hint">{names.get(lot.foodId)} 按分次记，去它那页记用了多少</p>
            : <div className="kitchen-cook-amount">
              <span>从{names.get(lot.foodId)}（{ZONE_LABELS[lot.storageZone]}，剩 {formatQuantity(lot.quantity, lot.unit)}）扣</span>
              <input className="kitchen-field" type="number" inputMode="decimal" min="0" step="any" aria-label={`${line.ingredient.name}扣多少`}
                placeholder="扣多少" value={amounts[i]} disabled={busy || !include[i]}
                onChange={event => {
                  const value = event.target.value;
                  setAmounts(list => list.map((old, j) => j === i ? value : old));
                  if (Number(value) > 0) setInclude(list => list.map((old, j) => j === i ? true : old));
                }} />
              <span>{UNIT_LABELS[lot.unit]}</span>
            </div>}
        </li>;
      })}
    </ul>
    <label className="kitchen-cook-keep">
      <input type="checkbox" checked={keep} disabled={busy} onChange={event => setKeep(event.target.checked)} />
      <span>做出来的放进冰箱，下次热一热</span>
    </label>
    {keep && <div className="kitchen-form-row">
      <label className="kitchen-label">几份
        <input className="kitchen-field" type="number" inputMode="decimal" min="0.5" step="0.5" aria-label="放进冰箱几份" value={portions} disabled={busy}
          onChange={event => setPortions(event.target.value)} />
      </label>
      <label className="kitchen-label">放哪
        <select className="kitchen-field" aria-label="做好的菜放哪" value={zone} disabled={busy} onChange={event => setZone(event.target.value as KitchenStorageZone)}>
          <option value="fridge">冷藏</option>
          <option value="freezer">冷冻</option>
        </select>
      </label>
    </div>}
    <button type="submit" className="kitchen-button kitchen-button-primary" disabled={busy}>
      {busy ? '正在记…' : deductions.length ? `记下来，扣 ${deductions.length} 样` : '记下来（不扣库存）'}
    </button>
    {deductions.length > 0 && <p className="kitchen-note">扣：{deductions.map(item => `${item.name} ${niceNumber(item.amount)}`).join('、')}</p>}
  </form>;
}
