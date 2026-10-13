import React, { useMemo, useRef, useState } from 'react';
import { Camera, Receipt } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { AddKitchenLotInput, KitchenStorageZone } from '../../utils/kitchenDb';
import { groupApiPresets } from '../../utils/apiPresetGroups';
import { kitchenReceiptApi, readKitchenReceiptPresetId, saveKitchenReceiptPresetId } from '../../utils/kitchenReceiptApi';
import {
  expiryFrom, KITCHEN_RECEIPT_UNITS, KITCHEN_RECEIPT_ZONES, REVIEW_REASON_LABELS,
  type KitchenReceiptDraft, type KitchenReceiptLineDraft, type KitchenReceiptUnit,
} from '../../utils/kitchenReceiptRecognition';
import { recognizeKitchenReceipt } from '../../utils/kitchenReceiptVision';
import { UNIT_LABELS, ZONE_LABELS } from '../../utils/kitchenPresentation';

interface Props {
  busy: boolean;
  /** 一次放进去；返回 false = 没放成，核对单留着 */
  onAdd: (inputs: AddKitchenLotInput[]) => Promise<boolean>;
  onReviewingChange: (reviewing: boolean) => void;
}

interface Row {
  key: string;
  draft: KitchenReceiptLineDraft;
  include: boolean;
  name: string;
  quantity: string;
  unit: KitchenReceiptUnit;
  zone: KitchenStorageZone;
  expiresAt: string;
}

/** 小票长：长边留到 2000 像素，字才看得清；JPEG 压一下，免得一张图十几兆发出去 */
const shrinkPhoto = async (file: File): Promise<string> => {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('这张图片打不开'));
      img.src = url;
    });
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('这张图片处理不了');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
};

const rowsFrom = (draft: KitchenReceiptDraft): Row[] => draft.items.map((line, index) => ({
  key: `${index}-${line.rawLabel}`,
  draft: line,
  include: line.isFood,
  name: line.name ?? '',
  quantity: line.quantity === null ? '' : String(line.quantity),
  unit: line.unit,
  zone: line.storageZone ?? 'fridge',
  expiresAt: expiryFrom(draft.purchasedAt, line.shelfLifeDays),
}));

const rowReady = (row: Row) => !!row.name.trim() && Number(row.quantity) > 0;

export default function KitchenReceiptScan({ busy, onAdd, onReviewingChange }: Props) {
  const { apiPresets } = useOS();
  const [presetId, setPresetId] = useState(readKitchenReceiptPresetId);
  const [picking, setPicking] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<KitchenReceiptDraft | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [purchasedAt, setPurchasedAt] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const api = useMemo(() => kitchenReceiptApi(apiPresets, presetId), [apiPresets, presetId]);
  const sections = useMemo(() => groupApiPresets(apiPresets), [apiPresets]);

  const reset = () => { setDraft(null); setRows([]); setError(null); onReviewingChange(false); };
  const read = async (file: File) => {
    if (!api) return;
    setReading(true); setError(null);
    try {
      const next = await recognizeKitchenReceipt(await shrinkPhoto(file), api.config);
      setDraft(next); setRows(rowsFrom(next)); setPurchasedAt(next.purchasedAt ?? '');
      onReviewingChange(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '没读出来，换一张清楚点的试试');
    } finally { setReading(false); }
  };
  const update = (key: string, patch: Partial<Row>) => setRows(list => list.map(row => row.key === key ? { ...row, ...patch } : row));

  const chosen = rows.filter(row => row.include);
  const blocked = chosen.some(row => !rowReady(row));

  if (draft) return <section className="kitchen-receipt-review" aria-label="核对小票">
    <header className="kitchen-receipt-review-head">
      <span><strong>{draft.merchant ?? '小票'}</strong><small>勾上的放进厨房；名字、数量、放哪都能改</small></span>
      <label className="kitchen-label">哪天买的
        <input className="kitchen-field" type="date" aria-label="购买日期" value={purchasedAt} disabled={busy}
          onChange={event => {
            const next = event.target.value;
            setPurchasedAt(next);
            setRows(list => list.map(row => ({ ...row, expiresAt: expiryFrom(next || null, row.draft.shelfLifeDays) })));
          }} />
      </label>
    </header>
    {draft.warnings.length > 0 && <p className="kitchen-note">{draft.warnings.join('；')}</p>}
    <ul className="kitchen-receipt-review-list">
      {rows.map(row => <li key={row.key} className={row.include ? undefined : 'is-off'}>
        <label className="kitchen-receipt-review-check">
          <input type="checkbox" checked={row.include} disabled={busy} aria-label={`放进厨房：${row.name || row.draft.rawLabel}`}
            onChange={event => update(row.key, { include: event.target.checked })} />
          <span className="kitchen-receipt-raw">{row.draft.rawLabel}{row.draft.lineTotal !== null ? ` · ${row.draft.lineTotal.toFixed(2)}` : ''}</span>
        </label>
        {row.include && <>
          {row.draft.needsReview && <p className="kitchen-receipt-review-flag">
            {row.draft.reviewReasons.map(reason => REVIEW_REASON_LABELS[reason]).join('、')}
            {row.draft.abbreviationMeaning ? `：${row.draft.abbreviationMeaning}` : ''}
          </p>}
          <input className="kitchen-field" aria-label="食物名称" placeholder="这是什么？" value={row.name} disabled={busy} maxLength={120}
            onChange={event => update(row.key, { name: event.target.value })} />
          {row.draft.alternatives.length > 0 && <div className="kitchen-receipt-alts">
            也可能是 {row.draft.alternatives.map(alt => <button type="button" key={alt.name} className="kitchen-text-button" disabled={busy}
              onClick={() => update(row.key, { name: alt.name })}>{alt.name}</button>)}
          </div>}
          <div className="kitchen-receipt-review-fields">
            <input className="kitchen-field" aria-label="数量" type="number" inputMode="decimal" min="0.001" step="any" placeholder="多少"
              value={row.quantity} disabled={busy} onChange={event => update(row.key, { quantity: event.target.value })} />
            <select className="kitchen-field" aria-label="单位" value={row.unit} disabled={busy}
              onChange={event => update(row.key, { unit: event.target.value as KitchenReceiptUnit })}>
              {KITCHEN_RECEIPT_UNITS.map(unit => <option key={unit} value={unit}>{UNIT_LABELS[unit]}</option>)}
            </select>
            <select className="kitchen-field" aria-label="收纳位置" value={row.zone} disabled={busy}
              onChange={event => update(row.key, { zone: event.target.value as KitchenStorageZone })}>
              {KITCHEN_RECEIPT_ZONES.map(zone => <option key={zone} value={zone}>{ZONE_LABELS[zone]}</option>)}
            </select>
          </div>
          <label className="kitchen-receipt-review-expiry">{row.draft.packageSize ? `规格 ${row.draft.packageSize} · ` : ''}能放到
            <input className="kitchen-field" type="date" aria-label="保质期" value={row.expiresAt} disabled={busy}
              onChange={event => update(row.key, { expiresAt: event.target.value })} />
          </label>
        </>}
      </li>)}
    </ul>
    <div className="kitchen-receipt-review-actions">
      <button type="button" className="kitchen-text-button" disabled={busy} onClick={reset}>不要这张</button>
      <button type="button" className="kitchen-button kitchen-button-primary" disabled={busy || !chosen.length || blocked}
        onClick={() => {
          void onAdd(chosen.map(row => ({
            name: row.name.trim(), quantity: Number(row.quantity), unit: row.unit, storageZone: row.zone, trackingMode: 'count',
            packageSize: row.draft.packageSize ?? undefined, purchasedAt: purchasedAt || undefined, expiresAt: row.expiresAt || undefined,
          }))).then(done => { if (done) reset(); });
        }}>{busy ? '正在放好…' : blocked ? '还有没填完的' : `放进 ${chosen.length} 样`}</button>
    </div>
  </section>;

  return <section className="kitchen-receipt-scan">
    <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void read(file);
    }} />
    <button type="button" className="kitchen-button" disabled={busy || reading || !api} onClick={() => fileInput.current?.click()}>
      {reading ? <Receipt size={18} /> : <Camera size={18} />}{reading ? '正在读小票…' : '拍小票'}
    </button>
    <p className="kitchen-note">
      {api ? <>用 {api.preset.name} 读 · </> : '先选一个能看图的 API · '}
      <button type="button" className="kitchen-text-button" disabled={busy || reading} onClick={() => setPicking(value => !value)}>
        {api ? '换一个' : '去选'}
      </button>
    </p>
    {picking && <label className="kitchen-label">小厨房读小票用的 API
      <select className="kitchen-field" aria-label="读小票用的 API" value={api?.preset.id ?? ''} onChange={event => {
        const id = event.target.value || null;
        setPresetId(id); saveKitchenReceiptPresetId(id); setPicking(false);
      }}>
        <option value="">{apiPresets.length ? '选一个预设' : '设置 → API 里还没有预设'}</option>
        {sections.map(section => section.group
          ? <optgroup key={section.group} label={section.group}>{section.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          : section.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>))}
      </select>
    </label>}
    {error && <p className="kitchen-inline-notice" role="alert">{error}</p>}
  </section>;
}
