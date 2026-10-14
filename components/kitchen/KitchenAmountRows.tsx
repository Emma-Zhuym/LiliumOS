import React from 'react';
import { Plus, X } from '@phosphor-icons/react';
import type { KitchenAmount } from '../../utils/kitchenDb';

/** 编辑时的一行：数量先当字符串存，空着就是「适量」 */
export interface AmountDraft { key: string; name: string; amount: string; unit: string }

let seq = 0;
export const amountDraft = (row?: KitchenAmount): AmountDraft => ({
  key: `row-${++seq}`,
  name: row?.name ?? '',
  amount: row && row.amount !== null ? String(row.amount) : '',
  unit: row && row.amount !== null ? row.unit : '',
});
export const amountsFromDrafts = (rows: AmountDraft[], fallbackUnit: string): KitchenAmount[] => rows.map(row => {
  const amount = row.amount.trim() === '' ? null : Number(row.amount);
  return { name: row.name, amount: amount !== null && Number.isFinite(amount) && amount > 0 ? amount : null, unit: row.unit || fallbackUnit };
});

/**
 * 一行一样：名字、多少、单位。数量空着就是「适量」（不缩放、做菜不扣）。
 * 单位可以从常用的里选，也可以自己写（下拉 + 输入框共用一个 datalist）。
 */
export default function KitchenAmountRows({ rows, units, busy, namePlaceholder, onChange, listId }: {
  rows: AmountDraft[]; units: string[]; busy: boolean; namePlaceholder: string; listId: string;
  onChange: (rows: AmountDraft[]) => void;
}) {
  const update = (key: string, patch: Partial<AmountDraft>) => onChange(rows.map(row => row.key === key ? { ...row, ...patch } : row));
  return <div className="kitchen-amount-rows">
    <datalist id={listId}>{units.map(unit => <option key={unit} value={unit} />)}</datalist>
    {rows.map((row, i) => <div className="kitchen-amount-row" key={row.key}>
      <input className="kitchen-field" aria-label={`第 ${i + 1} 样的名字`} placeholder={namePlaceholder} value={row.name} maxLength={60} disabled={busy}
        onChange={event => update(row.key, { name: event.target.value })} />
      <input className="kitchen-field" aria-label={`第 ${i + 1} 样的数量`} placeholder="适量" type="number" inputMode="decimal" min="0" step="any"
        value={row.amount} disabled={busy} onChange={event => update(row.key, { amount: event.target.value })} />
      <input className="kitchen-field" aria-label={`第 ${i + 1} 样的单位`} placeholder={row.amount.trim() ? units[0] : '—'} list={listId} value={row.unit}
        maxLength={12} disabled={busy || !row.amount.trim()} onChange={event => update(row.key, { unit: event.target.value })} />
      <button type="button" className="kitchen-icon" aria-label={`删掉第 ${i + 1} 样`} disabled={busy}
        onClick={() => onChange(rows.length > 1 ? rows.filter(item => item.key !== row.key) : [amountDraft()])}><X size={16} /></button>
    </div>)}
    <button type="button" className="kitchen-text-button" disabled={busy} onClick={() => onChange([...rows, amountDraft()])}><Plus size={16} />再加一样</button>
  </div>;
}
