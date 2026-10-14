import React from 'react';
import { BookOpenText, Plus } from '@phosphor-icons/react';
import type { KitchenFood, KitchenLot, KitchenRecipe, KitchenSauce } from '../../utils/kitchenDb';
import { checkStock, formatAmount } from '../../utils/kitchenRecipes';

export type RecipeTab = 'recipes' | 'sauces';

/**
 * 菜谱本：两张纸页签——菜谱一叠索引卡（写着几人份、缺几样、上次做的日子），酱汁库一叠夹子小卡片。
 * 最近做过的、缺得少的排前面：打开就能看到今天能做什么。
 */
export default function KitchenRecipeBook({ tab, recipes, sauces, lots, foods, onTab, onOpenRecipe, onOpenSauce, onNewRecipe, onNewSauce }: {
  tab: RecipeTab; recipes: KitchenRecipe[]; sauces: KitchenSauce[]; lots: KitchenLot[]; foods: KitchenFood[];
  onTab: (tab: RecipeTab) => void;
  onOpenRecipe: (id: string) => void; onOpenSauce: (id: string) => void;
  onNewRecipe: () => void; onNewSauce: () => void;
}) {
  const sauceById = new Map(sauces.map(sauce => [sauce.id, sauce]));
  const cards = recipes.map(recipe => ({
    recipe,
    missing: recipe.ingredients.filter(row => { const status = checkStock(row, lots, foods).status; return status === 'missing' || status === 'short'; }).length,
  })).sort((a, b) => a.missing - b.missing || (b.recipe.lastCookedAt ?? 0) - (a.recipe.lastCookedAt ?? 0) || a.recipe.name.localeCompare(b.recipe.name, 'zh-CN'));
  const usedBy = (id: string) => recipes.filter(recipe => recipe.sauces.some(item => item.sauceId === id)).map(recipe => recipe.name);

  return <>
    <div className="kitchen-tabs" role="tablist" aria-label="菜谱本">
      <button type="button" role="tab" aria-selected={tab === 'recipes'} onClick={() => onTab('recipes')}>菜谱 · {recipes.length}</button>
      <button type="button" role="tab" aria-selected={tab === 'sauces'} onClick={() => onTab('sauces')}>酱汁库 · {sauces.length}</button>
    </div>
    {tab === 'recipes' ? <>
      {cards.length === 0 ? <div className="kitchen-empty"><BookOpenText size={24} /><p>还没有菜谱。写一道常做的，做的时候就能直接从冰箱里扣食材。</p></div>
        : <ul className="kitchen-recipe-cards">
          {cards.map(({ recipe, missing }) => <li key={recipe.id}>
            <button type="button" className="kitchen-recipe-card" onClick={() => onOpenRecipe(recipe.id)}>
              <strong>{recipe.name}</strong>
              <span>{recipe.servings} 人份 · {recipe.ingredients.length} 样食材{recipe.sauces.length ? ` · ${recipe.sauces.map(item => sauceById.get(item.sauceId)?.name).filter(Boolean).join('、')}` : ''}</span>
              <small className={missing ? 'is-missing' : 'is-ready'}>{recipe.ingredients.length === 0 ? '' : missing ? `缺 ${missing} 样` : '家里都有'}</small>
              {recipe.lastCookedAt && <small>上次做 {new Date(recipe.lastCookedAt).getMonth() + 1}/{new Date(recipe.lastCookedAt).getDate()}</small>}
            </button>
          </li>)}
        </ul>}
      <button type="button" className="kitchen-button" onClick={onNewRecipe}><Plus size={18} />写一道菜</button>
    </> : <>
      {sauces.length === 0 ? <div className="kitchen-empty"><p>酱汁库还是空的。调好一个汁存进来，好几道菜都能挂它。</p></div>
        : <ul className="kitchen-sauce-cards">
          {[...sauces].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).map(sauce => {
            const users = usedBy(sauce.id);
            return <li key={sauce.id}>
              <button type="button" className="kitchen-sauce-card" onClick={() => onOpenSauce(sauce.id)}>
                <strong>{sauce.name}</strong>
                <span className="kitchen-sauce-parts">{sauce.parts.map((part, i) => <span key={`${part.name}-${i}`}>{part.name} <em>{formatAmount(part.amount, part.unit)}</em></span>)}</span>
                <small className="kitchen-sauce-note">{users.length ? `用在 ${users.join('、')}` : '还没有菜挂它'}</small>
              </button>
            </li>;
          })}
        </ul>}
      <button type="button" className="kitchen-button" onClick={onNewSauce}><Plus size={18} />调一个酱汁</button>
    </>}
  </>;
}
