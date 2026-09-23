// [EM-START: agent-backend-chronicle]
/**
 * 起居注 —— 「查手机」里的一页：TA 每次自己醒来，做了什么。
 *
 * 这一页天然契合「查手机」的设定：你看到的是 TA 的活动记录，
 * 不是 TA 特地发给你的消息。所以它不推送、不进聊天，只躺在这里等你翻。
 *
 * 试跑期（影子运行）的条目会标「试跑」：那些话角色想说，但没有真的发出来。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwise, MoonStars, PencilSimpleLine } from '@phosphor-icons/react';

import type { CharacterProfile } from '../../types';
import { AgentBackend, isAgentPaired } from '../../utils/emAgentBackend';
import { loadChronicle, mergeChronicle, type ChronicleEntry } from '../../utils/emAgentActivity';

/** 闸门名字翻成人话。起居注里最常见的就是这几条。 */
const GATE_LABELS: Record<string, string> = {
    paused: '被按了暂停',
    no_snapshot: '还不知道最近怎么样',
    sleeping: '在睡觉',
    active_chat: '正和你说着话',
    message_cooldown: '刚说过话，先歇着',
    daily_budget: '今天想得够多了',
};

const fmtTime = (at: string) =>
    new Date(at).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

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
            const incoming: ChronicleEntry[] = runs.map(run => ({
                id: run.id,
                charId: run.charId,
                activity: run.activity,
                outcome: run.outcome,
                skipGate: run.skipGate,
                proposedText: run.proposedText,
                shadow: run.shadow,
                at: run.startedAt,
            }));
            setEntries(mergeChronicle(targetChar.id, incoming));
            setOffline(false);
        } catch {
            // 取不到就翻本地那份副本：后台不在线是常态，不是故障。
            setOffline(true);
        } finally {
            setLoading(false);
        }
    }, [targetChar.id]);

    useEffect(() => { void refresh(); }, [refresh]);

    // 被闸门拦下的那些不算「活动」：TA 只是醒了一下又睡回去，没做什么值得记的事。
    // 但一条都不显示的话，这一页在角色安静的日子里会空得像坏了，所以单独排在后面。
    const acted = entries.filter(entry => entry.outcome !== 'skipped' && entry.outcome !== 'error');
    const skipped = entries.filter(entry => entry.outcome === 'skipped');

    return (
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-1 pb-28 overscroll-contain">
            <div className="rounded-xl px-3 py-2 mb-3 bg-white/[0.04] border border-white/[0.07]">
                <p className="text-[11px] text-white/55 leading-relaxed">
                    TA 自己醒来的时候做了什么。不是发给你的消息——是你偷看到的。
                </p>
            </div>

            {offline && (
                <p className="text-[10px] text-white/30 mb-3 px-1">
                    现在连不上后台，下面是上次看到的。
                </p>
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

            <div className="space-y-2.5">
                {acted.map(entry => (
                    <div key={entry.id} className="rounded-2xl p-4 bg-white/[0.035] border border-white/[0.06] animate-fade-in">
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                            {entry.shadow && (
                                <span className="text-[9px] px-2 py-0.5 rounded-full tracking-wider shrink-0"
                                    style={{ color: accent, background: `${accent}1f` }}>
                                    试跑
                                </span>
                            )}
                            <span className="text-[9px] text-white/30 tabular-nums ml-auto shrink-0">{fmtTime(entry.at)}</span>
                        </div>
                        <p className="text-[14px] font-light text-white leading-relaxed"
                            style={{ fontFamily: "'Shippori Mincho','Noto Sans SC',serif" }}>
                            {entry.activity || '（什么都没记下来）'}
                        </p>
                        {entry.proposedText && (
                            <p className="mt-2 text-[12px] text-white/55 leading-relaxed border-l-2 pl-2.5"
                                style={{ borderColor: `${accent}55` }}>
                                想跟你说：「{entry.proposedText}」
                                {entry.shadow && <span className="text-white/25">（没有真的发出去）</span>}
                            </p>
                        )}
                    </div>
                ))}

                {skipped.length > 0 && (
                    <>
                        <p className="text-[10px] text-white/25 pt-3 pb-1 px-1 tracking-wider">醒了一下，又睡回去了</p>
                        {skipped.slice(0, 20).map(entry => (
                            <div key={entry.id} className="flex items-center gap-2.5 px-1 py-1.5">
                                <MoonStars size={12} weight="light" className="shrink-0 text-white/25" />
                                <span className="text-[11px] text-white/35 flex-1 truncate">
                                    {GATE_LABELS[entry.skipGate || ''] || entry.skipGate || '没动静'}
                                </span>
                                <span className="text-[9px] text-white/20 tabular-nums shrink-0">{fmtTime(entry.at)}</span>
                            </div>
                        ))}
                    </>
                )}
            </div>

            <button
                onClick={() => void refresh()}
                disabled={loading}
                className="mx-auto mt-5 flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] text-white/60 active:scale-95 transition disabled:opacity-40"
            >
                <ArrowsClockwise size={12} weight="bold" className={loading ? 'animate-spin' : ''} />
                {loading ? '读取中' : '去后台看看新的'}
            </button>
        </div>
    );
}
// [EM-END: agent-backend-chronicle]
