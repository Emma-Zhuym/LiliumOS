// [EM-START: calendar-temporal]
/**
 * CalendarApp.tsx — 日历
 *
 * 阿萌真实的 Apple 日历和提醒事项，由 Mac mini 后端每天同步一份到缓存里，这里只读。
 * 不直接连桥接：列一次日历要二十多秒，那是后台该干的事，不是点开 App 该等的。
 *
 * 后端缓存的是「昨天到两周后」这个窗口，所以往前往后翻月会是空的——这是设定，不是坏了。
 * 建事件 / 建提醒 / 勾完成要等后端的写接口，现在先把月历和当天清单摆出来。
 *
 * 主色 = indigo（事件），提醒用 amber 做唯一的辅助色。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowsClockwise, Bell, CalendarBlank, CaretLeft, CaretRight, Repeat } from '@phosphor-icons/react';

import { useOS } from '../context/OSContext';
import { F, HUE, R, S } from '../utils/clayTokens';
import { AgentBackend, isAgentPaired, type TemporalItem } from '../utils/emAgentBackend';
import {
    dayKey, groupByDay, hasOpenSource, itemTimeText, loadTemporalCache, monthGrid, saveTemporalCache, shiftMonth, syncText,
    type TemporalCache,
} from '../utils/emTemporal';

const C = HUE.indigo;
const A = HUE.amber;
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const IconBtn: React.FC<{ onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }> = ({ onClick, label, children, disabled }) => (
    <button onClick={onClick} aria-label={label} disabled={disabled}
        className="flex items-center justify-center active:translate-y-[1px] transition-transform disabled:opacity-50"
        style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
        {children}
    </button>
);

const CalendarApp: React.FC = () => {
    const { closeApp, addToast } = useOS();
    const today = useMemo(() => new Date(), []);
    const [cache, setCache] = useState<TemporalCache | null>(loadTemporalCache);
    const [loading, setLoading] = useState(false);
    const [cursor, setCursor] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));
    const [selected, setSelected] = useState(() => dayKey(today));

    const refresh = useCallback(async () => {
        if (!isAgentPaired()) return;
        setLoading(true);
        try {
            setCache(saveTemporalCache(await AgentBackend.temporal()));
        } catch {
            // mini 每天 4–7 点休眠：连不上就继续显示上次缓存的样子，不弹错
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const items = cache?.items ?? [];
    const byDay = useMemo(() => groupByDay(items), [items]);
    const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
    const dayItems = byDay.get(selected) ?? [];
    const todayKey = dayKey(today);

    const syncNow = async () => {
        try {
            await AgentBackend.refreshTemporal();
            addToast('已让 mini 去同步一次，一会儿下拉刷新', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '排任务失败', 'error');
        }
    };

    const renderCell = (cell: { key: string; date: Date; inMonth: boolean }) => {
        const bucket = byDay.get(cell.key) ?? [];
        const isSelected = cell.key === selected;
        const isToday = cell.key === todayKey;
        const hasEvent = bucket.some(item => item.kind === 'event');
        const hasReminder = bucket.some(item => item.kind === 'reminder');
        return (
            <button key={cell.key} onClick={() => setSelected(cell.key)}
                className="flex flex-col items-center justify-center active:translate-y-[1px] transition-transform"
                style={{
                    height: 46, borderRadius: R.medium, gap: 3,
                    background: isSelected ? C.main : isToday ? C.tint : 'transparent',
                    color: isSelected ? F.surfaceRaised : cell.inMonth ? F.textPrimary : F.textTertiary,
                    fontSize: 14, fontWeight: isToday || isSelected ? 700 : 500,
                }}>
                <span>{cell.date.getDate()}</span>
                <span className="flex items-center" style={{ gap: 2, height: 4 }}>
                    {hasEvent && <span style={{ width: 4, height: 4, borderRadius: R.pill, background: isSelected ? F.surfaceRaised : C.main }} />}
                    {hasReminder && <span style={{ width: 4, height: 4, borderRadius: R.pill, background: isSelected ? F.surfaceRaised : A.main }} />}
                </span>
            </button>
        );
    };

    const renderItem = (item: TemporalItem, index: number) => {
        const isReminder = item.kind === 'reminder';
        const hue = isReminder ? A : C;
        return (
            <div key={`${item.sourceId}-${index}`} className="flex items-start gap-3"
                style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: '14px 16px', boxShadow: S.raisedSoft }}>
                <div className="flex items-center justify-center shrink-0"
                    style={{ width: 36, height: 36, borderRadius: R.small, background: hue.tint }}>
                    {isReminder ? <Bell size={18} weight="bold" color={hue.ink} /> : <CalendarBlank size={18} weight="bold" color={hue.ink} />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="truncate" style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary, textDecoration: item.completed ? 'line-through' : 'none' }}>
                        {item.title}
                    </div>
                    <div className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 3, fontSize: 12, color: F.textTertiary }}>
                        <span style={{ color: hue.ink, fontWeight: 600 }}>{itemTimeText(item) || (isReminder ? '没写截止时间' : '')}</span>
                        <span className="truncate">{item.source}</span>
                        {item.location && <span className="truncate">{item.location}</span>}
                        {item.repeats && <span className="flex items-center" style={{ gap: 3 }}><Repeat size={12} weight="bold" color={F.textTertiary} />重复</span>}
                    </div>
                </div>
            </div>
        );
    };

    const monthLabel = `${cursor.year} 年 ${cursor.month + 1} 月`;
    const selectedDate = new Date(`${selected}T00:00:00`);
    const selectedLabel = Number.isNaN(selectedDate.getTime()) ? selected
        : `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 周${DAY_LABELS[selectedDate.getDay()]}`;

    return (
        <div className="h-full flex flex-col" style={{ background: F.appBg }}>
            <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
                <div className="relative flex items-center justify-between py-3" style={{ minHeight: 44, padding: '0 20px' }}>
                    <IconBtn onClick={closeApp} label="返回"><CaretLeft size={20} weight="bold" color={F.textSecondary} /></IconBtn>
                    <span className="absolute left-0 right-0 flex justify-center font-semibold pointer-events-none" style={{ fontSize: 16, color: F.textPrimary }}>日历</span>
                    <IconBtn onClick={() => void refresh()} label="重新读取" disabled={loading}>
                        <ArrowsClockwise size={18} weight="bold" color={F.textSecondary} />
                    </IconBtn>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3.5"
                style={{ padding: '8px 20px 16px', WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain', touchAction: 'pan-y' }}>

                {/* 月历 */}
                <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.panel, padding: 14, boxShadow: S.raisedSoft }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                        <button onClick={() => setCursor(prev => shiftMonth(prev.year, prev.month, -1))} aria-label="上个月"
                            className="flex items-center justify-center active:translate-y-[1px] transition-transform"
                            style={{ width: 36, height: 36, borderRadius: R.pill, background: F.surfaceSunken }}>
                            <CaretLeft size={16} weight="bold" color={F.textSecondary} />
                        </button>
                        <button onClick={() => { setCursor({ year: today.getFullYear(), month: today.getMonth() }); setSelected(todayKey); }}
                            style={{ fontSize: 15, fontWeight: 700, color: F.textPrimary }}>
                            {monthLabel}
                        </button>
                        <button onClick={() => setCursor(prev => shiftMonth(prev.year, prev.month, 1))} aria-label="下个月"
                            className="flex items-center justify-center active:translate-y-[1px] transition-transform"
                            style={{ width: 36, height: 36, borderRadius: R.pill, background: F.surfaceSunken }}>
                            <CaretRight size={16} weight="bold" color={F.textSecondary} />
                        </button>
                    </div>
                    <div className="grid grid-cols-7" style={{ marginBottom: 2 }}>
                        {DAY_LABELS.map(label => (
                            <div key={label} className="text-center" style={{ fontSize: 11, fontWeight: 600, color: F.textTertiary, paddingBottom: 4 }}>{label}</div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7" style={{ gap: 2 }}>{grid.map(renderCell)}</div>
                </div>

                {/* 选中那天 */}
                <div className="flex items-center justify-between px-1">
                    <span style={{ fontSize: 16, fontWeight: 600, color: F.textPrimary }}>{selectedLabel}</span>
                    <span style={{ fontSize: 12, color: F.textTertiary }}>{dayItems.length > 0 ? `${dayItems.length} 项` : '没有安排'}</span>
                </div>
                {dayItems.map(renderItem)}

                {/* 状态 / 空态 */}
                <div style={{ background: F.surfaceWarm, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: '14px 16px' }}>
                    {!isAgentPaired() ? (
                        <p style={{ fontSize: 12, color: F.textSecondary, lineHeight: 1.7 }}>
                            还没连上 Mac mini 后端。在「设置 → Mac mini 后端」里配对，再选好哪些日历可以读。
                        </p>
                    ) : !hasOpenSource(cache?.visibility) ? (
                        <p style={{ fontSize: 12, color: F.textSecondary, lineHeight: 1.7 }}>
                            一个日历都还没开。去「设置 → Mac mini 后端 → 角色能看到我哪些日历」勾上要读的日历和提醒清单。
                        </p>
                    ) : (
                        <div className="flex items-center justify-between gap-3">
                            <span style={{ fontSize: 12, color: F.textTertiary }}>
                                {syncText(cache?.sync)} · 只缓存昨天到两周后
                            </span>
                            <button onClick={() => void syncNow()}
                                className="shrink-0 active:translate-y-[1px] transition-transform"
                                style={{ padding: '8px 14px', borderRadius: R.pill, background: C.tint, color: C.ink, fontSize: 12, fontWeight: 600 }}>
                                立刻同步
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CalendarApp;
// [EM-END: calendar-temporal]
