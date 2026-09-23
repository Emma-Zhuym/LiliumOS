// [EM-START: agent-backend-chronicle]
/**
 * 起居注 —— 「查手机」里的一页：TA 每次自己醒来，做了什么。
 *
 * 这一页天然契合「查手机」的设定：你看到的是 TA 的活动记录，
 * 不是 TA 特地发给你的消息。所以它不推送、不进聊天，只躺在这里等你翻。
 *
 * 做成一条时间轴而不是一叠卡片：起居注记的是「一天是怎么过的」，
 * 顺序和间隔本身就是内容。
 *
 * 轴上有三种东西：
 * - **当天日程**（上班、逛街、打游戏……）是底子，说明这一天 TA 本来在做什么；
 * - **心跳条目**是 TA 自己想起阿萌的时刻，钉在对应的时间点上；
 * - **手机上的动静**（刷出来的朋友圈、短信、订单）也是 TA 做过的事，本机就有，不用后台。
 * 没有日程作底，那些时刻就成了悬空的碎片——「翻了会儿手机」发生在上班路上还是躺床上，
 * 读起来完全是两回事。日程取自本机 IndexedDB，跟聊天用的是同一份（角色时区算日期）。
 *
 * 被闸门拦下的那些不单独占一格，缩成轴上的一行灰字。注意别写成「睡回去了」——
 * 角色大部分时候醒着，只是没有要对阿萌说的话。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowsClockwise, CaretDown, PencilSimpleLine } from '@phosphor-icons/react';

import type { CharacterProfile, ScheduleSlot } from '../../types';
import { getDailyScheduleForChar } from '../../utils/dailySchedule';
import { AgentBackend, isAgentPaired } from '../../utils/emAgentBackend';
import {
    loadChronicle, mergeChronicle, toSegments,
    type ChronicleEntry, type ChronicleSegment,
} from '../../utils/emAgentActivity';

const SERIF = "'Shippori Mincho','Noto Serif SC',serif";

const fmtClock = (at: string) =>
    new Date(at).toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit', hour12: true });

const dayKey = (at: string) => new Date(at).toDateString();

/** 把日程的 "HH:MM" 落到某一天上，好和心跳条目一起按时间排。 */
const slotTimestamp = (day: Date, startTime: string): number => {
    const [hour, minute] = String(startTime).split(':').map(Number);
    const at = new Date(day);
    at.setHours(Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0, 0);
    return at.getTime();
};

/** 段落自己的时刻：活动取那一条，安静段取它开始的那一刻。 */
const segmentAt = (segment: ChronicleSegment): string =>
    segment.kind === 'entry' ? segment.entry.at : segment.at;

const fmtDay = (at: string) => {
    const date = new Date(at);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    if (date.toDateString() === today.toDateString()) return '今天';
    if (date.toDateString() === yesterday.toDateString()) return '昨天';
    return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
};

/**
 * 「查手机」刷出来的一条动静。由 CheckPhone 把 phoneState.records 整形后传进来。
 *
 * 只带一句「刷了刷朋友圈」这样的说法，不带正文：起居注是一天的轮廓，
 * 朋友圈写了什么、订单买了什么，点进那个 App 自己看就是了。
 */
export interface PhoneEvent {
    id: string;
    at: number;
    label: string;
}

type DayRow =
    | { at: number; segment: ChronicleSegment }
    | { at: number; phone: PhoneEvent }
    | { at: number; slot: ScheduleSlot };

interface Props {
    targetChar: CharacterProfile;
    accent: string;
    phoneEvents?: PhoneEvent[];
}

export default function ChronicleApp({ targetChar, accent, phoneEvents = [] }: Props) {
    const [entries, setEntries] = useState<ChronicleEntry[]>(() => loadChronicle(targetChar.id));
    const [slots, setSlots] = useState<ScheduleSlot[]>([]);
    const [loading, setLoading] = useState(false);
    const [offline, setOffline] = useState(false);
    // 心声默认收着：它比那句 activity 长得多，全展开的话一天就刷满一屏。
    const [openInner, setOpenInner] = useState<Record<number, boolean>>({});

    const refresh = useCallback(async () => {
        if (!isAgentPaired()) {
            setOffline(true);
            return;
        }
        setLoading(true);
        try {
            const runs = await AgentBackend.audit(targetChar.id, 100);
            setEntries(mergeChronicle(targetChar.id, runs.map(run => ({
                id: run.id,
                charId: run.charId,
                activity: run.activity,
                outcome: run.outcome,
                skipGate: run.skipGate,
                proposedText: run.proposedText,
                reason: run.reason,
                shadow: run.shadow,
                at: run.startedAt,
            }))));
            setOffline(false);
        } catch {
            // 取不到就翻本地那份副本：后台不在线是常态，不是故障。
            setOffline(true);
        } finally {
            setLoading(false);
        }
    }, [targetChar.id]);

    useEffect(() => { void refresh(); }, [refresh]);

    // 当天日程：本机就有，不用等后台。没生成日程的角色这里是空的，轴上就只剩心跳条目。
    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const schedule = await getDailyScheduleForChar(targetChar);
                if (alive) setSlots(schedule?.slots ?? []);
            } catch {
                if (alive) setSlots([]);
            }
        })();
        return () => { alive = false; };
    }, [targetChar]);

    /**
     * 按天分组，天内把三种东西按时间混在一条轴上。
     *
     * 日程只有「今天」那一份（IndexedDB 按天存），所以只给今天铺底；
     * 心跳和手机动静各自带绝对时间，哪天的就落到哪天。
     */
    const days = useMemo(() => {
        const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        const byDay = new Map<string, { label: string; entries: ChronicleEntry[]; phone: PhoneEvent[] }>();
        const ensure = (at: string | number) => {
            const key = dayKey(typeof at === 'number' ? new Date(at).toISOString() : at);
            if (!byDay.has(key)) {
                byDay.set(key, {
                    label: fmtDay(typeof at === 'number' ? new Date(at).toISOString() : at),
                    entries: [],
                    phone: [],
                });
            }
            return byDay.get(key)!;
        };
        for (const entry of sorted) ensure(entry.at).entries.push(entry);
        for (const event of phoneEvents) ensure(event.at).phone.push(event);

        const todayKey = new Date().toDateString();
        return [...byDay.entries()]
            .sort((a, b) => Date.parse(b[1].entries[0]?.at ?? new Date(b[1].phone[0]?.at ?? 0).toISOString())
                - Date.parse(a[1].entries[0]?.at ?? new Date(a[1].phone[0]?.at ?? 0).toISOString()))
            .map(([key, day]) => {
                const rows: DayRow[] = [
                    ...toSegments(day.entries).map(segment => ({ at: Date.parse(segmentAt(segment)), segment })),
                    ...day.phone.map(event => ({ at: event.at, phone: event })),
                ];
                if (key === todayKey && slots.length > 0) {
                    const dayDate = new Date(day.entries[0]?.at ?? day.phone[0]?.at ?? Date.now());
                    for (const slot of slots) {
                        const at = slotTimestamp(dayDate, slot.startTime);
                        // 当前时段之后的日程还没发生，不该出现在起居注里——那是计划，不是记录。
                        if (at <= Date.now()) rows.push({ at, slot });
                    }
                }
                return { key, label: day.label, rows: rows.sort((a, b) => b.at - a.at) };
            });
    }, [entries, phoneEvents, slots]);

    return (
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-1 pb-28 overscroll-contain">
            <p className="text-[11px] text-white/45 leading-relaxed px-1 mb-1">
                TA 自己醒来的时候做了什么。不是发给你的消息——是你偷看到的。
            </p>
            {offline && (
                <p className="text-[10px] text-white/25 px-1 mb-2">连不上后台，下面是上次看到的。</p>
            )}

            {entries.length === 0 && (
                <div className="flex flex-col items-center justify-center h-64 text-white/30 gap-3">
                    <PencilSimpleLine size={42} weight="light" />
                    <span className="text-xs">还没有记录</span>
                    <span className="text-[10px] text-white/20 px-10 text-center leading-relaxed">
                        在设置 → Mac mini 后端 → 角色心跳里给 TA 开启之后，这里才会有东西。
                    </span>
                </div>
            )}

            {days.map(day => (
                <section key={day.key} className="mt-4">
                    {/* 日子：轴上的一个刻度，不是一张卡片 */}
                    <div className="flex items-center gap-2.5 mb-1">
                        <span className="text-[11px] tracking-[0.25em] text-white/40" style={{ fontFamily: SERIF }}>
                            {day.label}
                        </span>
                        <div className="flex-1 h-px bg-white/[0.07]" />
                    </div>

                    <div className="relative pl-[26px]">
                        {/* 轴线：从第一个点延到最后一个点，不要在段落之间断开 */}
                        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-white/[0.14] via-white/[0.09] to-transparent" />

                        {day.rows.map((row, index) => 'phone' in row ? (
                            /* 手机上的动静：TA 做过的事，但不是冲着阿萌来的 */
                            <div key={`phone-${row.phone.id}`} className="relative py-1.5">
                                <span className="absolute -left-[25px] top-[9px] w-[5px] h-[5px] rounded-[1px] bg-white/30" />
                                <div className="flex items-baseline gap-2">
                                    <span className="text-[10px] tabular-nums text-white/30 shrink-0">
                                        {fmtClock(new Date(row.at).toISOString())}
                                    </span>
                                    <span className="text-[11px] text-white/40 truncate">{row.phone.label}</span>
                                </div>
                            </div>
                        ) : 'slot' in row ? (
                            /* 日程：这一天的底子，淡一些——它是背景，不是 TA 主动做的事 */
                            <div key={`slot-${row.at}-${index}`} className="relative py-1.5">
                                <span className="absolute -left-[24px] top-[10px] w-[3px] h-[3px] rounded-full bg-white/20" />
                                <div className="flex items-baseline gap-2">
                                    <span className="text-[10px] tabular-nums text-white/25 shrink-0">
                                        {row.slot.startTime}
                                    </span>
                                    <span className="text-[11px] text-white/35 truncate">
                                        {row.slot.activity}
                                        {row.slot.location && <span className="text-white/20"> · {row.slot.location}</span>}
                                    </span>
                                </div>
                            </div>
                        ) : row.segment.kind === 'quiet' ? (
                            <div key={`quiet-${row.at}-${index}`} className="relative py-2">
                                {/* 空心小点：想起过你，但没出声 */}
                                <span className="absolute -left-[26px] top-[13px] w-[7px] h-[7px] rounded-full border border-white/20" />
                                <p className="text-[10px] text-white/25 leading-relaxed">
                                    这中间 {row.segment.count} 次没出声
                                    <span className="text-white/15">（{row.segment.gates.join('、')}）</span>
                                </p>
                            </div>
                        ) : (
                            <div key={row.segment.entry.id} className="relative pb-4 animate-fade-in">
                                {/* 实心点：TA 自己想起你的那一刻 */}
                                <span
                                    className="absolute -left-[26px] top-[7px] w-[9px] h-[9px] rounded-full"
                                    style={{ background: accent, boxShadow: `0 0 0 3px ${accent}22` }}
                                />
                                <div className="flex items-baseline gap-2">
                                    <span className="text-[11px] tabular-nums text-white/40 shrink-0">
                                        {fmtClock(row.segment.entry.at)}
                                    </span>
                                    {row.segment.entry.shadow && (
                                        <span className="text-[9px] px-1.5 py-[1px] rounded-full tracking-wider shrink-0"
                                            style={{ color: accent, background: `${accent}1a` }}>
                                            试跑
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-[14px] font-light text-white/90 leading-relaxed" style={{ fontFamily: SERIF }}>
                                    {row.segment.entry.activity || '（什么都没记下来）'}
                                </p>
                                {row.segment.entry.proposedText && (
                                    <p className="mt-2 text-[12px] text-white/50 leading-relaxed pl-2.5 border-l"
                                        style={{ borderColor: `${accent}44` }}>
                                        想跟你说：「{row.segment.entry.proposedText}」
                                        {row.segment.entry.shadow && <span className="text-white/25">　没有真的发出去</span>}
                                    </p>
                                )}
                                {row.segment.entry.reason && (() => {
                                    const id = row.segment.entry.id;
                                    const open = openInner[id] === true;
                                    return <>
                                        <button
                                            onClick={() => setOpenInner(prev => ({ ...prev, [id]: !open }))}
                                            className="mt-1.5 flex items-center gap-1 text-[10px] text-white/30 active:scale-95 transition"
                                        >
                                            <CaretDown size={9} weight="bold" className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
                                            心声
                                        </button>
                                        {open && (
                                            <p className="mt-1 text-[11px] text-white/45 leading-relaxed italic" style={{ fontFamily: SERIF }}>
                                                {row.segment.entry.reason}
                                            </p>
                                        )}
                                    </>;
                                })()}
                            </div>
                        ))}
                    </div>
                </section>
            ))}

            <button
                onClick={() => void refresh()}
                disabled={loading}
                className="mx-auto mt-6 flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] text-white/60 active:scale-95 transition disabled:opacity-40"
            >
                <ArrowsClockwise size={12} weight="bold" className={loading ? 'animate-spin' : ''} />
                {loading ? '读取中' : '去后台看看新的'}
            </button>
        </div>
    );
}
// [EM-END: agent-backend-chronicle]
