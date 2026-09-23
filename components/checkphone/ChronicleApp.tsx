// [EM-START: agent-backend-chronicle]
/**
 * 起居注 —— 「查手机」里的一页：TA 每次自己醒来，做了什么。
 *
 * 这一页天然契合「查手机」的设定：你看到的是 TA 的活动记录，
 * 不是 TA 特地发给你的消息。所以它不推送、不进聊天，只躺在这里等你翻。
 *
 * 做成一条时间轴而不是一叠卡片：起居注记的是「一天是怎么过的」，
 * 顺序和间隔本身就是内容。被闸门拦下的那些醒来不单独占一格，
 * 而是缩成轴上的一段灰线（「醒了 3 次又睡回去」）——既保住了时序，
 * 又不会让安静的一天刷满「没动静」。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowsClockwise, PencilSimpleLine } from '@phosphor-icons/react';

import type { CharacterProfile } from '../../types';
import { AgentBackend, isAgentPaired } from '../../utils/emAgentBackend';
import {
    loadChronicle, mergeChronicle, toSegments,
    type ChronicleEntry, type ChronicleSegment,
} from '../../utils/emAgentActivity';

const SERIF = "'Shippori Mincho','Noto Serif SC',serif";

const fmtClock = (at: string) =>
    new Date(at).toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit', hour12: true });

const dayKey = (at: string) => new Date(at).toDateString();

const fmtDay = (at: string) => {
    const date = new Date(at);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    if (date.toDateString() === today.toDateString()) return '今天';
    if (date.toDateString() === yesterday.toDateString()) return '昨天';
    return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
};

interface Props {
    targetChar: CharacterProfile;
    accent: string;
}

export default function ChronicleApp({ targetChar, accent }: Props) {
    const [entries, setEntries] = useState<ChronicleEntry[]>(() => loadChronicle(targetChar.id));
    const [loading, setLoading] = useState(false);
    const [offline, setOffline] = useState(false);

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

    /** 先按天分组，天内再折成轴上的段落。 */
    const days = useMemo(() => {
        const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        const grouped: { key: string; label: string; segments: ChronicleSegment[] }[] = [];
        for (const entry of sorted) {
            const key = dayKey(entry.at);
            if (grouped[grouped.length - 1]?.key !== key) {
                grouped.push({ key, label: fmtDay(entry.at), segments: [] });
            }
            grouped[grouped.length - 1].segments.push({ kind: 'entry', entry });
        }
        return grouped.map(day => ({ ...day, segments: toSegments(day.segments.map(s => (s as { entry: ChronicleEntry }).entry)) }));
    }, [entries]);

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

                        {day.segments.map((segment, index) => segment.kind === 'quiet' ? (
                            <div key={`quiet-${segment.at}-${index}`} className="relative py-2">
                                {/* 空心小点：醒过，但没做什么 */}
                                <span className="absolute -left-[26px] top-[13px] w-[7px] h-[7px] rounded-full border border-white/20" />
                                <p className="text-[10px] text-white/25 leading-relaxed">
                                    醒了 {segment.count} 次又睡回去了
                                    <span className="text-white/15">（{segment.gates.join('、')}）</span>
                                </p>
                            </div>
                        ) : (
                            <div key={segment.entry.id} className="relative pb-4 animate-fade-in">
                                {/* 实心点：这次真做了什么 */}
                                <span
                                    className="absolute -left-[26px] top-[7px] w-[9px] h-[9px] rounded-full"
                                    style={{ background: accent, boxShadow: `0 0 0 3px ${accent}22` }}
                                />
                                <div className="flex items-baseline gap-2">
                                    <span className="text-[11px] tabular-nums text-white/40 shrink-0">
                                        {fmtClock(segment.entry.at)}
                                    </span>
                                    {segment.entry.shadow && (
                                        <span className="text-[9px] px-1.5 py-[1px] rounded-full tracking-wider shrink-0"
                                            style={{ color: accent, background: `${accent}1a` }}>
                                            试跑
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-[14px] font-light text-white/90 leading-relaxed" style={{ fontFamily: SERIF }}>
                                    {segment.entry.activity || '（什么都没记下来）'}
                                </p>
                                {segment.entry.proposedText && (
                                    <p className="mt-2 text-[12px] text-white/50 leading-relaxed pl-2.5 border-l"
                                        style={{ borderColor: `${accent}44` }}>
                                        想跟你说：「{segment.entry.proposedText}」
                                        {segment.entry.shadow && <span className="text-white/25">　没有真的发出去</span>}
                                    </p>
                                )}
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
