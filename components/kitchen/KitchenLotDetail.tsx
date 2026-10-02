import React, { useEffect, useMemo, useState } from 'react';
import { CaretLeft, Check, Package, Snowflake } from '@phosphor-icons/react';
import { KITCHEN_PAPER as PAPER, KITCHEN_PAPER_VARS } from '../../utils/kitchenPaperTokens';
import './kitchenPaper.css';
import {
  hasKitchenEventChange,
  type KitchenEvent,
  type KitchenFood,
  type KitchenLot,
  type KitchenStorageZone,
  type KitchenUnit,
  type UpdateKitchenLotDetailsInput,
} from '../../utils/kitchenDb';
import { formatPackageAmount, formatPortionFraction } from '../../utils/kitchenQuantity';

const EVENT_LABELS: Record<KitchenEvent['type'], string> = {
  ADD: '放进厨房',
  CONSUME: '吃掉',
  DISCARD: '丢弃',
  ADJUST: '核对库存',
  UNDO: '撤销操作',
};

const formatQuantity = (quantity: number, unit: KitchenUnit, unitLabels: Record<KitchenUnit, string>): string =>
  `${Number.isInteger(quantity) ? quantity : Number(quantity.toFixed(2))} ${unitLabels[unit]}`;

const formatEventAmount = (event: KitchenEvent, unitLabels: Record<KitchenUnit, string>): string => {
  const delta = event.contentDelta ?? event.quantityDelta;
  const prefix = delta > 0 ? '+' : '';
  const absolute = Math.abs(delta);
  if (absolute > 0 && absolute < 1) {
    return `${prefix}${delta < 0 ? '-' : ''}${formatPortionFraction(absolute)} ${unitLabels[event.unit]}`;
  }
  return `${prefix}${formatQuantity(delta, event.unit, unitLabels)}`;
};

const formatEventTime = (occurredAt: number): string => new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(occurredAt);

const Field: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = props => (
  <input {...props} className="kitchen-field" />
);

const SelectField: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = props => (
  <select {...props} className="kitchen-field" />
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="kitchen-label">
    {children}
  </span>
);

interface KitchenLotDetailProps {
  lot: KitchenLot;
  food: KitchenFood;
  events: KitchenEvent[];
  siblingLotCount: number;
  busy: boolean;
  notice: string | null;
  unitLabels: Record<KitchenUnit, string>;
  zoneLabels: Record<KitchenStorageZone, string>;
  editableUnits: KitchenUnit[];
  onBack: () => void;
  onFinish?: () => void;
  onSave: (input: UpdateKitchenLotDetailsInput) => void;
}

const KitchenLotDetail: React.FC<KitchenLotDetailProps> = ({
  lot,
  food,
  events,
  siblingLotCount,
  busy,
  notice,
  unitLabels,
  zoneLabels,
  editableUnits,
  onBack,
  onFinish,
  onSave,
}) => {
  const [name, setName] = useState(food.name);
  const [unit, setUnit] = useState<KitchenUnit>(lot.unit);
  const [packageSize, setPackageSize] = useState(lot.packageSize ?? '');
  const [storageZone, setStorageZone] = useState<KitchenStorageZone>(lot.storageZone);
  const [purchasedAt, setPurchasedAt] = useState(lot.purchasedAt ?? '');
  const [expiresAt, setExpiresAt] = useState(lot.expiresAt ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setName(food.name);
    setUnit(lot.unit);
    setPackageSize(lot.packageSize ?? '');
    setStorageZone(lot.storageZone);
    setPurchasedAt(lot.purchasedAt ?? '');
    setExpiresAt(lot.expiresAt ?? '');
  }, [food.name, lot.expiresAt, lot.id, lot.packageSize, lot.purchasedAt, lot.storageZone, lot.unit]);

  const lotEvents = useMemo(
    () => events.filter(event => event.lotId === lot.id && hasKitchenEventChange(event))
      .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id)),
    [events, lot.id],
  );
  const remaining = lot.openContainerRemaining;
  const stockSummary = lot.trackingMode === 'divisible' && remaining !== undefined
    ? `开封的约剩 ${formatPortionFraction(remaining)} ${unitLabels[lot.unit]}${formatPackageAmount(lot.packageSize, remaining) ? `（约 ${formatPackageAmount(lot.packageSize, remaining)}）` : ''}`
    : `剩 ${formatQuantity(lot.quantity, lot.unit, unitLabels)}`;

  const save = () => {
    if (!name.trim()) {
      setValidationError('请填写食材名称');
      return;
    }
    setValidationError(null);
    onSave({
      lotId: lot.id,
      name,
      unit,
      packageSize,
      storageZone,
      purchasedAt,
      expiresAt,
    });
  };

  return (
    <form
      className="kitchen-paper kitchen-page"
      style={KITCHEN_PAPER_VARS}
      onSubmit={event => { event.preventDefault(); save(); }}
    >
      <header className="kitchen-header">
        <div className="relative flex items-center" style={{ minHeight: 52, padding: '4px 0' }}>
          <button type="button" aria-label="返回食材" onClick={onBack} className="kitchen-icon">
            <CaretLeft size={20} weight="bold" />
          </button>
          <h1 className="kitchen-heading pointer-events-none absolute left-0 right-0 text-center" style={{ fontSize: 17 }}>
            食材小档案
          </h1>
        </div>
      </header>

      <main className="kitchen-content">
        <section className="kitchen-detail-summary" aria-label="食材余量">
          <span className="flex shrink-0 items-center justify-center" style={{ width: 44, height: 44, borderRadius: PAPER.radius.card, background: PAPER.blue, color: PAPER.blueInk }}>
            {lot.storageZone === 'freezer' ? <Snowflake size={22} /> : <Package size={22} />}
          </span>
          <div className="min-w-0">
            <h2 className="kitchen-heading break-words" style={{ fontSize: 21 }}>{food.name}</h2>
            <p style={{ color: PAPER.muted, fontSize: 13, lineHeight: '20px', marginTop: 4 }}>{stockSummary}</p>
          </div>
        </section>

        {notice && (
          <div role="status" className="kitchen-note" style={{ marginTop: 16 }}>{notice}</div>
        )}
        {validationError && (
          <div role="alert" id="kitchen-detail-error" className="kitchen-note" style={{ marginTop: 16, color: PAPER.danger }}>{validationError}</div>
        )}

        <section className="kitchen-detail-section">
          <h2 className="kitchen-heading">基本资料</h2>
          <div className="kitchen-detail-fields">
            <label>
              <Label>食材名称</Label>
              <Field
                aria-label="食材名称"
                aria-invalid={!!validationError}
                aria-describedby={validationError ? 'kitchen-detail-error' : undefined}
                value={name}
                onChange={event => setName(event.target.value)}
              />
            </label>
            <label>
              <Label>收纳单位</Label>
              <SelectField aria-label="收纳单位" value={unit} onChange={event => setUnit(event.target.value as KitchenUnit)}>
                {editableUnits.map(option => <option key={option} value={option}>{unitLabels[option]}</option>)}
              </SelectField>
            </label>
            <label>
              <Label>每件包装规格 · 可不填</Label>
              <Field aria-label="包装规格" value={packageSize} onChange={event => setPackageSize(event.target.value)} placeholder="例如 946 ml、30 fl oz 或 1.1 lb" />
            </label>
            {siblingLotCount > 1 && (
              <p style={{ color: PAPER.muted, fontSize: 12, lineHeight: '19px' }}>
                改名称会同步到另 {siblingLotCount - 1} 条同名批次；包装与位置只改这一条。
              </p>
            )}
          </div>
        </section>

        <section className="kitchen-detail-section">
          <h2 className="kitchen-heading">收纳与日期</h2>
          <div className="kitchen-detail-fields">
            <label>
              <Label>收纳位置</Label>
              <SelectField aria-label="收纳位置" value={storageZone} onChange={event => setStorageZone(event.target.value as KitchenStorageZone)}>
                {(Object.keys(zoneLabels) as KitchenStorageZone[]).map(option => <option key={option} value={option}>{zoneLabels[option]}</option>)}
              </SelectField>
            </label>
            <div className="kitchen-form-row">
              <label>
                <Label>购买日期</Label>
                <Field aria-label="购买日期" type="date" value={purchasedAt} onChange={event => setPurchasedAt(event.target.value)} />
              </label>
              <label>
                <Label>到期日期</Label>
                <Field aria-label="到期日期" type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} />
              </label>
            </div>
          </div>
        </section>

        <section className="kitchen-detail-section">
          <h2 className="kitchen-heading">当前库存</h2>
          <div className="kitchen-note">
            <p style={{ color: PAPER.ink, fontSize: 15, fontWeight: 600 }}>{stockSummary}</p>
            <p style={{ marginTop: 4 }}>余量在食材操作面板中记录；修改这些资料不会改变库存数量。</p>
          </div>
          {onFinish && lot.quantity > 0 && (
            <button type="button" onClick={onFinish} disabled={busy} className="kitchen-text-button" style={{ marginTop: 4 }}>
              这条库存已用完
            </button>
          )}
        </section>

        <details className="kitchen-detail-section" style={{ borderTop: `1px solid ${PAPER.line}`, paddingTop: 16 }}>
          <summary className="kitchen-heading" style={{ fontSize: 15, cursor: 'pointer', minHeight: 44 }}>
            这条库存的记录 <span style={{ color: PAPER.muted, fontFamily: 'sans-serif', fontSize: 12, fontWeight: 400 }}>（{lotEvents.length}）</span>
          </summary>
          {lotEvents.length === 0 ? (
            <p style={{ color: PAPER.muted, fontSize: 13, padding: '8px 0 16px' }}>还没有记录。</p>
          ) : (
            <ol className="kitchen-detail-history">
              {lotEvents.map(event => (
                <li key={event.id} style={{ opacity: event.undoneAt ? 0.6 : 1 }}>
                  <span className="min-w-0 flex-1">
                    <span className="block" style={{ fontSize: 13, lineHeight: '20px', fontWeight: 600 }}>{EVENT_LABELS[event.type]}{event.undoneAt ? '（已撤销）' : ''}</span>
                    <span className="block" style={{ color: PAPER.muted, fontSize: 12, lineHeight: '18px' }}>{formatEventTime(event.occurredAt)}{event.note ? ` · ${event.note}` : ''}</span>
                  </span>
                  <span style={{ color: (event.contentDelta ?? event.quantityDelta) >= 0 ? PAPER.greenInk : PAPER.muted, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                    {formatEventAmount(event, unitLabels)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </details>
      </main>

      <footer className="kitchen-detail-footer">
        <button type="submit" disabled={busy} className="kitchen-button kitchen-button--primary w-full">
          <Check size={18} weight="bold" />
          {busy ? '正在保存…' : '保存修改'}
        </button>
      </footer>
    </form>
  );
};

export default KitchenLotDetail;
