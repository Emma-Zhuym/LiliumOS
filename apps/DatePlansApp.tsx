// [EM-START: date-plans]
/**
 * 约会：TA 们给阿萌安排的约会。当天之前只看得到哪天、什么场合、写了多少字（证明是真写了），
 * 内容当天才揭晓（阿萌 2026-10-29 选的）；当天可以直接去见面，见面开场照安排来。
 * 写安排只在聊天里（TA 写 [[DATE_PLAN]]），这里只看不改。逻辑在 utils/emDatePlans.ts。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CaretDown, CaretLeft, Champagne, LockSimple, Users } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { F, FONT, HUE, R, S } from '../utils/clayTokens';
import TokenImg from '../components/os/TokenImg';
import {
    dateKeyOf, daysBetween, isRevealed, loadDatePlans, subscribeDatePlans, upcomingDatePlans, type DatePlan,
} from '../utils/emDatePlans';
import { loadPromises, openPromises, promiseDue, settlePromise, subscribePromises, type CharPromise } from '../utils/emPromises'; // [EM: char-promises]

const C = HUE.rose;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const IconBtn: React.FC<{ onClick: () => void; label: string; children: React.ReactNode }> = ({ onClick, label, children }) => (
    <button onClick={onClick} aria-label={label}
        className="flex items-center justify-center active:opacity-40 transition-opacity"
        style={{ width: 44, height: 44, borderRadius: R.pill, background: 'transparent', border: 'none', boxShadow: 'none' }}>
        {children}
    </button>
);

const dayLabel = (key: string) => {
    const d = new Date(`${key}T00:00:00`);
    return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
};

const countdown = (key: string, today: string) => {
    const gap = daysBetween(today, key);
    return gap === 0 ? '今天' : gap === 1 ? '明天' : gap === 2 ? '后天' : `还有 ${gap} 天`;
};

const editedLabel = (at: number) => {
    const d = new Date(at);
    const sameDay = dateKeyOf(d) === dateKeyOf(new Date());
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return sameDay ? `今天 ${time}` : `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
};

const DatePlansApp: React.FC = () => {
    const { closeApp, characters, openDateWithChar } = useOS();
    const [plans, setPlans] = useState<DatePlan[]>(loadDatePlans);
    const [openPast, setOpenPast] = useState<string | null>(null);
    useEffect(() => subscribeDatePlans(() => setPlans(loadDatePlans())), []);
    const [promises, setPromises] = useState<CharPromise[]>(loadPromises); // [EM: char-promises]
    useEffect(() => subscribePromises(() => setPromises(loadPromises())), []);

    const today = dateKeyOf(new Date());
    const upcoming = useMemo(() => upcomingDatePlans(plans, today), [plans, today]);
    const past = useMemo(() => plans
        .filter(p => p.date < today || p.status === 'cancelled')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 30), [plans, today]);

    const charOf = (charId: string) => characters.find(c => c.id === charId);

    const avatar = (charId: string, size: number) => {
        const char = charOf(charId);
        return char?.avatar
            ? <TokenImg value={char.avatar} alt={char.name} style={{ width: size, height: size, borderRadius: R.pill, objectFit: 'cover', flexShrink: 0 }} />
            : (
                <div className="flex items-center justify-center shrink-0" style={{ width: size, height: size, borderRadius: R.pill, background: F.surfaceSunken }}>
                    <Users size={size / 2} weight="bold" color={F.textSecondary} />
                </div>
            );
    };

    const renderPlanCard = (plan: DatePlan, index: number) => {
        const char = charOf(plan.charId);
        const revealed = isRevealed(plan, today);
        const words = [...plan.itinerary.replace(/\s/g, '')].length;
        return (
            <div key={plan.id} className="flex flex-col clay-rise"
                style={{ '--i': index, gap: 12, background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.panel, padding: 16, boxShadow: S.raisedSoft } as React.CSSProperties}>
                <div className="flex items-center" style={{ gap: 12 }}>
                    {avatar(plan.charId, 44)}
                    <div className="flex-1 min-w-0">
                        <div style={{ fontSize: 12, color: F.textTertiary }}>{char?.name ?? 'TA'} 给你安排的</div>
                        <div className="flex items-baseline flex-wrap" style={{ gap: 8, marginTop: 2 }}>
                            <span style={{ fontSize: 20, fontWeight: 600, color: F.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{dayLabel(plan.date)}</span>
                            {plan.time && <span style={{ fontSize: 15, fontWeight: 600, color: F.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{plan.time}</span>}
                        </div>
                    </div>
                    <span className="shrink-0" style={{ padding: '4px 10px', borderRadius: R.pill, background: C.tint, color: C.ink, fontSize: 12, fontWeight: 600 }}>
                        {countdown(plan.date, today)}
                    </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{plan.title}</div>
                {revealed ? (
                    <>
                        <div style={{ background: F.surfaceSunken, borderRadius: R.medium, padding: '12px 14px', fontSize: 15, lineHeight: '23px', color: F.textSecondary, whiteSpace: 'pre-wrap' }}>
                            {plan.itinerary}
                        </div>
                        <button onClick={() => openDateWithChar(plan.charId)} className="clay-press"
                            style={{ height: 46, borderRadius: R.button, background: C.main, color: F.surface, fontSize: 15, fontWeight: 600, border: 'none' }}>
                            去见面
                        </button>
                    </>
                ) : (
                    <div className="flex items-center" style={{ gap: 12, background: F.surfaceSunken, borderRadius: R.medium, padding: '12px 14px' }}>
                        <LockSimple size={18} weight="bold" color={C.main} />
                        <div className="flex-1 min-w-0">
                            <div style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary }}>TA 写好了 · {words} 字</div>
                            <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 2 }}>最后改于 {editedLabel(plan.updatedAt)} · 当天揭晓</div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderPastRow = (plan: DatePlan, index: number) => {
        const char = charOf(plan.charId);
        const open = openPast === plan.id;
        const revealed = isRevealed(plan, today);
        const cancelled = plan.status === 'cancelled';
        return (
            <div key={plan.id} style={{ borderTop: index ? `1px solid ${F.divider}` : 'none' }}>
                <button onClick={() => setOpenPast(open ? null : plan.id)} disabled={!revealed}
                    className="w-full flex items-center text-left" style={{ gap: 12, padding: '12px 16px', minHeight: 64, background: 'transparent', border: 'none' }}>
                    {avatar(plan.charId, 36)}
                    <div className="flex-1 min-w-0">
                        <div className="truncate" style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary, textDecoration: cancelled ? 'line-through' : 'none' }}>{plan.title}</div>
                        <div className="truncate" style={{ fontSize: 12, color: F.textTertiary, marginTop: 2 }}>
                            {dayLabel(plan.date)} · {char?.name ?? 'TA'}{cancelled ? ' · 取消了' : ''}
                        </div>
                    </div>
                    {revealed
                        ? <CaretDown size={18} weight="bold" color={F.textTertiary} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
                        : <LockSimple size={18} weight="bold" color={F.textTertiary} />}
                </button>
                {open && revealed && (
                    <div style={{ margin: '0 16px 14px', background: F.surfaceSunken, borderRadius: R.medium, padding: '12px 14px', fontSize: 14, lineHeight: '22px', color: F.textSecondary, whiteSpace: 'pre-wrap' }}>
                        {plan.itinerary}
                    </div>
                )}
            </div>
        );
    };

    // [EM-START: char-promises] TA 答应的事：结果可以由她标（TA 下一轮会知道她标了没做到）
    const promiseWhen = (p: CharPromise) => {
        if (!p.date) return p.whenText || '没定哪天';
        const due = promiseDue(p, today);
        const label = `${dayLabel(p.date)}${p.time ? ` ${p.time}` : ''}`;
        return due === 'overdue' ? `${label} · 过期 ${daysBetween(p.date, today)} 天` : due === 'today' ? `今天${p.time ? ` ${p.time}` : ''}` : label;
    };
    const renderPromise = (p: CharPromise, index: number) => {
        const late = promiseDue(p, today) === 'overdue';
        const settleBtn = (label: string, status: 'done' | 'dropped') => (
            <button onClick={() => settlePromise(p.id, status, 'user')} className="flex-1 clay-press"
                style={{ height: 44, borderRadius: R.button, background: F.surfaceSunken, border: 'none', color: F.textPrimary, fontSize: 14, fontWeight: 600 }}>
                {label}
            </button>
        );
        return (
            <div key={p.id} className="flex flex-col clay-rise"
                style={{ '--i': index, gap: 12, background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.panel, padding: 16 } as React.CSSProperties}>
                <div className="flex items-start" style={{ gap: 12 }}>
                    {avatar(p.charId, 36)}
                    <div className="flex-1 min-w-0">
                        <div style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600, color: F.textPrimary, wordBreak: 'break-word' }}>{p.what}</div>
                        <div style={{ fontSize: 12, color: late ? C.ink : F.textTertiary, marginTop: 3 }}>{charOf(p.charId)?.name ?? 'TA'} · {promiseWhen(p)}</div>
                    </div>
                </div>
                <div className="flex" style={{ gap: 8 }}>{settleBtn('做到了', 'done')}{settleBtn('没做到', 'dropped')}</div>
            </div>
        );
    };
    const settled = promises.filter(p => p.status !== 'open').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
    const renderSettled = (p: CharPromise, index: number) => (
        <div key={p.id} className="flex items-center" style={{ gap: 12, padding: '12px 16px', minHeight: 64, borderTop: index ? `1px solid ${F.divider}` : 'none' }}>
            {avatar(p.charId, 36)}
            <div className="flex-1 min-w-0">
                <div style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary, textDecoration: p.status === 'dropped' ? 'line-through' : 'none', wordBreak: 'break-word' }}>{p.what}</div>
                <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 2, wordBreak: 'break-word' }}>
                    {charOf(p.charId)?.name ?? 'TA'} · {p.status === 'done' ? '做到了' : `没做到${p.reason ? `：${p.reason}` : ''}`}
                </div>
            </div>
        </div>
    );
    // [EM-END: char-promises]

    const sectionTitle = (text: string) => (
        <div style={{ ...FONT.sectionTitle, fontFamily: FONT.heading, color: F.textPrimary, padding: '4px 4px 0' }}>{text}</div>
    );

    return (
        <div className="h-full flex flex-col relative" style={{ background: F.appBg }}>
            <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
                <div className="relative flex items-center justify-between" style={{ minHeight: 44, padding: '0 20px' }}>
                    <IconBtn onClick={closeApp} label="返回"><CaretLeft size={22} weight="bold" color={F.textPrimary} /></IconBtn>
                    <span className="absolute left-0 right-0 flex justify-center pointer-events-none" style={{ ...FONT.navTitle, fontFamily: FONT.heading, color: F.textPrimary }}>约会</span>
                    <div style={{ width: 44 }} />
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col" style={{ gap: 12, padding: '12px 20px 32px' }}>
                {upcoming.length ? upcoming.map(renderPlanCard) : openPromises(promises).length > 0 ? null : (
                    <div className="flex flex-col items-center text-center" style={{ gap: 8, background: F.surfaceSunken, borderRadius: R.bigCard, padding: '28px 20px' }}>
                        <Champagne size={18} weight="bold" color={F.textTertiary} />
                        <div style={{ fontSize: 14, color: F.textTertiary, lineHeight: '21px' }}>
                            还没有谁给你安排约会。<br />在聊天里跟 TA 说想怎么过，TA 答应了就会写在这里，当天揭晓。
                        </div>
                    </div>
                )}

                {/* [EM: char-promises] */}
                {openPromises(promises).length > 0 && (
                    <>
                        <div style={{ height: 8 }} />
                        {sectionTitle('TA 答应的事')}
                        {openPromises(promises).map(renderPromise)}
                    </>
                )}

                {past.length > 0 && (
                    <>
                        <div style={{ height: 8 }} />
                        {sectionTitle('过去的')}
                        <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, overflow: 'hidden' }}>
                            {past.map(renderPastRow)}
                        </div>
                    </>
                )}

                {settled.length > 0 && (
                    <>
                        <div style={{ height: 8 }} />
                        {sectionTitle('答应过的')}
                        <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, overflow: 'hidden' }}>
                            {settled.map(renderSettled)}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default DatePlansApp;
// [EM-END: date-plans]
