import React, { useState } from 'react';
import type { KitchenSauce, SaveSauceInput } from '../../utils/kitchenDb';
import { SAUCE_UNITS } from '../../utils/kitchenRecipes';
import KitchenAmountRows, { amountDraft, amountsFromDrafts, type AmountDraft } from './KitchenAmountRows';

/** 写 / 改一个酱汁：名字、几样调料各多少、备注。存进酱汁库，菜谱上挂它 */
export default function KitchenSauceEditor({ sauce, usedBy, busy, onSave, onDelete }: {
  sauce?: KitchenSauce;
  /** 挂着它的菜（删的时候提醒一下） */
  usedBy: string[];
  busy: boolean;
  onSave: (input: SaveSauceInput) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(sauce?.name ?? '');
  const [rows, setRows] = useState<AmountDraft[]>(() => sauce?.parts.length ? sauce.parts.map(amountDraft) : [amountDraft(), amountDraft()]);
  const [note, setNote] = useState(sauce?.note ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  return <form className="kitchen-form" onSubmit={event => {
    event.preventDefault();
    onSave({ id: sauce?.id, name, parts: amountsFromDrafts(rows, SAUCE_UNITS[0]), note });
  }}>
    <label className="kitchen-label">叫什么
      <input className="kitchen-field" aria-label="酱汁名字" placeholder="例如：糖醋汁、万能凉拌汁" value={name} maxLength={40} required disabled={busy}
        onChange={event => setName(event.target.value)} />
    </label>
    <div>
      <p className="kitchen-label">放些什么 <span className="kitchen-label-hint">数量空着就是适量</span></p>
      <KitchenAmountRows rows={rows} units={SAUCE_UNITS} busy={busy} namePlaceholder="生抽" listId="kitchen-sauce-units" onChange={setRows} />
    </div>
    <label className="kitchen-label">备注 · 可不写
      <textarea className="kitchen-field kitchen-textarea" aria-label="酱汁备注" placeholder="比如：先把糖化开再倒醋" value={note} maxLength={400} disabled={busy}
        onChange={event => setNote(event.target.value)} />
    </label>
    <p className="kitchen-note">酱汁只记配比，做菜时不扣库存。</p>
    <button type="submit" className="kitchen-button kitchen-button-primary" disabled={busy || !name.trim()}>{busy ? '正在存…' : '存进酱汁库'}</button>
    {onDelete && <>
      <button type="button" className="kitchen-text-button kitchen-button--danger" disabled={busy} onClick={() => setConfirmDelete(value => !value)}>删掉这个酱汁</button>
      {confirmDelete && <div className="kitchen-form">
        <p className="kitchen-note">{usedBy.length ? `${usedBy.join('、')}上挂着它，删了会从这些菜谱上摘掉（菜谱本身留着）。` : '没有菜谱挂着它。'}</p>
        <button type="button" className="kitchen-button kitchen-button--danger" disabled={busy} onClick={onDelete}>确认删掉</button>
      </div>}
    </>}
  </form>;
}
