import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretDown,
  CaretRight,
  ForkKnife,
  Package,
  PencilSimple,
  Plus,
  Scales,
  Snowflake,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import KitchenLotDetail from '../components/kitchen/KitchenLotDetail';
import { F, HUE, MOTION, R, S, SP } from '../utils/clayTokens';
import {
  KitchenDB,
  hasKitchenEventChange,
  type KitchenEvent,
  type KitchenFood,
  type KitchenLot,
  type KitchenStorageZone,
  type KitchenTrackingMode,
  type KitchenUnit,
  type UpdateKitchenLotDetailsInput,
} from '../utils/kitchenDb';
import {
  formatPackageAmount,
  formatPortionFraction,
  formatPortionInput,
  parsePortionInput,
} from '../utils/kitchenQuantity';

const KITCHEN = HUE.green;
const KitchenFridgeScene = lazy(() => import('../components/kitchen/KitchenFridgeScene'));

const UNIT_LABELS: Record<KitchenUnit, string> = {
  piece: '个',
  pack: '包',
  bag: '袋',
  box: '盒',
  tray: '盘',
  can: '罐',
  large_bottle: '大瓶',
  small_bottle: '小瓶',
  portion: '份',
  gram: '克',
  milliliter: '毫升',
};

const STORAGE_UNIT_OPTIONS: KitchenUnit[] = [
  'piece',
  'pack',
  'bag',
  'box',
  'tray',
  'can',
  'large_bottle',
  'small_bottle',
  'portion',
];

const ZONE_LABELS: Record<KitchenStorageZone, string> = {
  staging: '待收纳',
  fridge: '冷藏',
  freezer: '冷冻',
  pantry: '常温柜',
};

const EVENT_LABELS: Record<KitchenEvent['type'], string> = {
  ADD: '放进厨房',
  CONSUME: '吃掉',
  DISCARD: '丢弃',
  ADJUST: '核对库存',
  UNDO: '撤销操作',
};

const makeOperationId = (prefix: string): string => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
};

const formatQuantity = (quantity: number, unit: KitchenUnit): string =>
  `${Number.isInteger(quantity) ? quantity : Number(quantity.toFixed(2))} ${UNIT_LABELS[unit]}`;

const describeLotStock = (lot: KitchenLot): string => {
  if (lot.trackingMode !== 'divisible') return `剩 ${formatQuantity(lot.quantity, lot.unit)}`;
  const remaining = lot.openContainerRemaining;
  if (remaining === undefined) return `剩 ${formatQuantity(lot.quantity, lot.unit)} · 未开封`;
  const sealedCount = Math.max(0, lot.quantity - 1);
  const measuredAmount = formatPackageAmount(lot.packageSize, remaining);
  const measuredDetail = measuredAmount ? `（约 ${measuredAmount}）` : '';
  const opened = `开封的约剩 ${formatPortionFraction(remaining)} ${UNIT_LABELS[lot.unit]}${measuredDetail}`;
  return sealedCount > 0 ? `${sealedCount} ${UNIT_LABELS[lot.unit]}未开封 · ${opened}` : opened;
};

const formatEventAmount = (event: KitchenEvent): string => {
  const delta = event.contentDelta ?? event.quantityDelta;
  const prefix = delta > 0 ? '+' : '';
  const absolute = Math.abs(delta);
  if (absolute > 0 && absolute < 1) return `${prefix}${delta < 0 ? '-' : ''}${formatPortionFraction(absolute)} ${UNIT_LABELS[event.unit]}`;
  return `${prefix}${formatQuantity(delta, event.unit)}`;
};

const quickAmount = (lot: KitchenLot): number => {
  const normal = lot.unit === 'gram' || lot.unit === 'milliliter' ? 50 : 1;
  return Math.min(normal, lot.quantity);
};

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
    className="flex shrink-0 items-center justify-center active:translate-y-[1px] disabled:opacity-50"
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
    {children}
  </button>
);

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

const ActionButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ onClick, disabled, icon, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex flex-1 items-center justify-center disabled:opacity-50 active:translate-y-[1px]"
    style={{
      minHeight: 44,
      gap: SP[1],
      padding: `0 ${SP[2]}px`,
      borderRadius: R.button,
      border: `1px solid ${F.borderSoft}`,
      background: F.surfaceRaised,
      color: F.textSecondary,
      boxShadow: S.raisedSoft,
      fontSize: 13,
      fontWeight: 600,
      transition: `transform ${MOTION.tap} ${MOTION.ease}`,
    }}
  >
    {icon}
    {children}
  </button>
);

const KitchenApp: React.FC = () => {
  const { closeApp } = useOS();
  const [foods, setFoods] = useState<KitchenFood[]>([]);
  const [lots, setLots] = useState<KitchenLot[]>([]);
  const [events, setEvents] = useState<KitchenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<KitchenUnit>('piece');
  const [zone, setZone] = useState<KitchenStorageZone>('staging');
  const [trackingMode, setTrackingMode] = useState<KitchenTrackingMode>('count');
  const [packageSize, setPackageSize] = useState('');
  const [adjustingLotId, setAdjustingLotId] = useState<string | null>(null);
  const [adjustedQuantity, setAdjustedQuantity] = useState('');
  const [portionEditor, setPortionEditor] = useState<{ lotId: string; mode: 'consume' | 'remaining' } | null>(null);
  const [customPortion, setCustomPortion] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState<KitchenStorageZone | 'all'>('all');
  const [expandedLotId, setExpandedLotId] = useState<string | null>(null);
  const [detailLotId, setDetailLotId] = useState<string | null>(null);
  const [showFridge, setShowFridge] = useState(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextFoods, nextLots, nextEvents] = await Promise.all([
      KitchenDB.getFoods(),
      KitchenDB.getLots(),
      KitchenDB.getEvents(),
    ]);
    setFoods(nextFoods);
    setLots(nextLots);
    setEvents(nextEvents.sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id)));
  }, []);

  useEffect(() => {
    refresh()
      .catch(error => setNotice(error instanceof Error ? error.message : '厨房没有成功打开'))
      .finally(() => setLoading(false));
  }, [refresh]);

  const foodById = useMemo(() => new Map(foods.map(food => [food.id, food])), [foods]);
  const activeLots = useMemo(
    () => lots.filter(lot => lot.quantity > 0).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
    [lots],
  );
  const visibleLots = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return activeLots.filter(lot => (zoneFilter === 'all' || lot.storageZone === zoneFilter)
      && (foodById.get(lot.foodId)?.name ?? '').toLocaleLowerCase().includes(query));
  }, [activeLots, foodById, search, zoneFilter]);
  const visibleEvents = events.filter(hasKitchenEventChange);

  const closeEditors = () => {
    setPortionEditor(null);
    setAdjustingLotId(null);
    setCustomPortion('');
    setNotice(null);
  };

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '这次操作没有保存');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const addFood = () => run(async () => {
    const parsedQuantity = Number(quantity);
    await KitchenDB.addLot({
      name,
      quantity: parsedQuantity,
      unit,
      storageZone: zone,
      trackingMode,
      packageSize,
      operationId: makeOperationId('add'),
    });
    setName('');
    setQuantity('');
    setTrackingMode('count');
    setPackageSize('');
    setShowAdd(false);
    setNotice('已经放进小厨房');
  });

  const changeQuantity = (lot: KitchenLot, type: 'CONSUME' | 'DISCARD') => run(async () => {
    const amount = quickAmount(lot);
    await KitchenDB.changeLot({
      type,
      lotId: lot.id,
      amount,
      operationId: makeOperationId(type.toLocaleLowerCase()),
    });
    setNotice(type === 'CONSUME' ? `已经记下吃掉 ${formatQuantity(amount, lot.unit)}` : `已经记下丢弃 ${formatQuantity(amount, lot.unit)}`);
  });

  const discard = (lot: KitchenLot) => run(async () => {
    if (lot.trackingMode === 'divisible') {
      await KitchenDB.discardCurrentContainer({
        lotId: lot.id,
        operationId: makeOperationId('discard-container'),
        note: lot.openContainerRemaining === undefined ? '丢弃一件未开封包装' : '丢弃当前开封包装',
      });
    } else {
      const amount = quickAmount(lot);
      await KitchenDB.changeLot({
        type: 'DISCARD',
        lotId: lot.id,
        amount,
        operationId: makeOperationId('discard'),
      });
    }
    setNotice('已经记下丢弃');
  });

  const finishLot = (lot: KitchenLot) => run(async () => {
    await KitchenDB.changeLot({
      type: 'FINISH', lotId: lot.id, operationId: makeOperationId('finish'), note: '整条库存已用完，清零',
    });
    closeEditors();
    setExpandedLotId(null);
    setNotice('这条库存已清零，可撤销恢复');
  });

  const savePortion = (
    lot: KitchenLot,
    fraction: number,
    mode: 'consume' | 'remaining',
    inputLabel = formatPortionFraction(fraction),
    inputKind: 'ratio' | 'measurement' = 'ratio',
  ) => run(async () => {
    const displayLabel = inputKind === 'ratio' ? `${inputLabel} ${UNIT_LABELS[lot.unit]}` : inputLabel;
    if (mode === 'consume') {
      await KitchenDB.consumePortion({
        lotId: lot.id,
        fraction,
        operationId: makeOperationId('consume-portion'),
        note: `估计用了 ${displayLabel}`,
      });
      setNotice(`已经记下用了约 ${displayLabel}`);
    } else {
      await KitchenDB.setPortionRemaining({
        lotId: lot.id,
        fraction,
        operationId: makeOperationId('adjust-portion'),
        note: fraction === 0 ? '整条库存余量为零' : `手动核对为约剩 ${displayLabel}`,
      });
      setNotice(fraction === 0 ? '这条库存已清零，可撤销恢复' : `余量已核对为约 ${displayLabel}`);
    }
    setPortionEditor(null);
    setCustomPortion('');
  });

  const saveCustomPortion = (lot: KitchenLot, mode: 'consume' | 'remaining') => {
    const result = parsePortionInput(customPortion, lot.packageSize);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    if (mode === 'consume' && result.value.fraction === 0) {
      setNotice('本次用量要大于 0，例如 1/3、20% 或 250 ml');
      return;
    }
    void savePortion(lot, result.value.fraction, mode, result.value.display, result.value.kind);
  };

  const saveAdjustment = (lot: KitchenLot) => run(async () => {
    if (!adjustedQuantity.trim()) throw new Error('请填写核对后的数量，清零请填 0');
    await KitchenDB.changeLot({
      type: 'ADJUST',
      lotId: lot.id,
      quantity: Number(adjustedQuantity),
      operationId: makeOperationId('adjust'),
      note: '手动核对现实库存',
    });
    setAdjustingLotId(null);
    setAdjustedQuantity('');
    setNotice('库存已经核对');
  });

  const undo = () => run(async () => {
    const result = await KitchenDB.undoLatest(makeOperationId('undo'));
    setNotice(result ? '已经撤销最近一次操作' : '暂时没有可以撤销的操作');
  });

  const saveLotDetails = (input: UpdateKitchenLotDetailsInput) => run(async () => {
    await KitchenDB.updateLotDetails(input);
    setNotice('食材资料已更新');
  });

  const zoneCounts = useMemo(() => {
    const result: Record<KitchenStorageZone, number> = { staging: 0, fridge: 0, freezer: 0, pantry: 0 };
    for (const lot of activeLots) result[lot.storageZone] += 1;
    return result;
  }, [activeLots]);

  const detailLot = detailLotId ? lots.find(lot => lot.id === detailLotId) ?? null : null;
  const detailFood = detailLot ? foodById.get(detailLot.foodId) ?? null : null;

  if (detailLot && detailFood) {
    return (
      <KitchenLotDetail
        lot={detailLot}
        food={detailFood}
        events={events}
        siblingLotCount={lots.filter(lot => lot.foodId === detailLot.foodId).length}
        busy={busy}
        notice={notice}
        unitLabels={UNIT_LABELS}
        zoneLabels={ZONE_LABELS}
        editableUnits={STORAGE_UNIT_OPTIONS}
        onBack={() => { closeEditors(); setDetailLotId(null); }}
        onSave={input => { void saveLotDetails(input); }}
        onFinish={() => { void finishLot(detailLot); }}
      />
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
      <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
        <div className="relative flex items-center" style={{ minHeight: 44, padding: `${SP[2]}px ${SP[4]}px` }}>
          <IconButton label="返回" onClick={closeApp}>
            <CaretLeft size={20} weight="bold" color={F.textSecondary} />
          </IconButton>
          <span
            className="pointer-events-none absolute left-0 right-0 flex justify-center font-semibold"
            style={{ fontSize: 16, color: F.textPrimary }}
          >
            小厨房
          </span>
          <div className="ml-auto">
            <IconButton label="添加食物" onClick={() => setShowAdd(value => !value)} disabled={busy}>
              {showAdd ? <X size={20} weight="bold" color={F.textSecondary} /> : <Plus size={20} weight="bold" color={KITCHEN.ink} />}
            </IconButton>
          </div>
        </div>
      </div>

      <main
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ padding: `${SP[1]}px ${SP[4]}px calc(var(--safe-bottom) + ${SP[5]}px)` }}
      >
        <div role="group" aria-label="厨房视图" className="flex"
          style={{ gap: SP[0], padding: SP[0], marginBottom: SP[3], borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken }}>
          {([{ value: false, label: '食材列表' }, { value: true, label: '看看冰箱' }]).map(option => (
            <button key={option.label} type="button" aria-pressed={showFridge === option.value}
              onClick={() => setShowFridge(option.value)} className="flex-1"
              style={{ minHeight: 44, borderRadius: R.medium, fontSize: 13, fontWeight: 600,
                background: showFridge === option.value ? F.surfaceRaised : 'transparent',
                boxShadow: showFridge === option.value ? S.raisedSoft : undefined,
                color: showFridge === option.value ? KITCHEN.ink : F.textSecondary }}>{option.label}</button>
          ))}
        </div>
        {showFridge && !loading && <Suspense fallback={<p role="status">正在打开冰箱视图…</p>}>
          <KitchenFridgeScene lots={lots} foods={foods} busy={busy}
            onMoveLot={(id, placement) => run(async () => { await KitchenDB.moveLot(id, placement); setNotice('摆放位置已保存'); })}
            onOpenLot={id => { closeEditors(); setDetailLotId(id); }} />
        </Suspense>}
        {showAdd && (
          <section
            style={{
              marginTop: SP[3],
              padding: SP[3],
              borderRadius: R.bigCard,
              border: `1px solid ${F.borderSoft}`,
              background: KITCHEN.tint,
              boxShadow: S.raisedSoft,
            }}
          >
            <div style={{ fontSize: 18, lineHeight: '26px', fontWeight: 600, marginBottom: SP[3] }}>放进一样食物</div>
            <div className="flex flex-col" style={{ gap: SP[2] }}>
              <Field value={name} onChange={event => setName(event.target.value)} placeholder="例如：鸡蛋" autoFocus />
              <div className="grid grid-cols-2" style={{ gap: SP[2] }}>
                <Field value={quantity} onChange={event => setQuantity(event.target.value)} placeholder="数量" type="number" min="0" step="any" inputMode="decimal" />
                <SelectField value={unit} onChange={event => setUnit(event.target.value as KitchenUnit)}>
                  {STORAGE_UNIT_OPTIONS.map(item => <option key={item} value={item}>{UNIT_LABELS[item]}</option>)}
                </SelectField>
              </div>
              <div className="grid grid-cols-2" style={{ gap: SP[2] }}>
                {([
                  { value: 'count' as const, label: '整件计数', hint: '鸡蛋、泡面' },
                  { value: 'divisible' as const, label: '可以分着吃', hint: '牛奶、牛肉' },
                ]).map(option => {
                  const selected = trackingMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setTrackingMode(option.value)}
                      style={{
                        minHeight: 52,
                        padding: `${SP[1]}px ${SP[2]}px`,
                        borderRadius: R.input,
                        border: `1px solid ${selected ? KITCHEN.main : F.borderSoft}`,
                        background: selected ? KITCHEN.main : F.surfaceRaised,
                        color: selected ? F.surfaceRaised : F.textSecondary,
                        boxShadow: selected ? S.raisedSoft : S.sunken,
                      }}
                    >
                      <span className="block" style={{ fontSize: 13, fontWeight: 600 }}>{option.label}</span>
                      <span className="block" style={{ marginTop: SP[0], fontSize: 11, opacity: 0.8 }}>{option.hint}</span>
                    </button>
                  );
                })}
              </div>
              <Field
                value={packageSize}
                onChange={event => setPackageSize(event.target.value)}
                placeholder="包装规格（可不填），例如 1 L、30 fl oz 或 1.1 lb"
              />
              <SelectField value={zone} onChange={event => setZone(event.target.value as KitchenStorageZone)}>
                {(Object.keys(ZONE_LABELS) as KitchenStorageZone[]).map(item => <option key={item} value={item}>{ZONE_LABELS[item]}</option>)}
              </SelectField>
              <button
                type="button"
                onClick={addFood}
                disabled={busy}
                className="w-full font-semibold disabled:opacity-50 active:translate-y-[1px]"
                style={{
                  height: 48,
                  borderRadius: R.button,
                  background: KITCHEN.main,
                  color: F.surfaceRaised,
                  boxShadow: S.raisedSoft,
                  transition: `transform ${MOTION.tap} ${MOTION.ease}`,
                }}
              >
                放进厨房
              </button>
            </div>
          </section>
        )}

        {notice && (
          <div
            role="status"
            style={{
              marginTop: SP[3],
              padding: `${SP[2]}px ${SP[3]}px`,
              borderRadius: R.medium,
              background: KITCHEN.tint,
              color: KITCHEN.ink,
              fontSize: 13,
            }}
          >
            {notice}
          </div>
        )}

        <section style={{ marginTop: SP[2] }}>
          <div className="flex items-center justify-between" style={{ marginBottom: SP[2] }}>
            <h2 style={{ fontSize: 18, lineHeight: '26px', fontWeight: 600 }}>
              家里的食材 <span style={{ fontSize: 13, color: F.textTertiary }}>{activeLots.length}</span>
            </h2>
            <button
              type="button"
              onClick={undo}
              disabled={busy || visibleEvents.every(event => event.type === 'UNDO' || !!event.undoneAt)}
              className="flex items-center disabled:opacity-40"
              style={{ gap: SP[1], color: KITCHEN.ink, fontSize: 13, fontWeight: 600 }}
            >
              <ArrowCounterClockwise size={18} />
              撤销最近操作
            </button>
          </div>

          <div style={{ marginBottom: SP[2] }}>
            <Field
              aria-label="搜索食材"
              placeholder="搜索食材名称"
              value={search}
              onChange={event => { setSearch(event.target.value); closeEditors(); setExpandedLotId(null); }}
            />
          </div>
          <div
            role="group"
            aria-label="收纳位置筛选"
            className="flex overflow-x-auto"
            style={{ gap: SP[0], padding: SP[0], marginBottom: SP[3], borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken }}
          >
            {(['all', 'fridge', 'freezer', 'pantry', 'staging'] as const).map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={zoneFilter === value}
                onClick={() => { setZoneFilter(value); closeEditors(); setExpandedLotId(null); }}
                className="flex-1 shrink-0 whitespace-nowrap"
                style={{ minHeight: 44, padding: `0 ${SP[1]}px`, borderRadius: R.medium,
                  background: zoneFilter === value ? F.surfaceRaised : 'transparent',
                  boxShadow: zoneFilter === value ? S.raisedSoft : undefined,
                  color: zoneFilter === value ? KITCHEN.ink : F.textSecondary, fontSize: 13, fontWeight: 600 }}
              >
                {value === 'all' ? '全部' : ZONE_LABELS[value]}
                <span style={{ marginLeft: SP[0], fontSize: 11 }}>{value === 'all' ? activeLots.length : zoneCounts[value]}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: SP[4], color: F.textTertiary }}>正在打开厨房…</div>
          ) : visibleLots.length === 0 ? (
            <div
              style={{
                padding: SP[5],
                borderRadius: R.bigCard,
                background: F.surfaceSunken,
                boxShadow: S.sunken,
                color: F.textSecondary,
                textAlign: 'center',
                fontSize: 15,
                lineHeight: '23px',
              }}
            >
              <Package size={18} style={{ margin: '0 auto', marginBottom: SP[1] }} />
              {activeLots.length === 0 ? '点右上角，把第一样食物放进来。' : '没有找到符合条件的食材，换个名称或位置试试。'}
            </div>
          ) : (
            <div style={{ borderRadius: R.bigCard, background: F.surface, boxShadow: S.raisedSoft, overflow: 'hidden' }}>
              {visibleLots.map((lot, index) => {
                const food = foodById.get(lot.foodId);
                const amount = quickAmount(lot);
                const isAdjusting = adjustingLotId === lot.id;
                const activePortionEditor = portionEditor?.lotId === lot.id ? portionEditor : null;
                const isDivisible = lot.trackingMode === 'divisible';
                const expanded = expandedLotId === lot.id;
                const remaining = lot.openContainerRemaining;
                const remainingLabel = isDivisible && remaining !== undefined
                  ? `约剩 ${formatPackageAmount(lot.packageSize, remaining) ?? `${formatPortionFraction(remaining)} ${UNIT_LABELS[lot.unit]}`}`
                  : `剩 ${formatQuantity(lot.quantity, lot.unit)}`;
                const sealedLabel = isDivisible && remaining !== undefined && lot.quantity > 1
                  ? ` · 另有 ${formatQuantity(lot.quantity - 1, lot.unit)}未开封` : '';
                return (
                  <article
                    key={lot.id}
                    style={{ borderTop: index === 0 ? undefined : `1px solid ${F.divider}`, background: expanded ? KITCHEN.tint : undefined }}
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`kitchen-actions-${lot.id}`}
                      onClick={() => { closeEditors(); setExpandedLotId(expanded ? null : lot.id); }}
                      className="flex w-full items-center text-left"
                      style={{ minHeight: 72, gap: SP[2], padding: `${SP[2]}px ${SP[3]}px` }}
                    >
                      <span className="flex shrink-0 items-center justify-center"
                        style={{ width: 44, height: 44, borderRadius: R.medium, background: KITCHEN.main, color: F.surfaceRaised }}>
                        {lot.storageZone === 'freezer' ? <Snowflake size={22} /> : <Package size={22} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={expanded ? 'block break-words' : 'block truncate'} style={{ fontSize: 15, lineHeight: '23px', fontWeight: 600 }}>{food?.name ?? '未命名食物'}</span>
                        <span className="block" style={{ color: F.textSecondary, fontSize: 12, lineHeight: '18px', fontVariantNumeric: 'tabular-nums' }}>
                          {remainingLabel}{sealedLabel}
                        </span>
                      </span>
                      <span className="shrink-0" style={{ color: F.textTertiary, fontSize: 12 }}>{ZONE_LABELS[lot.storageZone]}</span>
                      {expanded ? <CaretDown size={16} className="shrink-0" color={KITCHEN.ink} /> : <CaretRight size={16} className="shrink-0" color={F.textTertiary} />}
                    </button>

                    {expanded && (
                      <div id={`kitchen-actions-${lot.id}`} style={{ padding: `0 ${SP[3]}px ${SP[3]}px` }}>
                        <div style={{ color: F.textSecondary, fontSize: 12, lineHeight: '18px', overflowWrap: 'anywhere' }}>
                          {describeLotStock(lot)}{lot.packageSize ? ` · 每${UNIT_LABELS[lot.unit]} ${lot.packageSize}` : ''}
                        </div>
                        <div className="flex" style={{ gap: SP[2], marginTop: SP[2] }}>
                          <ActionButton
                            onClick={() => { closeEditors(); setDetailLotId(lot.id); }}
                            disabled={busy}
                            icon={<PencilSimple size={18} />}
                          >
                            详情与编辑
                          </ActionButton>
                        </div>
                        {isAdjusting && !isDivisible ? (
                          <div className="flex items-center" style={{ gap: SP[2], marginTop: SP[3] }}>
                            <Field
                              value={adjustedQuantity}
                              onChange={event => setAdjustedQuantity(event.target.value)}
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              aria-label="核对后的数量"
                            />
                            <button
                              type="button"
                              onClick={() => saveAdjustment(lot)}
                              disabled={busy}
                              className="shrink-0 font-semibold disabled:opacity-50"
                              style={{ height: 44, padding: `0 ${SP[3]}px`, borderRadius: R.button, background: KITCHEN.main, color: F.surfaceRaised }}
                            >
                              保存
                            </button>
                            <IconButton label="取消核对" onClick={() => setAdjustingLotId(null)} disabled={busy}>
                              <X size={18} color={F.textSecondary} />
                            </IconButton>
                          </div>
                        ) : (
                          <>
                            <div className="flex" style={{ gap: SP[2], marginTop: SP[3] }}>
                              <ActionButton
                                onClick={() => {
                                  if (isDivisible) {
                                    setPortionEditor({ lotId: lot.id, mode: 'consume' });
                                    setCustomPortion('');
                                  } else {
                                    void changeQuantity(lot, 'CONSUME');
                                  }
                                }}
                                disabled={busy}
                                icon={<ForkKnife size={18} />}
                              >
                                {isDivisible ? '吃了一些' : `吃掉 ${formatQuantity(amount, lot.unit)}`}
                              </ActionButton>
                              <ActionButton onClick={() => discard(lot)} disabled={busy} icon={<Trash size={18} />}>
                                丢弃
                              </ActionButton>
                              <IconButton
                                label={isDivisible ? '核对余量' : '核对库存'}
                                onClick={() => {
                                  if (isDivisible) {
                                    setPortionEditor({ lotId: lot.id, mode: 'remaining' });
                                    setCustomPortion(lot.openContainerRemaining === undefined ? '1' : formatPortionInput(lot.openContainerRemaining));
                                  } else {
                                    setAdjustingLotId(lot.id);
                                    setAdjustedQuantity(String(lot.quantity));
                                  }
                                }}
                                disabled={busy}
                              >
                                <Scales size={20} color={F.textSecondary} />
                              </IconButton>
                            </div>

                            {activePortionEditor && (
                              <div
                                style={{
                                  marginTop: SP[3],
                                  padding: SP[3],
                                  borderRadius: R.medium,
                                  background: F.surfaceSunken,
                                  boxShadow: S.sunken,
                                }}
                              >
                                <div className="flex items-center justify-between" style={{ gap: SP[2] }}>
                                  <strong style={{ fontSize: 13 }}>
                                    {activePortionEditor.mode === 'consume' ? '这次大约用了多少？' : '现在大约还剩多少？'}
                                  </strong>
                                  <button
                                    type="button"
                                    aria-label="关闭余量编辑"
                                    onClick={() => setPortionEditor(null)}
                                    style={{ color: F.textSecondary }}
                                  >
                                    <X size={18} />
                                  </button>
                                </div>
                                <div className="flex items-center" style={{ gap: SP[2], marginTop: SP[2] }}>
                                  <Field
                                    value={customPortion}
                                    onChange={event => setCustomPortion(event.target.value)}
                                    placeholder={activePortionEditor.mode === 'consume' ? '例如 1/3、20% 或 250 ml' : '例如 2/5、60% 或 700 ml'}
                                    aria-label={activePortionEditor.mode === 'consume' ? '自定义本次用量' : '自定义剩余量'}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => saveCustomPortion(lot, activePortionEditor.mode)}
                                    disabled={busy}
                                    className="shrink-0 font-semibold disabled:opacity-50"
                                    style={{ height: 44, padding: `0 ${SP[3]}px`, borderRadius: R.button, background: KITCHEN.main, color: F.surfaceRaised }}
                                  >
                                    保存
                                  </button>
                                </div>

                              </div>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => finishLot(lot)}
                          disabled={busy}
                          className="w-full font-semibold disabled:opacity-50"
                          style={{ minHeight: 44, marginTop: SP[2], borderRadius: R.button, background: F.surfaceRaised,
                            color: KITCHEN.ink, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, fontSize: 13 }}
                        >
                          这条库存已用完
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {visibleEvents.length > 0 && (
          <section style={{ marginTop: SP[5] }}>
            <h2 style={{ fontSize: 18, lineHeight: '26px', fontWeight: 600, marginBottom: SP[2] }}>最近变化</h2>
            <div
              style={{
                padding: SP[3],
                borderRadius: R.bigCard,
                background: F.surfaceSunken,
                boxShadow: S.sunken,
              }}
            >
              {visibleEvents.slice(0, 5).map((event, index) => (
                <div
                  key={event.id}
                  className="flex items-center"
                  style={{
                    gap: SP[2],
                    minHeight: 44,
                    borderTop: index === 0 ? undefined : `1px solid ${F.divider}`,
                    opacity: event.undoneAt ? 0.5 : 1,
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13, color: F.textSecondary }}>{EVENT_LABELS[event.type]}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: (event.contentDelta ?? event.quantityDelta) >= 0 ? KITCHEN.ink : F.textSecondary }}>
                    {formatEventAmount(event)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default KitchenApp;
