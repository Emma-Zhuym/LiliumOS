import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowCounterClockwise,
  Basket,
  CaretLeft,
  ForkKnife,
  Package,
  Plus,
  Scales,
  Snowflake,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { F, HUE, MOTION, R, S, SP } from '../utils/clayTokens';
import {
  KitchenDB,
  type KitchenEvent,
  type KitchenFood,
  type KitchenLot,
  type KitchenStorageZone,
  type KitchenUnit,
} from '../utils/kitchenDb';

const KITCHEN = HUE.green;

const UNIT_LABELS: Record<KitchenUnit, string> = {
  piece: '个',
  pack: '包',
  gram: '克',
  milliliter: '毫升',
  portion: '份',
};

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
  const [adjustingLotId, setAdjustingLotId] = useState<string | null>(null);
  const [adjustedQuantity, setAdjustedQuantity] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
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
    () => lots.filter(lot => lot.quantity > 0).sort((a, b) => b.updatedAt - a.updatedAt),
    [lots],
  );

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
      operationId: makeOperationId('add'),
    });
    setName('');
    setQuantity('');
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

  const saveAdjustment = (lot: KitchenLot) => run(async () => {
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

  const zoneCounts = useMemo(() => {
    const result: Record<KitchenStorageZone, number> = { staging: 0, fridge: 0, freezer: 0, pantry: 0 };
    for (const lot of activeLots) result[lot.storageZone] += 1;
    return result;
  }, [activeLots]);

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
        <section
          style={{
            padding: SP[4],
            borderRadius: R.panel,
            border: `1px solid ${F.borderSoft}`,
            background: F.surface,
            boxShadow: S.raisedMedium,
          }}
        >
          <div className="flex items-start justify-between" style={{ gap: SP[3] }}>
            <div>
              <div style={{ color: F.textTertiary, fontSize: 13 }}>今日小厨房</div>
              <div style={{ marginTop: SP[1], fontSize: 24, lineHeight: '32px', fontWeight: 600 }}>
                {activeLots.length === 0 ? '还空着呢' : `${activeLots.length} 批食物在家`}
              </div>
            </div>
            <div
              className="flex items-center justify-center shrink-0"
              style={{ width: 44, height: 44, borderRadius: R.smallCard, background: KITCHEN.main, color: F.surfaceRaised }}
            >
              <Basket size={26} weight="regular" />
            </div>
          </div>

          <div className="grid grid-cols-2" style={{ gap: SP[2], marginTop: SP[4] }}>
            {(Object.keys(ZONE_LABELS) as KitchenStorageZone[]).map(item => (
              <div
                key={item}
                className="flex items-center"
                style={{
                  gap: SP[2],
                  padding: SP[2],
                  borderRadius: R.medium,
                  background: F.surfaceSunken,
                  boxShadow: S.sunken,
                }}
              >
                {item === 'freezer' ? <Snowflake size={18} color={KITCHEN.ink} /> : <Package size={18} color={KITCHEN.ink} />}
                <span style={{ flex: 1, fontSize: 13, color: F.textSecondary }}>{ZONE_LABELS[item]}</span>
                <strong style={{ color: KITCHEN.ink }}>{zoneCounts[item]}</strong>
              </div>
            ))}
          </div>
        </section>

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
                  {(Object.keys(UNIT_LABELS) as KitchenUnit[]).map(item => <option key={item} value={item}>{UNIT_LABELS[item]}</option>)}
                </SelectField>
              </div>
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

        <section style={{ marginTop: SP[5] }}>
          <div className="flex items-center justify-between" style={{ marginBottom: SP[2] }}>
            <h2 style={{ fontSize: 18, lineHeight: '26px', fontWeight: 600 }}>现在有什么</h2>
            <button
              type="button"
              onClick={undo}
              disabled={busy || events.every(event => event.type === 'UNDO' || !!event.undoneAt || event.quantityDelta === 0)}
              className="flex items-center disabled:opacity-40"
              style={{ gap: SP[1], color: KITCHEN.ink, fontSize: 13, fontWeight: 600 }}
            >
              <ArrowCounterClockwise size={18} />
              撤销最近操作
            </button>
          </div>

          {loading ? (
            <div style={{ padding: SP[4], color: F.textTertiary }}>正在打开厨房…</div>
          ) : activeLots.length === 0 ? (
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
              点右上角，把第一样食物放进来。
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: SP[2] }}>
              {activeLots.map(lot => {
                const food = foodById.get(lot.foodId);
                const amount = quickAmount(lot);
                const isAdjusting = adjustingLotId === lot.id;
                return (
                  <article
                    key={lot.id}
                    style={{
                      padding: SP[3],
                      borderRadius: R.bigCard,
                      border: `1px solid ${F.borderSoft}`,
                      borderLeft: `${SP[0]}px solid ${KITCHEN.main}`,
                      background: KITCHEN.tint,
                      boxShadow: S.raisedSoft,
                    }}
                  >
                    <div className="flex items-center" style={{ gap: SP[2] }}>
                      <div
                        className="flex items-center justify-center shrink-0"
                        style={{ width: 44, height: 44, borderRadius: R.medium, background: KITCHEN.main, color: F.surfaceRaised }}
                      >
                        <Package size={22} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 15, lineHeight: '23px', fontWeight: 600 }}>{food?.name ?? '未命名食物'}</div>
                        <div style={{ marginTop: SP[0], color: F.textSecondary, fontSize: 13 }}>
                          {ZONE_LABELS[lot.storageZone]} · 剩 {formatQuantity(lot.quantity, lot.unit)}
                        </div>
                      </div>
                    </div>

                    {isAdjusting ? (
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
                      <div className="flex" style={{ gap: SP[2], marginTop: SP[3] }}>
                        <ActionButton onClick={() => changeQuantity(lot, 'CONSUME')} disabled={busy} icon={<ForkKnife size={18} />}>
                          吃掉 {formatQuantity(amount, lot.unit)}
                        </ActionButton>
                        <ActionButton onClick={() => changeQuantity(lot, 'DISCARD')} disabled={busy} icon={<Trash size={18} />}>
                          丢弃
                        </ActionButton>
                        <IconButton
                          label="核对库存"
                          onClick={() => {
                            setAdjustingLotId(lot.id);
                            setAdjustedQuantity(String(lot.quantity));
                          }}
                          disabled={busy}
                        >
                          <Scales size={20} color={F.textSecondary} />
                        </IconButton>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {events.length > 0 && (
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
              {events.slice(0, 5).map((event, index) => (
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
                  <span style={{ fontSize: 13, fontWeight: 600, color: event.quantityDelta >= 0 ? KITCHEN.ink : F.textSecondary }}>
                    {event.quantityDelta > 0 ? '+' : ''}{formatQuantity(event.quantityDelta, event.unit)}
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
