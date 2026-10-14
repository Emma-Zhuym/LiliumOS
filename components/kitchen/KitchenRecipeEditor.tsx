import React, { useEffect, useState } from 'react';
import { Minus, Plus, X } from '@phosphor-icons/react';
import type { KitchenRecipe, KitchenSauce, SaveRecipeInput } from '../../utils/kitchenDb';
import { INGREDIENT_UNITS, niceNumber } from '../../utils/kitchenRecipes';
import KitchenAmountRows, { amountDraft, amountsFromDrafts, type AmountDraft } from './KitchenAmountRows';

/**
 * 写 / 改一道菜：名字、几人份、食材（做菜时扣库存）、挂哪几个酱汁（酱汁库里的，不扣库存）、步骤、备注。
 * 酱汁库里没有的可以当场新写一个（父组件弹酱汁编辑，存好了通过 attachSauceId 挂上来）。
 */
export default function KitchenRecipeEditor({ recipe, sauces, busy, attachSauceId, onSave, onDelete, onNewSauce }: {
  recipe?: KitchenRecipe;
  sauces: KitchenSauce[];
  busy: boolean;
  attachSauceId: string | null;
  onSave: (input: SaveRecipeInput) => void;
  onDelete?: () => void;
  onNewSauce: () => void;
}) {
  const [name, setName] = useState(recipe?.name ?? '');
  const [servings, setServings] = useState(recipe?.servings ?? 2);
  const [rows, setRows] = useState<AmountDraft[]>(() => recipe?.ingredients.length ? recipe.ingredients.map(amountDraft) : [amountDraft(), amountDraft(), amountDraft()]);
  const [attached, setAttached] = useState(recipe?.sauces ?? []);
  const [steps, setSteps] = useState(recipe?.steps ?? '');
  const [note, setNote] = useState(recipe?.note ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (attachSauceId) setAttached(list => list.some(item => item.sauceId === attachSauceId) ? list : [...list, { sauceId: attachSauceId, times: 1 }]);
  }, [attachSauceId]);
  const byId = new Map(sauces.map(sauce => [sauce.id, sauce]));
  const unattached = sauces.filter(sauce => !attached.some(item => item.sauceId === sauce.id)).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  return <form className="kitchen-form" onSubmit={event => {
    event.preventDefault();
    onSave({ id: recipe?.id, name, servings, ingredients: amountsFromDrafts(rows, INGREDIENT_UNITS[0]), sauces: attached, steps, note });
  }}>
    <label className="kitchen-label">菜名
      <input className="kitchen-field" aria-label="菜名" placeholder="例如：番茄炖牛腩" value={name} maxLength={60} required disabled={busy}
        onChange={event => setName(event.target.value)} />
    </label>
    <div className="kitchen-actions">
      <span className="kitchen-label">这份写的是</span>
      <span className="kitchen-stepper">
        <button type="button" className="kitchen-icon" aria-label="少一人份" disabled={busy || servings <= 1} onClick={() => setServings(value => Math.max(1, value - 1))}><Minus size={16} /></button>
        <span>{servings} 人份</span>
        <button type="button" className="kitchen-icon" aria-label="多一人份" disabled={busy || servings >= 20} onClick={() => setServings(value => Math.min(20, value + 1))}><Plus size={16} /></button>
      </span>
    </div>
    <div>
      <p className="kitchen-label">食材 <span className="kitchen-label-hint">做的时候从冰箱里扣；数量空着就是适量</span></p>
      <KitchenAmountRows rows={rows} units={INGREDIENT_UNITS} busy={busy} namePlaceholder="番茄" listId="kitchen-ingredient-units" onChange={setRows} />
    </div>
    <div>
      <p className="kitchen-label">酱汁 <span className="kitchen-label-hint">从酱汁库挂上来，不扣库存</span></p>
      {attached.length > 0 && <ul className="kitchen-sauce-picks">
        {attached.map(item => {
          const sauce = byId.get(item.sauceId);
          return <li key={item.sauceId}>
            <strong>{sauce?.name ?? '已删除的酱汁'}</strong>
            <span className="kitchen-stepper">
              <button type="button" className="kitchen-icon" aria-label="少放半份" disabled={busy || item.times <= 0.5}
                onClick={() => setAttached(list => list.map(other => other === item ? { ...other, times: Math.max(0.5, other.times - 0.5) } : other))}><Minus size={14} /></button>
              <span>{niceNumber(item.times)} 份</span>
              <button type="button" className="kitchen-icon" aria-label="多放半份" disabled={busy || item.times >= 10}
                onClick={() => setAttached(list => list.map(other => other === item ? { ...other, times: Math.min(10, other.times + 0.5) } : other))}><Plus size={14} /></button>
            </span>
            <button type="button" className="kitchen-icon" aria-label={`摘掉${sauce?.name ?? '这个酱汁'}`} disabled={busy}
              onClick={() => setAttached(list => list.filter(other => other !== item))}><X size={16} /></button>
          </li>;
        })}
      </ul>}
      <div className="kitchen-sauce-add">
        {unattached.length > 0 && <select className="kitchen-field" aria-label="从酱汁库挂一个" value="" disabled={busy}
          onChange={event => { const id = event.target.value; if (id) setAttached(list => [...list, { sauceId: id, times: 1 }]); }}>
          <option value="">从酱汁库挂一个…</option>
          {unattached.map(sauce => <option key={sauce.id} value={sauce.id}>{sauce.name}</option>)}
        </select>}
        <button type="button" className="kitchen-text-button" disabled={busy} onClick={onNewSauce}><Plus size={16} />新写一个酱汁</button>
      </div>
    </div>
    <label className="kitchen-label">步骤 · 可不写
      <textarea className="kitchen-field kitchen-textarea" aria-label="步骤" placeholder={'一行一步，比如：\n牛腩焯水\n番茄炒出汁'} value={steps} maxLength={3000} disabled={busy}
        onChange={event => setSteps(event.target.value)} />
    </label>
    <label className="kitchen-label">备注 · 可不写
      <textarea className="kitchen-field kitchen-textarea" aria-label="菜谱备注" placeholder="比如：番茄多放一个更好吃" value={note} maxLength={400} disabled={busy}
        onChange={event => setNote(event.target.value)} />
    </label>
    <button type="submit" className="kitchen-button kitchen-button-primary" disabled={busy || !name.trim()}>{busy ? '正在存…' : '存好这道菜'}</button>
    {onDelete && <>
      <button type="button" className="kitchen-text-button kitchen-button--danger" disabled={busy} onClick={() => setConfirmDelete(value => !value)}>删掉这道菜</button>
      {confirmDelete && <button type="button" className="kitchen-button kitchen-button--danger" disabled={busy} onClick={onDelete}>确认删掉（挂的酱汁还留在酱汁库）</button>}
    </>}
  </form>;
}
