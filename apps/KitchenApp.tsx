import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowCounterClockwise, CaretLeft, CaretRight, ClockCounterClockwise, MagnifyingGlass, Package, Plus, Snowflake, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import KitchenLotDetail from '../components/kitchen/KitchenLotDetail';
import KitchenSheet from '../components/kitchen/KitchenSheet';
import KitchenAddForm from '../components/kitchen/KitchenAddForm';
import KitchenLotActions from '../components/kitchen/KitchenLotActions';
import KitchenHistoryReceipts from '../components/kitchen/KitchenHistoryReceipts';
import { KITCHEN_PAPER_VARS } from '../utils/kitchenPaperTokens';
import '../components/kitchen/kitchenPaper.css';
import {
  KitchenDB, hasKitchenEventChange, type AddKitchenLotInput, type KitchenFood,
  type KitchenLot, type KitchenEvent, type KitchenStorageZone, type UpdateKitchenLotDetailsInput,
} from '../utils/kitchenDb';
import { describeLotStock, historyReceipts, makeOperationId, STORAGE_UNIT_OPTIONS, UNIT_LABELS, ZONE_LABELS } from '../utils/kitchenPresentation';

const KitchenFridgeScene = lazy(() => import('../components/kitchen/KitchenFridgeScene'));
type View = 'home' | 'list' | 'history';
type Notice = { text: string; error?: boolean; undo?: boolean };

const KitchenApp: React.FC = () => {
  const { closeApp } = useOS();
  const [foods, setFoods] = useState<KitchenFood[]>([]);
  const [lots, setLots] = useState<KitchenLot[]>([]);
  const [events, setEvents] = useState<KitchenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [view, setView] = useState<View>('home');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState<KitchenStorageZone | 'all'>('all');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const background = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const searchOnOpen = useRef(false);

  const refresh = useCallback(async () => {
    const [nextFoods, nextLots, nextEvents] = await Promise.all([KitchenDB.getFoods(), KitchenDB.getLots(), KitchenDB.getEvents()]);
    setFoods(nextFoods);
    setLots(nextLots);
    setEvents(nextEvents.sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id)));
    setLoadFailed(false);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try { await refresh(); }
    catch (error) {
      setLoadFailed(true);
      setNotice({ text: error instanceof Error ? error.message : '厨房没有成功打开', error: true });
    } finally { setLoading(false); }
  }, [refresh]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (view === 'list' && searchOnOpen.current) {
      searchField.current?.focus({ preventScroll: true });
      searchOnOpen.current = false;
    }
  }, [view]);
  // Keep undo available long enough to use; history remains a permanent fallback.
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(null), 9000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const foodById = useMemo(() => new Map(foods.map(food => [food.id, food])), [foods]);
  const activeLots = useMemo(() => lots.filter(lot => lot.quantity > 0)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)), [lots]);
  const visibleLots = activeLots.filter(lot => (zoneFilter === 'all' || lot.storageZone === zoneFilter)
    && (foodById.get(lot.foodId)?.name ?? '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const stagedCount = activeLots.filter(lot => lot.storageZone === 'staging').length;
  const visibleEvents = events.filter(hasKitchenEventChange);
  const canUndo = visibleEvents.some(event => event.type !== 'UNDO' && !event.undoneAt);
  const selectedLot = lots.find(lot => lot.id === selectedId && lot.quantity > 0);
  const detailLot = lots.find(lot => lot.id === detailId);
  const detailFood = detailLot && foodById.get(detailLot.foodId);

  const run = async (work: () => Promise<unknown>, message: string, close = false, undoable = true): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    let committed = false;
    try {
      await work();
      committed = true;
      if (close) { setShowAdd(false); setSelectedId(null); }
      await refresh();
      setNotice({ text: message, undo: undoable });
      return true;
    } catch (error) {
      if (committed) {
        // The ledger write already succeeded. Retrying must only reread it.
        setShowAdd(false);
        setSelectedId(null);
        setDetailId(null);
        setLoadFailed(true);
        setNotice({ text: '已保存，但画面没有刷新。请点重新打开，不需要再记一次。', error: true });
      } else {
        setNotice({ text: error instanceof Error ? error.message : '这次操作没有保存', error: true });
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const undo = async () => {
    let restored = false;
    const success = await run(async () => { restored = !!await KitchenDB.undoLatest(makeOperationId('undo')); }, '已撤销最近操作', false, false);
    if (success && !restored) setNotice({ text: '暂时没有可以撤销的操作' });
  };
  const openLot = useCallback((id: string) => { setNotice(null); setSelectedId(id); }, []);
  const openList = (focusSearch = false, filter: typeof zoneFilter = 'all') => {
    searchOnOpen.current = focusSearch;
    setZoneFilter(filter);
    setSearch('');
    setView('list');
  };
  const addFood = async (input: AddKitchenLotInput) => {
    await run(() => KitchenDB.addLot({ ...input, operationId: makeOperationId('add') }), '已经放进小厨房', true);
  };
  const saveDetails = async (input: UpdateKitchenLotDetailsInput) => {
    await run(() => KitchenDB.updateLotDetails(input), '食材资料已更新', false, false);
  };

  if (detailLot && detailFood) return <KitchenLotDetail lot={detailLot} food={detailFood} events={events}
    siblingLotCount={lots.filter(lot => lot.foodId === detailLot.foodId).length} busy={busy} notice={notice?.text ?? null}
    unitLabels={UNIT_LABELS} zoneLabels={ZONE_LABELS} editableUnits={STORAGE_UNIT_OPTIONS}
    onBack={() => { setDetailId(null); setNotice(null); }} onSave={input => { void saveDetails(input); }}
    onFinish={() => { void run(() => KitchenDB.changeLot({ type: 'FINISH', lotId: detailLot.id, operationId: makeOperationId('finish') }), '这条库存已清零，可在操作记录里撤销'); }} />;

  const renderRows = (items: KitchenLot[]) => <div className="kitchen-inventory">
    {items.map(lot => {
      const name = foodById.get(lot.foodId)?.name ?? '未命名食物';
      return <button className="kitchen-row kitchen-food-row" type="button" key={lot.id}
        aria-label={`查看${name}`} onClick={() => openLot(lot.id)}>
        <span className="kitchen-food-icon">{lot.storageZone === 'freezer' ? <Snowflake size={22} /> : <Package size={22} />}</span>
        <span className="kitchen-food-copy"><strong>{name}</strong><span>{describeLotStock(lot)}</span></span>
        <span className="kitchen-food-zone">{ZONE_LABELS[lot.storageZone]}</span><CaretRight size={16} />
      </button>;
    })}
  </div>;
  const inSheet = showAdd || !!selectedLot;

  // 首页整屏都是厨房（2026-10-11 Emma 定）：场景铺满，顶栏透明浮在画面上，底下只留一排纸签
  const stage = view === 'home' && !loading && !loadFailed;
  return <div className="kitchen-paper" style={KITCHEN_PAPER_VARS}>
    <div ref={background} className={stage ? 'kitchen-page is-stage' : 'kitchen-page'}>
      <header className="kitchen-header">
        <div className="kitchen-header-actions"><button type="button" className="kitchen-icon" aria-label={view === 'home' ? '返回' : '返回厨房'}
          onClick={() => view === 'home' ? closeApp() : setView('home')}><CaretLeft size={22} weight="bold" /></button></div>
        <h1 className="kitchen-heading">{view === 'home' ? '小厨房' : view === 'list' ? '食材清单' : '操作记录'}</h1>
        <div className="kitchen-header-actions">
          {view === 'home' && <button type="button" className="kitchen-icon" aria-label="搜索食材" onClick={() => openList(true)}><MagnifyingGlass size={21} /></button>}
          <button type="button" className="kitchen-icon" aria-label="添加食物" disabled={busy || loading || loadFailed}
            onClick={() => { setNotice(null); setShowAdd(true); }}><Plus size={23} /></button>
        </div>
      </header>
      <main className="kitchen-content">
        {loading ? <div className="kitchen-empty" role="status">正在打开小厨房…</div>
          : loadFailed ? <div className="kitchen-empty"><p>食材暂时没有读出来。</p><button type="button" className="kitchen-button" onClick={() => { void load(); }}>重新打开</button></div>
          : view === 'home' ? <>
            {/* 常温柜不做 3D（2026-10-11）：柜子里的零食饮料速食写在冷藏门左下那张「柜子里」清单上 */}
            <Suspense fallback={<div className="kitchen-empty" role="status">正在打开冰箱…</div>}>
              <KitchenFridgeScene fullBleed lots={lots} foods={foods} events={events} onOpenLot={openLot}
                onOpenHistory={() => setView('history')} onOpenPantry={() => openList(false, 'pantry')} />
            </Suspense>
            <nav className="kitchen-stage-chips" aria-label="厨房">
              <button type="button" className="kitchen-button" aria-label="食材清单" onClick={() => openList()}>食材清单 · {activeLots.length}</button>
              {stagedCount > 0 && <button type="button" className="kitchen-button" onClick={() => openList(false, 'staging')}>{stagedCount} 条还没收好</button>}
              <button type="button" className="kitchen-button" onClick={() => setView('history')}><ClockCounterClockwise size={16} />操作记录</button>
            </nav>
          </> : view === 'list' ? <>
            <div className="kitchen-list-tools">
              <input ref={searchField} className="kitchen-field" aria-label="搜索食材" placeholder="找找家里有什么" value={search} onChange={event => setSearch(event.target.value)} />
              <label className="kitchen-label">收纳位置
                <select className="kitchen-field" aria-label="筛选收纳位置" value={zoneFilter} onChange={event => setZoneFilter(event.target.value as typeof zoneFilter)}>
                  <option value="all">全部 · {activeLots.length} 条</option>
                  {Object.entries(ZONE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
            </div>
            {visibleLots.length ? renderRows(visibleLots) : <div className="kitchen-empty"><Package size={24} /><p>{activeLots.length ? '没有找到符合条件的食材，换个名称或位置试试。' : '还没有食材，先把买回来的放进来吧。'}</p></div>}
          </> : <>
            <div className="kitchen-history-head"><p className="kitchen-note">每次添置、用掉，都记在这页。</p>
              <button type="button" className="kitchen-text-button" disabled={busy || !canUndo} onClick={() => { void undo(); }}><ArrowCounterClockwise size={18} />撤销最近操作</button>
            </div>
            {visibleEvents.length === 0 ? <div className="kitchen-empty">还没有操作记录。</div>
              : <KitchenHistoryReceipts receipts={historyReceipts(visibleEvents, id => foodById.get(id)?.name)} />}
          </>}
      </main>
    </div>
    {inSheet && <KitchenSheet title={showAdd ? '放进食物' : foodById.get(selectedLot!.foodId)?.name ?? '食材'}
      label={showAdd ? '放进食物' : '食材操作'} busy={busy} backgroundRef={background}
      onClose={() => { setShowAdd(false); setSelectedId(null); setNotice(null); }}>
      {notice && <p className="kitchen-inline-notice" role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      {showAdd ? <KitchenAddForm initialZone="fridge" busy={busy} onAdd={addFood} />
        : <KitchenLotActions key={selectedLot!.id} lot={selectedLot!} busy={busy}
          run={(work, message, close) => run(work, message, close, close === true)} onError={text => setNotice({ text, error: true })}
          onEdit={() => { setDetailId(selectedId); setSelectedId(null); setNotice(null); }} />}
    </KitchenSheet>}
    {notice && !inSheet && <div className="kitchen-toast" role={notice.error ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      {notice.undo && canUndo && <button type="button" className="kitchen-text-button" onClick={() => { void undo(); }} disabled={busy}>撤销</button>}
      <button type="button" className="kitchen-icon" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={18} /></button>
    </div>}
  </div>;
};

export default KitchenApp;
