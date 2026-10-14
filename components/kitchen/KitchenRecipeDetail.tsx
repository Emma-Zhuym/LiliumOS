import React, { useMemo } from 'react';
import { CookingPot, ListChecks, Minus, PencilSimple, Plus } from '@phosphor-icons/react';
import type { KitchenFood, KitchenLot, KitchenRecipe, KitchenSauce } from '../../utils/kitchenDb';
import { checkStock, formatAmount, niceNumber, scaleAmount, type StockCheck } from '../../utils/kitchenRecipes';
import { formatQuantity } from '../../utils/kitchenPresentation';

const STATUS_TEXT: Record<StockCheck['status'], string> = { enough: '有', short: '不够', missing: '没有', unknown: '有，量对不上' };

/**
 * 一道菜：调份数（数量一起按比例变，适量不变）→ 每样食材旁边写家里有没有、够不够 → 缺的一下加进要买清单。
 * 酱汁是夹在菜谱上的小卡片，份量也跟着变，但不扣库存。最底下「做了这道」弹核对单再扣。
 */
export default function KitchenRecipeDetail({ recipe, sauces, lots, foods, servings, busy, onServings, onEdit, onCook, onShopMissing, onOpenSauce }: {
  recipe: KitchenRecipe; sauces: KitchenSauce[]; lots: KitchenLot[]; foods: KitchenFood[];
  /** 现在按几人份看（不写回菜谱） */
  servings: number;
  busy: boolean;
  onServings: (value: number) => void;
  onEdit: () => void;
  onCook: () => void;
  onShopMissing: (names: string[]) => void;
  onOpenSauce: (id: string) => void;
}) {
  const factor = servings / recipe.servings;
  const rows = useMemo(() => recipe.ingredients.map(raw => {
    const row = scaleAmount(raw, factor);
    return { row, stock: checkStock(row, lots, foods) };
  }), [recipe, factor, lots, foods]);
  const missing = rows.filter(({ stock }) => stock.status === 'missing' || stock.status === 'short').map(({ row }) => row.name);
  const byId = new Map(sauces.map(sauce => [sauce.id, sauce]));
  const lastCooked = recipe.lastCookedAt ? new Date(recipe.lastCookedAt) : null;

  return <div className="kitchen-recipe">
    <header className="kitchen-recipe-head">
      <h2>{recipe.name}</h2>
      <p>{recipe.cookedCount ? `做过 ${recipe.cookedCount} 次 · 上次 ${lastCooked!.getMonth() + 1}/${lastCooked!.getDate()}` : '还没做过'}</p>
      <span className="kitchen-stepper" aria-label="按几人份看">
        <button type="button" className="kitchen-icon" aria-label="少一人份" disabled={servings <= 1} onClick={() => onServings(servings - 1)}><Minus size={16} /></button>
        <span>{servings} 人份</span>
        <button type="button" className="kitchen-icon" aria-label="多一人份" disabled={servings >= 20} onClick={() => onServings(servings + 1)}><Plus size={16} /></button>
      </span>
      {servings !== recipe.servings && <small>菜谱写的是 {recipe.servings} 人份，数量按比例算好了</small>}
    </header>

    {rows.length > 0 && <section className="kitchen-recipe-section">
      <h3>食材</h3>
      <ul className="kitchen-recipe-lines">
        {rows.map(({ row, stock }, i) => <li key={`${row.name}-${i}`} className={`is-${stock.status}`}>
          <span>{row.name}</span>
          <span className="kitchen-recipe-amount">{formatAmount(row.amount, row.unit)}</span>
          <span className="kitchen-recipe-stock">
            {stock.status === 'unknown' && !stock.lots.length ? '没记在库存里' : STATUS_TEXT[stock.status]}
            {stock.status === 'short' && stock.have !== null ? `（家里 ${niceNumber(stock.have)} ${row.unit}）` : ''}
            {stock.status === 'unknown' && stock.lots[0] ? `（家里 ${formatQuantity(stock.lots[0].quantity, stock.lots[0].unit)}）` : ''}
          </span>
        </li>)}
      </ul>
      {missing.length > 0 && <button type="button" className="kitchen-text-button" disabled={busy} onClick={() => onShopMissing(missing)}>
        <ListChecks size={18} />缺的 {missing.length} 样加进要买清单
      </button>}
    </section>}

    {recipe.sauces.length > 0 && <section className="kitchen-recipe-section">
      <h3>酱汁 <small>不扣库存</small></h3>
      {recipe.sauces.map(item => {
        const sauce = byId.get(item.sauceId);
        if (!sauce) return null;
        const times = item.times * factor;
        return <button type="button" key={item.sauceId} className="kitchen-sauce-card" onClick={() => onOpenSauce(sauce.id)} aria-label={`看看${sauce.name}`}>
          <strong>{sauce.name}{times !== 1 ? <small> × {niceNumber(times)}</small> : null}</strong>
          <span className="kitchen-sauce-parts">
            {sauce.parts.map((part, i) => <span key={`${part.name}-${i}`}>{part.name} <em>{formatAmount(part.amount === null ? null : part.amount * times, part.unit)}</em></span>)}
          </span>
          {sauce.note && <small className="kitchen-sauce-note">{sauce.note}</small>}
        </button>;
      })}
    </section>}

    {recipe.steps && <section className="kitchen-recipe-section">
      <h3>步骤</h3>
      <ol className="kitchen-recipe-steps">{recipe.steps.split('\n').map(step => step.trim()).filter(Boolean).map((step, i) => <li key={i}>{step}</li>)}</ol>
    </section>}
    {recipe.note && <p className="kitchen-recipe-note">{recipe.note}</p>}

    <div className="kitchen-recipe-actions">
      <button type="button" className="kitchen-button" disabled={busy} onClick={onEdit}><PencilSimple size={18} />改菜谱</button>
      <button type="button" className="kitchen-button kitchen-button-primary" disabled={busy} onClick={onCook}><CookingPot size={18} />做了这道</button>
    </div>
  </div>;
}
