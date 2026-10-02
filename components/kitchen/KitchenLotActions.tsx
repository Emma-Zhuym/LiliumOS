import React, { useState } from 'react';
import { CaretRight, PencilSimple, Trash } from '@phosphor-icons/react';
import { KitchenDB, type KitchenLot, type KitchenFridgePlacement } from '../../utils/kitchenDb';
import { describeLotStock, formatQuantity, makeOperationId, quickAmount, UNIT_LABELS, ZONE_LABELS } from '../../utils/kitchenPresentation';
import { formatPackageAmount, formatPortionInput, parsePortionInput } from '../../utils/kitchenQuantity';
import { fridgePlacementOptions } from '../../utils/kitchenFridgeSpec';

interface Props {
  lot: KitchenLot;
  busy: boolean;
  run: (work: () => Promise<unknown>, message: string, close?: boolean) => Promise<boolean>;
  onError: (message: string) => void;
  onEdit: () => void;
}

export default function KitchenLotActions({ lot, busy, run, onError, onEdit }: Props) {
  const divisible = lot.trackingMode === 'divisible';
  const remainingInput = () => formatPackageAmount(lot.packageSize, lot.openContainerRemaining ?? 1)
    ?? formatPortionInput(lot.openContainerRemaining ?? 1);
  const [mode, setMode] = useState<'remaining' | 'consume'>(divisible ? 'remaining' : 'consume');
  const [value, setValue] = useState(divisible
    ? remainingInput()
    : String(quickAmount(lot)));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const chooseMode = (next: typeof mode) => {
    setMode(next);
    setValue(next === 'consume' ? (divisible ? '' : String(quickAmount(lot)))
      : divisible ? remainingInput() : String(lot.quantity));
  };
  const save = async () => {
    if (divisible) {
      const parsed = parsePortionInput(value, lot.packageSize);
      if (!parsed.ok) { onError(parsed.error); return; }
      if (mode === 'consume' && parsed.value.fraction === 0) { onError('本次用量要大于 0'); return; }
      await run(() => mode === 'remaining'
        ? KitchenDB.setPortionRemaining({ lotId: lot.id, fraction: parsed.value.fraction, operationId: makeOperationId('remaining') })
        : KitchenDB.consumePortion({ lotId: lot.id, fraction: parsed.value.fraction, operationId: makeOperationId('consume') }),
      mode === 'remaining' ? '余量已记好' : '这次用量已记好', true);
    } else {
      if (!value.trim() || !Number.isFinite(Number(value))) { onError('请填写数量'); return; }
      await run(() => mode === 'remaining'
        ? KitchenDB.changeLot({ type: 'ADJUST', lotId: lot.id, quantity: Number(value), operationId: makeOperationId('adjust') })
        : KitchenDB.changeLot({ type: 'CONSUME', lotId: lot.id, amount: Number(value), operationId: makeOperationId('consume') }),
      mode === 'remaining' ? '数量已核对' : `已记下用了 ${formatQuantity(Number(value), lot.unit)}`, true);
    }
  };

  return <div className="kitchen-form">
    <div className="kitchen-detail-summary">
      <p>{describeLotStock(lot)}</p>
      <span>{ZONE_LABELS[lot.storageZone]}{lot.packageSize ? ` · 每${UNIT_LABELS[lot.unit]} ${lot.packageSize}` : ''}</span>
    </div>
    <form className="kitchen-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="kitchen-actions">
        <label className="kitchen-label" htmlFor="kitchen-amount">{mode === 'remaining' ? '现在大约还剩多少？' : '这次用了多少？'}</label>
        <button className="kitchen-text-button" type="button" disabled={busy}
          onClick={() => chooseMode(mode === 'remaining' ? 'consume' : 'remaining')}>
          {mode === 'remaining' ? '改记用量' : '改记剩余'}
        </button>
      </div>
      <input id="kitchen-amount" className="kitchen-field" disabled={busy} value={value}
        aria-label={mode === 'remaining' ? (divisible ? '自定义剩余量' : '核对后的数量') : '本次用量'}
        type={divisible ? 'text' : 'number'} inputMode={divisible ? 'text' : 'decimal'}
        min={mode === 'remaining' ? 0 : 0.001} step="any" placeholder={divisible ? '例如 1/3、20% 或 700 ml' : '填个大概也可以'}
        onChange={event => setValue(event.target.value)} />
      {divisible && <p className="kitchen-note">按当前这一{UNIT_LABELS[lot.unit]}估算，填分数或百分比{lot.packageSize ? '，也可以填实际用量' : ''}。</p>}
      <button type="submit" disabled={busy} className="kitchen-button kitchen-button-primary">
        {mode === 'remaining' ? '保存余量' : '记下用量'}
      </button>
    </form>
    <button type="button" className="kitchen-button" disabled={busy} onClick={() => {
      void run(() => KitchenDB.changeLot({ type: 'FINISH', lotId: lot.id, operationId: makeOperationId('finish'), note: '整条库存已用完，清零' }), '这条库存已清零', true);
    }}>这条库存已用完</button>
    {lot.quantity > 1 && <p className="kitchen-note">“已用完”会清空这条记录的全部 {formatQuantity(lot.quantity, lot.unit)}，记错可以撤销。</p>}
    <details className="kitchen-form-details">
      <summary>收纳与其他操作</summary>
      {(lot.storageZone === 'fridge' || lot.storageZone === 'freezer') && <label className="kitchen-label">摆放位置
        <select className="kitchen-field" aria-label="摆放位置" disabled={busy} value={lot.fridgePlacement ?? 'shelf'}
          onChange={event => { void run(() => KitchenDB.moveLot(lot.id, event.target.value as KitchenFridgePlacement), '摆放位置已保存'); }}>
          {fridgePlacementOptions(lot.storageZone).map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
      </label>}
      <button className="kitchen-row" type="button" onClick={onEdit} disabled={busy}>
        <PencilSimple size={18} /><span>详情与编辑</span><CaretRight size={16} />
      </button>
      <button className="kitchen-row" type="button" disabled={busy} onClick={() => setConfirmDiscard(value => !value)}>
        <Trash size={18} /><span>丢弃{divisible ? '当前一件' : ` ${formatQuantity(quickAmount(lot), lot.unit)}`}</span><CaretRight size={16} />
      </button>
      {confirmDiscard && <div className="kitchen-form">
        <p className="kitchen-note">{divisible ? '只丢弃当前一件包装的余量，其余未开封的保留。' : `丢弃 ${formatQuantity(quickAmount(lot), lot.unit)}，其余保留。`}</p>
        <button type="button" className="kitchen-button" disabled={busy} onClick={() => {
          void run(() => divisible
            ? KitchenDB.discardCurrentContainer({ lotId: lot.id, operationId: makeOperationId('discard') })
            : KitchenDB.changeLot({ type: 'DISCARD', lotId: lot.id, amount: quickAmount(lot), operationId: makeOperationId('discard') }), '已记下丢弃', true);
        }}>确认丢弃</button>
      </div>}
    </details>
  </div>;
}
