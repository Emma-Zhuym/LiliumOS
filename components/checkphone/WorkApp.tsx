// [EM-START: work-app]
/**
 * 工作 —— 「查手机」里的一页：TA 在工作群里、和同事私聊、邮件里说了什么，以及手头正在推进的事。
 *
 * 你在这里是翻 TA 手机的人：看得到往来和进展，但翻看本身不会改变任何事——
 * 打开一封邮件不等于 TA 读过，看完一件事也不等于 TA 处理了。所以这一页只读，没有回复框、没有已读回执。
 *
 * 和「联系人 / 短信」是两条独立的线：同事大多只在这里出现，关系好到私下也联系的才会进通讯录。
 * 内容来自 Mac mini 上心跳的工作往来（见 docs/agent-backend-design.md 4.5），打开 App 时取回，
 * 不用后台在线也能翻已经取回来的那些。
 */

import React, { useMemo, useState } from 'react';
import { Briefcase, CaretLeft, EnvelopeSimple, UsersThree, User } from '@phosphor-icons/react';

import type { CharacterWorkState, WorkMessage, WorkThread } from '../../types';
import {
    channelMessages, formatWorkTime, listChannels, listThreads, type WorkChannelSummary,
} from '../../utils/emWork';

interface Props {
    work: CharacterWorkState | undefined;
    accent: string;
    charName: string;
}

type Tab = 'messages' | 'threads';

/** 两句话隔了这么久，中间插一个时间，读起来能分出「上午的事」和「下午的事」。 */
const TIME_GAP_MS = 30 * 60 * 1000;

const KIND_META: Record<WorkChannelSummary['kind'], { label: string; icon: React.ReactNode; tint: string }> = {
    group: { label: '群聊', icon: <UsersThree size={18} weight="fill" />, tint: '#6ea8ff' },
    dm: { label: '私聊', icon: <User size={18} weight="fill" />, tint: '#94a3b8' },
    email: { label: '邮件', icon: <EnvelopeSimple size={18} weight="fill" />, tint: '#e0b26a' },
};

const Empty: React.FC<{ text: string }> = ({ text }) => (
    <div className="flex flex-col items-center justify-center gap-2 px-8 pt-24 text-center">
        <Briefcase size={30} weight="light" className="text-white/25" />
        <p className="text-[12px] leading-relaxed text-white/40">{text}</p>
    </div>
);

const WorkApp: React.FC<Props> = ({ work, accent, charName }) => {
    const [tab, setTab] = useState<Tab>('messages');
    const [openChannel, setOpenChannel] = useState<string | null>(null);
    const [openThread, setOpenThread] = useState<string | null>(null);

    const channels = useMemo(() => listChannels(work), [work]);
    const threads = useMemo(() => listThreads(work), [work]);
    const openCount = threads.filter(thread => thread.status === 'open').length;

    const BackRow: React.FC<{ label: string; onBack: () => void; right?: React.ReactNode }> = ({ label, onBack, right }) => (
        <div className="flex shrink-0 items-center gap-2 px-4 pt-1 pb-2">
            <button onClick={onBack} aria-label="返回" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-white/70 active:scale-90 transition">
                <CaretLeft size={16} weight="bold" />
            </button>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-white/90">{label}</span>
            {right}
        </div>
    );

    // ── 一个会话里的往来 ──────────────────────────────────────────
    if (openChannel) {
        const summary = channels.find(channel => channel.key === openChannel);
        const messages = channelMessages(work, openChannel);
        const isEmail = summary?.kind === 'email';
        const withTimes = messages.map((message, index) => ({
            message,
            showTime: index === 0 || message.at - messages[index - 1].at > TIME_GAP_MS,
        }));
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <BackRow
                    label={summary?.title ?? '会话'}
                    onBack={() => setOpenChannel(null)}
                    right={summary && <span className="text-[10px] text-white/35">{KIND_META[summary.kind].label} · {summary.count} 句</span>}
                />
                <div className="flex-1 overflow-y-auto px-4 pb-24 no-scrollbar overscroll-contain">
                    {isEmail && (
                        <div className="mb-3 rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3.5">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">主题</div>
                            <div className="mt-1 text-[14px] font-semibold text-white/90">{summary?.title}</div>
                        </div>
                    )}
                    <div className="space-y-2">
                        {withTimes.map(({ message, showTime }) => (
                            <React.Fragment key={message.id}>
                                {showTime && (
                                    <div className="pt-2 text-center text-[10px] tabular-nums text-white/30">{formatWorkTime(message.at)}</div>
                                )}
                                {isEmail
                                    ? <MailBlock message={message} accent={accent} />
                                    : <Bubble message={message} showName={summary?.kind === 'group'} accent={accent} />}
                            </React.Fragment>
                        ))}
                    </div>
                    <p className="mt-6 text-center text-[10px] text-white/25">你在翻 {charName} 的手机，这里只读</p>
                </div>
            </div>
        );
    }

    // ── 一件事的来龙去脉 ──────────────────────────────────────────
    // 事项找不到（比如被清理掉了）就直接落回首页，不在渲染里改 state。
    const thread = openThread ? threads.find(item => item.id === openThread) : undefined;
    if (thread) {
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <BackRow label={thread.title} onBack={() => setOpenThread(null)} right={<StatusChip status={thread.status} accent={accent} />} />
                <div className="flex-1 overflow-y-auto px-4 pb-24 no-scrollbar overscroll-contain">
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3.5">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">最新进展</div>
                        <p className="mt-1 text-[13px] leading-relaxed text-white/85">{thread.summary || '（还没有记录）'}</p>
                    </div>
                    {thread.history.length > 0 && (
                        <div className="mt-4">
                            <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/35">一路走来</div>
                            <ol className="relative ml-1.5 space-y-3 border-l border-white/[0.08] pl-4">
                                {thread.history.map((entry, index) => (
                                    <li key={`${entry.at}-${index}`} className="relative">
                                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full" style={{ background: index === thread.history.length - 1 ? accent : 'rgba(255,255,255,0.25)' }} />
                                        <div className="text-[10px] tabular-nums text-white/30">{formatWorkTime(entry.at)}</div>
                                        <p className="text-[12.5px] leading-relaxed text-white/75">{entry.text}</p>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── 首页：消息 / 事项 ─────────────────────────────────────────
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 px-4 pt-1 pb-3">
                <div className="flex rounded-xl bg-white/[0.05] p-0.5">
                    {([['messages', `消息 ${channels.length || ''}`], ['threads', `事项 ${openCount || ''}`]] as const).map(([id, label]) => (
                        <button key={id} onClick={() => setTab(id)}
                            className={`flex-1 rounded-[10px] py-1.5 text-[12px] font-semibold transition ${tab === id ? 'text-white' : 'text-white/45'}`}
                            style={tab === id ? { background: accent } : undefined}>
                            {label.trim()}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-24 no-scrollbar overscroll-contain">
                {tab === 'messages' && (channels.length === 0
                    ? <Empty text={`${charName} 还没有工作上的往来。开着心跳的话，TA 上班的时候会自然产生——群里的讨论、同事的私聊、邮件，都会出现在这里。`} />
                    : <div className="space-y-2.5">{channels.map(channel => (
                        <button key={channel.key} onClick={() => setOpenChannel(channel.key)}
                            className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3.5 text-left active:scale-[0.99] transition">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
                                style={{ background: `${KIND_META[channel.kind].tint}33`, color: KIND_META[channel.kind].tint }}>
                                {KIND_META[channel.kind].icon}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <span className="truncate text-[13.5px] font-semibold text-white/95">{channel.title}</span>
                                    <span className="ml-auto shrink-0 text-[10px] tabular-nums text-white/30">{formatWorkTime(channel.last.at)}</span>
                                </span>
                                <span className="mt-0.5 block truncate text-[11.5px] text-white/45">
                                    {channel.kind === 'group' ? `${channel.last.mine ? '我' : channel.last.from}：` : ''}{channel.last.text}
                                </span>
                            </span>
                        </button>
                    ))}</div>)}

                {tab === 'threads' && (threads.length === 0
                    ? <Empty text="还没有正在推进的事。TA 手头有了要跟进的工作，会记在这里，一步步的进展都翻得到。" />
                    : <div className="space-y-2.5">{threads.map(thread => (
                        <ThreadRow key={thread.id} thread={thread} accent={accent} onOpen={() => setOpenThread(thread.id)} />
                    ))}</div>)}
            </div>
        </div>
    );
};

const StatusChip: React.FC<{ status: WorkThread['status']; accent: string }> = ({ status, accent }) => (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={status === 'open' ? { background: `${accent}26`, color: accent } : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }}>
        {status === 'open' ? '进行中' : '已完成'}
    </span>
);

const ThreadRow: React.FC<{ thread: WorkThread; accent: string; onOpen: () => void }> = ({ thread, accent, onOpen }) => (
    <button onClick={onOpen}
        className={`w-full rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3.5 text-left active:scale-[0.99] transition ${thread.status === 'done' ? 'opacity-55' : ''}`}>
        <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-white/95">{thread.title}</span>
            <span className="ml-auto"><StatusChip status={thread.status} accent={accent} /></span>
        </span>
        <span className="mt-1 block text-[11.5px] leading-relaxed text-white/50 line-clamp-2">{thread.summary || '—'}</span>
        <span className="mt-1.5 block text-[10px] tabular-nums text-white/25">{formatWorkTime(thread.updatedAt)} · {thread.history.length} 步</span>
    </button>
);

const Bubble: React.FC<{ message: WorkMessage; showName: boolean; accent: string }> = ({ message, showName, accent }) => (
    <div className={`flex flex-col ${message.mine ? 'items-end' : 'items-start'}`}>
        {showName && !message.mine && <span className="mb-0.5 ml-1 text-[10px] text-white/40">{message.from}</span>}
        <div className={`max-w-[80%] px-3 py-2 text-[13px] leading-relaxed ${message.mine ? 'rounded-2xl rounded-tr-md text-white' : 'rounded-2xl rounded-tl-md bg-white/[0.07] text-white/90'}`}
            style={message.mine ? { background: accent } : undefined}>
            {message.text}
        </div>
    </div>
);

const MailBlock: React.FC<{ message: WorkMessage; accent: string }> = ({ message, accent }) => (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3.5">
        <div className="mb-1 flex items-center gap-2">
            <span className="text-[12px] font-semibold" style={{ color: message.mine ? accent : 'rgba(255,255,255,0.8)' }}>{message.mine ? '我（回信）' : message.from}</span>
            <span className="ml-auto text-[10px] tabular-nums text-white/30">{formatWorkTime(message.at)}</span>
        </div>
        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/75">{message.text}</p>
    </div>
);

export default WorkApp;
// [EM-END: work-app]
