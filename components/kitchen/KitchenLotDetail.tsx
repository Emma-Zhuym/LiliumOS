import React, { useEffect, useMemo, useState } from 'react';
import { CaretLeft, Check, Package, Snowflake } from '@phosphor-icons/react';
import { F, HUE, MOTION, R, S, SP } from '../../utils/clayTokens';
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

const KITCHEN = HUE.green;

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
  <input
    {...props}
    className="w-full outline-none"
    style={{
      height: 52,
      padding: `0 ${SP[3]}px`,
      borderRadius: R.input,
      background: F.surfaceSunken,
      color: F.textPrimary,
      boxShadow: S.sunken,
      fontSize: 15,
    }}
  />
);

const SelectField: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = props => (
  <select
    {...props}
    className="w-full outline-none"
    style={{
      height: 52,
      padding: `0 ${SP[3]}px`,
      borderRadius: R.input,
      background: F.surfaceSunken,
      color: F.textPrimary,
      boxShadow: S.sunken,
      fontSize: 15,
    }}
  />
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="block" style={{ marginBottom: SP[1], color: F.textSecondary, fontSize: 13, lineHeight: '18px' }}>
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
    <div className="h-full min-h-0 flex flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
      <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
        <div className="relative flex items-center" style={{ minHeight: 44, padding: `${SP[2]}px ${SP[4]}px` }}>
          <button
            type="button"
            aria-label="返回食材列表"
            onClick={onBack}
            className="flex shrink-0 items-center justify-center active:translate-y-[1px]"
            style={{
              width: 44,
              height: 44,
              borderRadius: R.pill,
              background: F.surfaceRaised,
              border: `1px solid ${F.borderSoft}`,
              boxShadow: S.raisedSoft,
              transition: `transform ${MOTION.tap} ${MOTION.ease}`,
            }}
          >
            <CaretLeft size={20} weight="bold" color={F.textSecondary} />
          </button>
          <span
            className="pointer-events-none absolute left-0 right-0 flex justify-center font-semibold"
            style={{ fontSize: 16, color: F.textPrimary }}
          >
            食材详情
          </span>
        </div>
      </div>

      <main className="flex-1 min-h-0 overflow-y-auto" style={{ padding: `${SP[1]}px ${SP[4]}px calc(var(--safe-bottom) + ${SP[5]}px)` }}>
        <section
          className="flex items-center"
          style={{ gap: SP[2], padding: SP[3], borderRadius: R.bigCard, background: KITCHEN.tint, boxShadow: S.raisedSoft }}
        >
          <span className="flex shrink-0 items-center justify-center" style={{ width: 44, height: 44, borderRadius: R.medium, background: KITCHEN.main, color: F.surfaceRaised }}>
            {lot.storageZone === 'freezer' ? <Snowflake size={22} /> : <Package size={22} />}
          </span>
          <span className="min-w-0">
            <span className="block break-words" style={{ fontSize: 18, lineHeight: '26px', fontWeight: 600 }}>{food.name}</span>
            <span className="block" style={{ color: F.textSecondary, fontSize: 13, lineHeight: '18px' }}>{stockSummary}</span>
          </span>
        </section>

        {notice && (
          <div role="status" style={{ marginTop: SP[3], padding: `${SP[2]}px ${SP[3]}px`, borderRadius: R.medium, background: KITCHEN.tint, color: KITCHEN.ink, fontSize: 13 }}>
            {notice}
          </div>
        )}
        {validationError && (
          <div role="alert" style={{ marginTop: SP[3], padding: `${SP[2]}px ${SP[3]}px`, borderRadius: R.medium, background: F.surfaceSunken, color: F.textSecondary, fontSize: 13 }}>
            {validationError}
          </div>
        )}

        <section style={{ marginTop: SP[5] }}>
          <h2 style={{ marginBottom: SP[2], fontSize: 18, lineHeight: '26px', fontWeight: 600 }}>基本资料</h2>
          <div style={{ padding: SP[3], borderRadius: R.bigCard, background: F.surface, boxShadow: S.raisedSoft }}>
            <div>
              <Label>食材名称</Label>
              <Field aria-label="食材名称" value={name} onChange={event => setName(event.target.value)} />
            </div>
            <div style={{ marginTop: SP[3] }}>
              <Label>收纳单位</Label>
              <SelectField aria-label="收纳单位" value={unit} onChange={event => setUnit(event.target.value as KitchenUnit)}>
                {editableUnits.map(option => <option key={option} value={option}>{unitLabels[option]}</option>)}
              </SelectField>
            </div>
            <div style={{ marginTop: SP[3] }}>
              <Label>每件包装规格（可不填）</Label>
              <Field aria-label="包装规格" value={packageSize} onChange={event => setPackageSize(event.target.value)} placeholder="例如 946 ml、30 fl oz 或 1.1 lb" />
            </div>
            {siblingLotCount > 1 && (
              <p style={{ marginTop: SP[2], color: F.textTertiary, fontSize: 12, lineHeight: '18px' }}>
                改名称会同步到另 {siblingLotCount - 1} 条同名批次；包装与位置只改这一条。
              </p>
            )}
          </div>
        </section>

        <section style={{ marginTop: SP[5] }}>
          <h2 style={{ marginBottom: SP[2], fontSize: 18, lineHeight: '26px', fontWeight: 600 }}>收纳与日期</h2>
          <div style={{ padding: SP[3], borderRadius: R.bigCard, background: F.surface, boxShadow: S.raisedSoft }}>
            <div>
              <Label>收纳位置</Label>
              <SelectField aria-label="收纳位置" value={storageZone} onChange={event => setStorageZone(event.target.value as KitchenStorageZone)}>
                {(Object.keys(zoneLabels) as KitchenStorageZone[]).map(option => <option key={option} value={option}>{zoneLabels[option]}</option>)}
              </SelectField>
            </div>
            <div className="grid grid-cols-2" style={{ gap: SP[2], marginTop: SP[3] }}>
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

        <section style={{ marginTop: SP[5] }}>
          <h2 style={{ marginBottom: SP[2], fontSize: 18, lineHeight: '26px', fontWeight: 600 }}>当前库存</h2>
          {onFinish && lot.quantity > 0 && <button type="button" onClick={onFinish} disabled={busy}
            className="w-full disabled:opacity-50"
            style={{ minHeight: 44, marginBottom: SP[2], borderRadius: R.button, background: F.surfaceRaised,
              color: KITCHEN.ink, boxShadow: S.raisedSoft, fontSize: 13, fontWeight: 600 }}>
            这条库存已用完
          </button>}
          <div style={{ padding: SP[3], borderRadius: R.bigCard, background: F.surfaceSunken, boxShadow: S.sunken }}>
            <div style={{ color: F.textPrimary, fontSize: 15, lineHeight: '23px', fontWeight: 600 }}>{stockSummary}</div>
            <div style={{ marginTop: SP[1], color: F.textSecondary, fontSize: 13, lineHeight: '18px' }}>
              余量请从列表展开后的“吃了一些”或秤图标核对，不会被修改资料时意外改掉。
            </div>
          </div>
        </section>

        <section style={{ marginTop: SP[5] }}>
          <h2 style={{ marginBottom: SP[2], fontSize: 18, lineHeight: '26px', fontWeight: 600 }}>这条库存的记录</h2>
          {lotEvents.length === 0 ? (
            <div style={{ padding: SP[3], borderRadius: R.bigCard, background: F.surfaceSunken, boxShadow: S.sunken, color: F.textTertiary, fontSize: 13 }}>
              还没有记录。
            </div>
          ) : (
            <div style={{ borderRadius: R.bigCard, background: F.surface, boxShadow: S.raisedSoft, overflow: 'hidden' }}>
              {lotEvents.map((event, index) => (
                <div key={event.id} className="flex items-center" style={{ minHeight: 64, gap: SP[2], padding: `${SP[2]}px ${SP[3]}px`, borderTop: index === 0 ? undefined : `1px solid ${F.divider}`, opacity: event.undoneAt ? 0.5 : 1 }}>
                  <span className="min-w-0 flex-1">
                    <span className="block" style={{ fontSize: 13, lineHeight: '18px', fontWeight: 600 }}>{EVENT_LABELS[event.type]}{event.undoneAt ? '（已撤销）' : ''}</span>
                    <span className="block" style={{ color: F.textTertiary, fontSize: 12, lineHeight: '18px' }}>{formatEventTime(event.occurredAt)}{event.note ? ` · ${event.note}` : ''}</span>
                  </span>
                  <span style={{ color: (event.contentDelta ?? event.quantityDelta) >= 0 ? KITCHEN.ink : F.textSecondary, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {formatEventAmount(event, unitLabels)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex w-full items-center justify-center font-semibold disabled:opacity-50 active:translate-y-[1px]"
          style={{ height: 48, gap: SP[1], marginTop: SP[5], borderRadius: R.button, background: KITCHEN.main, color: F.surfaceRaised, boxShadow: S.raisedSoft, transition: `transform ${MOTION.tap} ${MOTION.ease}` }}
        >
          <Check size={18} weight="bold" />
          保存修改
        </button>
      </main>
    </div>
  );
};

export default KitchenLotDetail;
