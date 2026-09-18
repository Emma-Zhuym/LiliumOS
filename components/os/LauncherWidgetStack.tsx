import React, { useEffect, useState } from 'react';
import { ChartBar, Heartbeat, HouseLine, CaretUp, CaretDown } from '@phosphor-icons/react';
import { AppID, type CharacterProfile, type DailySchedule } from '../../types';
import { useOS } from '../../context/OSContext';
import { FinanceDB } from '../../utils/financeDb';
import { FINANCE_REVIEW_CHANGED_EVENT } from '../../utils/financeReview';
import { buildLauncherExpenseChart, type LauncherExpenseChart } from '../../utils/launcherFinanceChart';
import { getAllHealthEvents, type PeriodHealthEvent } from '../../utils/healthDb';
import { calcCycleStatus } from '../../utils/cycleCalc';
import { createDemoSmartHomeDevices, fetchSmartHomeDevices, loadSmartHomeConfig, type SmartHomeDevice } from '../../utils/smartHome';
import { F, S, R, HUE, MOTION, SP } from '../../utils/clayTokens';
import { ScheduleHomeWidget } from '../schedule/ScheduleHomeWidget';

type CardId = 'schedule' | 'finance' | 'health' | 'home';
const CARD_IDS: CardId[] = ['schedule', 'finance', 'health', 'home'];
const CARD_LABELS: Record<CardId, string> = { schedule: '日程', finance: '存钱罐', health: '健康', home: '共栖舱' };

const cardStyle: React.CSSProperties = {
  height: '100%', background: F.surface, border: `1px solid ${F.borderSoft}`,
  borderRadius: R.bigCard, boxShadow: S.raisedSoft, color: F.textPrimary,
};

function FinanceCard({ onOpen }: { onOpen: () => void }) {
  const [chart, setChart] = useState<LauncherExpenseChart | null>(null);
  const [currency, setCurrency] = useState('');
  const [view, setView] = useState<'day' | 'category'>('day');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const now = new Date();
        const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
        const [transactions, categories, settings] = await Promise.all([
          FinanceDB.getTransactionsByDateRange(from, to), FinanceDB.getCategories(),
          FinanceDB.getSetting<{ defaultCurrency?: string }>('financeSettings'),
        ]);
        const chosenCurrency = settings?.defaultCurrency || transactions[0]?.currency || 'CNY';
        if (active) {
          setChart(buildLauncherExpenseChart(transactions, categories, now.getFullYear(), now.getMonth() + 1, chosenCurrency));
          setCurrency(chosenCurrency);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    };
    void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener(FINANCE_REVIEW_CHANGED_EVENT, refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.removeEventListener(FINANCE_REVIEW_CHANGED_EVENT, refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const amount = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
  const values = view === 'day' ? chart?.days || [] : chart?.categories.map(item => item.amount) || [];
  const max = Math.max(1, ...values);
  return (
    <div style={{ ...cardStyle, paddingRight: SP[8] }} className="p-3 flex flex-col" onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ChartBar size={18} weight="regular" style={{ color: HUE.lime.ink }} />
          <span className="text-[13px] font-semibold">本月支出</span>
          <span className="text-[10px]" style={{ color: F.textTertiary }}>{currency}</span>
        </div>
        <div className="flex p-0.5" style={{ background: F.surfaceSunken, borderRadius: R.medium }} onClick={e => e.stopPropagation()}>
          {(['day', 'category'] as const).map(option => (
            <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)}
              className="px-2 py-1 text-[10px] font-medium"
              style={{ borderRadius: R.small, background: view === option ? F.surfaceRaised : 'transparent', boxShadow: view === option ? S.raisedSoft : 'none' }}>
              {option === 'day' ? '每日' : '分类'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <strong className="text-lg tabular-nums" style={{ color: HUE.lime.ink }}>{chart ? amount(chart.total) : '—'}</strong>
        <span className="text-[10px]" style={{ color: F.textTertiary }}>
          {chart?.rentCategoryFound ? '已排除每月固定／房租' : '未找到每月固定／房租分类'}
        </span>
      </div>
      <div className="flex-1 min-h-0 mt-1 px-2 py-1" style={{ background: HUE.lime.tint, borderRadius: R.small, boxShadow: S.sunken }}>
        {failed ? <div className="h-full flex items-center justify-center text-xs" style={{ color: F.textTertiary }}>账目读取失败</div>
          : !chart ? <div className="h-full flex items-center justify-center text-xs" style={{ color: F.textTertiary }}>正在读取账目</div>
          : chart.total <= 0 ? <div className="h-full flex items-center justify-center text-xs" style={{ color: F.textTertiary }}>本月暂无支出</div>
          : view === 'day' ? (
            <div className="h-full flex items-end gap-px" role="img" aria-label={`本月每日支出柱状图，合计 ${amount(chart.total)} ${currency}，已排除房租`}>
              {chart.days.map((value, index) => (
                <div key={index} className="flex-1 min-w-0 flex flex-col justify-end items-center h-full" title={`${index + 1}日 ${amount(value)} ${currency}`}>
                  <div className="w-full" style={{ height: value > 0 ? `${Math.max(4, value / max * 100)}%` : 0, background: HUE.lime.main, borderRadius: R.tiny }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full overflow-y-auto flex flex-col gap-1" role="img" aria-label="本月各分类支出柱状图，已排除房租">
              {chart.categories.map(item => (
                <div key={item.id} className="flex items-center gap-1 text-[10px] leading-none">
                  <span className="w-10 truncate" title={item.name}>{item.name}</span>
                  <div className="flex-1 h-2" style={{ background: F.surfaceSunken, borderRadius: R.pill }}>
                    <div className="h-full" style={{ width: `${item.amount / max * 100}%`, background: HUE.lime.main, borderRadius: R.pill }} />
                  </div>
                  <span className="w-9 text-right tabular-nums truncate">{amount(item.amount)}</span>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

function HealthCard({ onOpen }: { onOpen: () => void }) {
  const [cycle, setCycle] = useState<ReturnType<typeof calcCycleStatus> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => void getAllHealthEvents()
      .then(events => { if (active) { setCycle(calcCycleStatus(events.filter((event): event is PeriodHealthEvent => event.type === 'period'))); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return (
    <div style={{ ...cardStyle, paddingRight: SP[8] }} className="p-4 flex flex-col" onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      <div className="flex items-center gap-2 text-[13px] font-semibold"><Heartbeat size={18} style={{ color: HUE.rose.ink }} />健康</div>
      <div className="flex-1 flex flex-col justify-center items-center" style={{ color: HUE.rose.ink }}>
        {failed ? <span className="text-sm">健康记录读取失败</span>
          : cycle?.lastPeriodStart ? <><span className="text-[13px]">当前周期</span><strong className="text-3xl tabular-nums">第 {cycle.cycleDay} 天</strong></>
          : <span className="text-sm">暂无经期数据</span>}
      </div>
      <div className="text-center text-[11px]" style={{ color: F.textTertiary }}>
        {cycle?.lastPeriodStart ? `从 ${cycle.lastPeriodStart} 记录起算` : '在健康中记录经期后显示'}
      </div>
    </div>
  );
}

function HomeCard({ onOpen }: { onOpen: () => void }) {
  const [devices, setDevices] = useState<SmartHomeDevice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const config = loadSmartHomeConfig();
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (config.demoMode || !config.baseUrl.trim()) { setDevices(createDemoSmartHomeDevices()); return; }
      void fetchSmartHomeDevices(config)
        .then(next => { if (active) { setDevices(next); setFailed(false); } })
        .catch(() => { if (active) setFailed(true); });
    };
    refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  const running = devices?.filter(device => (device.kind === 'light' || device.kind === 'fan') && device.state === 'on').length || 0;
  const unavailable = devices?.filter(device => device.kind !== 'scene' && !device.available).length || 0;
  return (
    <div style={{ ...cardStyle, paddingRight: SP[8] }} className="p-4 flex flex-col" onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      <div className="flex items-center justify-between text-[13px] font-semibold">
        <span className="flex items-center gap-2"><HouseLine size={18} style={{ color: HUE.cyan.ink }} />共栖舱</span>
        <span className="text-[10px] font-normal" style={{ color: F.textTertiary }}>{config.demoMode ? '演示模式' : failed ? '连接失败' : '设备状态'}</span>
      </div>
      <div className="flex-1 flex items-center justify-center gap-3">
        <div className="px-4 py-2 text-center" style={{ background: HUE.cyan.tint, borderRadius: R.medium, boxShadow: S.sunken }}>
          <strong className="block text-2xl tabular-nums" style={{ color: HUE.cyan.ink }}>{devices ? running : '—'}</strong>
          <span className="text-[11px]">运行中</span>
        </div>
        <div className="px-4 py-2 text-center" style={{ background: F.surfaceSunken, borderRadius: R.medium, boxShadow: S.sunken }}>
          <strong className="block text-2xl tabular-nums">{devices ? unavailable : '—'}</strong>
          <span className="text-[11px]">不可用</span>
        </div>
      </div>
      <span className="text-center text-[11px]" style={{ color: F.textTertiary }}>{failed ? '打开共栖舱检查连接' : '点开查看设备与场景'}</span>
    </div>
  );
}

export default function LauncherWidgetStack({ schedule, character, contentColor, acnh, paper, onOpenSchedule }: {
  schedule: DailySchedule | null; character: CharacterProfile | null; contentColor: string;
  acnh: boolean; paper: boolean; onOpenSchedule: () => void;
}) {
  const { openApp } = useOS();
  const ids = character ? CARD_IDS : CARD_IDS.filter(id => id !== 'schedule');
  const [index, setIndex] = useState(0);
  const pointerStart = React.useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClickUntil = React.useRef(0);
  const activeIndex = Math.min(index, ids.length - 1);
  const move = (delta: number) => setIndex(current => (current + delta + ids.length) % ids.length);
  const selected = ids[activeIndex];
  return (
    <div className="relative w-full shrink-0" style={{ height: SP[8] * 3 }}
      onClickCapture={event => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }}
      onPointerDown={event => { pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }}
      onPointerCancel={() => { pointerStart.current = null; }}
      onPointerUp={event => {
        const start = pointerStart.current;
        pointerStart.current = null;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx) * 1.4) {
          suppressClickUntil.current = Date.now() + 500;
          move(dy < 0 ? 1 : -1);
        }
      }}>
      <div className="h-full" style={{ transition: `opacity ${MOTION.card} ${MOTION.ease}` }}>
        {selected === 'schedule' && character && <ScheduleHomeWidget schedule={schedule} character={character} contentColor={contentColor} onOpen={onOpenSchedule} acnh={acnh} paper={paper} />}
        {selected === 'finance' && <FinanceCard onOpen={() => openApp(AppID.Bank)} />}
        {selected === 'health' && <HealthCard onOpen={() => openApp(AppID.Health)} />}
        {selected === 'home' && <HomeCard onOpen={() => openApp(AppID.SmartHome)} />}
      </div>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 p-1" style={{ background: F.surface, borderRadius: R.pill, boxShadow: S.raisedSoft }} onClick={event => event.stopPropagation()}>
        <button type="button" aria-label="上一张小组件" className="w-11 h-11 flex items-center justify-center" onClick={() => move(-1)}><CaretUp size={18} weight="bold" /></button>
        {ids.map((id, cardIndex) => <span key={id} title={CARD_LABELS[id]} className="w-1.5 h-1.5 rounded-full" style={{ background: cardIndex === activeIndex ? HUE.gray.ink : F.borderStrong }} />)}
        <button type="button" aria-label="下一张小组件" className="w-11 h-11 flex items-center justify-center" onClick={() => move(1)}><CaretDown size={18} weight="bold" /></button>
      </div>
    </div>
  );
}
