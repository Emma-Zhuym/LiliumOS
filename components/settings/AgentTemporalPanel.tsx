// [EM-START: calendar-temporal]
/**
 * 「角色能看到我哪些日历」设置。
 *
 * 逐个日历 / 提醒清单选档：不给看 / 只知道我在忙 / 能看到标题。**默认全都是不给看**——
 * 接上桥接不等于同意把整个日历摊给角色，得一个个点开才算。
 *
 * 列日历那一下要真去问 macOS（EventKit 二十多秒），所以只在打开这一页时问一次，
 * 之后靠「重新列一遍」手动刷。同步本身是 mini 每天自己跑的，这里只提供「立刻同步」。
 *
 * 外观跟随系统设置整页的上游风格（白卡 + slate），不用 Clay tokens。
 */

import React, { useCallback, useEffect, useState } from 'react';

import { useOS } from '../../context/OSContext';
import { AgentBackend, isAgentPaired, type TemporalLevel, type TemporalVisibility } from '../../utils/emAgentBackend';
import { LEVELS, LEVEL_LABELS, emptyVisibility, hasOpenSource, levelOf, saveTemporalCache, syncText } from '../../utils/emTemporal';
import Modal from '../os/Modal';

const BTN = 'px-3 py-2 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 shadow-sm active:scale-95 transition-all disabled:opacity-50';

interface Props {
    open: boolean;
    onClose: () => void;
}

export default function AgentTemporalPanel({ open, onClose }: Props) {
    const { addToast } = useOS();
    const [visibility, setVisibility] = useState<TemporalVisibility>(emptyVisibility);
    const [sources, setSources] = useState<{ calendars: string[]; lists: string[] } | null>(null);
    const [sync, setSync] = useState<{ lastAt?: string; lastError?: string | null; count?: number }>({});
    const [loading, setLoading] = useState(false);
    const [listing, setListing] = useState(false);
    const [busy, setBusy] = useState(false);

    /** 先读缓存里的设置（快），再去问有哪些日历（慢）。 */
    const load = useCallback(async () => {
        if (!isAgentPaired()) return;
        setLoading(true);
        try {
            const snapshot = await AgentBackend.temporal();
            setVisibility(snapshot.visibility ?? emptyVisibility());
            setSync(snapshot.sync ?? {});
            saveTemporalCache(snapshot);
        } catch {
            // mini 睡着时保持空白，下面会提示连不上
        } finally {
            setLoading(false);
        }
    }, []);

    const listSources = useCallback(async () => {
        if (!isAgentPaired()) return;
        setListing(true);
        try {
            setSources(await AgentBackend.temporalSources());
        } catch (error) {
            addToast(error instanceof Error ? error.message : '列日历失败', 'error');
        } finally {
            setListing(false);
        }
    }, [addToast]);

    useEffect(() => {
        if (!open) return;
        void load();
        void listSources();
    }, [open, load, listSources]);

    const setLevel = async (kind: 'calendars' | 'lists', name: string, level: TemporalLevel) => {
        const next: TemporalVisibility = {
            calendars: { ...visibility.calendars },
            lists: { ...visibility.lists },
        };
        next[kind][name] = level;
        setVisibility(next);
        setBusy(true);
        try {
            setVisibility(await AgentBackend.putTemporalVisibility(next));
        } catch (error) {
            addToast(error instanceof Error ? error.message : '没存上，再试一次', 'error');
            await load();
        } finally {
            setBusy(false);
        }
    };

    const handleRefresh = async () => {
        setBusy(true);
        try {
            await AgentBackend.refreshTemporal();
            addToast('已排入同步，一会儿再回来看', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '排任务失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    const renderGroup = (kind: 'calendars' | 'lists', title: string, names: string[]) => (
        <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 px-1">{title}</p>
            {names.length === 0 && <p className="text-[10px] text-slate-400 px-1">没有可选的{title}。</p>}
            {names.map(name => {
                const current = levelOf(visibility, kind === 'calendars' ? 'event' : 'reminder', name);
                return (
                    <div key={name} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 space-y-2">
                        <p className="text-[11px] font-bold text-slate-600 truncate">{name}</p>
                        <div className="grid grid-cols-3 gap-1.5">
                            {LEVELS.map(level => (
                                <button
                                    key={level}
                                    disabled={busy}
                                    onClick={() => void setLevel(kind, name, level)}
                                    className={`py-2 rounded-xl text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50 ${current === level
                                        ? 'bg-violet-500 text-white shadow-sm'
                                        : 'bg-white border border-slate-200 text-slate-500'}`}
                                >
                                    {LEVEL_LABELS[level]}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    return (
        <Modal isOpen={open} title="角色能看到我哪些日历" onClose={onClose}>
            <div className="space-y-4">
                <p className="text-[10px] text-slate-400 leading-relaxed">
                    默认一个都不给看。选「能看到标题」，角色就知道你周几上什么课；选「只知道我在忙」，
                    角色只知道那段时间你没空，不知道在做什么。Mac mini 每天自己同步一次。
                </p>

                {!isAgentPaired() && (
                    <p className="text-[10px] text-amber-600 leading-relaxed px-1">先在上面配对 Mac mini 后端。</p>
                )}

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">{syncText(sync)}</span>
                        <span className="text-slate-400">{typeof sync.count === 'number' ? `${sync.count} 条` : ''}</span>
                    </div>
                    {!hasOpenSource(visibility) && (
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                            一个日历都没开，所以后端根本不去读——选一个再同步。
                        </p>
                    )}
                    {sync.lastError && <p className="text-[10px] text-amber-600 leading-relaxed">上次同步出错：{sync.lastError}</p>}
                </div>

                {loading || listing ? (
                    <p className="text-xs text-slate-400 px-1">{listing ? '正在问 macOS 有哪些日历（要二十多秒）…' : '读取中…'}</p>
                ) : sources ? (
                    <>
                        {renderGroup('calendars', '日历', sources.calendars)}
                        {renderGroup('lists', '提醒清单', sources.lists)}
                    </>
                ) : (
                    <p className="text-xs text-slate-400 px-1">没列到日历。mini 可能在休眠，或者桥接没开。</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                    <button disabled={busy || listing} onClick={() => void listSources()} className={BTN}>重新列一遍</button>
                    <button disabled={busy || !hasOpenSource(visibility)} onClick={() => void handleRefresh()} className={`${BTN} text-violet-600 border-violet-200`}>立刻同步</button>
                </div>
            </div>
        </Modal>
    );
}
// [EM-END: calendar-temporal]
