// [EM-START: agent-backend-heartbeat-panel]
/**
 * 心跳设置（阶段 1c · 影子运行）。
 *
 * 影子期的意思是：角色照常醒来、照常判断、照常动脑，但**不会真的发消息**，
 * 只把「本来想说什么」记下来给阿萌看。觉得语气和判断都对了，再开真实执行（1d）。
 *
 * 这一页做四件事：把角色登记到后端、把这台手机上的角色 API 同步过去、
 * 开关心跳、看试跑记录。
 */

import React, { useCallback, useEffect, useState } from 'react';

import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { resolveCharacterApiConfig } from '../../utils/characterApi';
import { buildCharacterSnapshot } from '../../utils/emAgentSnapshot';
import {
    AgentBackend,
    flushSnapshotUpload,
    isAgentPaired,
    type AgentCharacter,
    type AgentModelRun,
} from '../../utils/emAgentBackend';
import Modal from '../os/Modal';

/** 平均醒来间隔的可选档位（后端只收 30–480）。实际每一跳会在平均值上下浮动，见下方 rangeText。 */
const EVERY_MIN_OPTIONS = [30, 45, 60, 90, 120, 180, 240];
const DEFAULT_JITTER_SPREAD = 0.5;

/** 与「Mac mini 后端」区块同一套按钮长相。 */
const BTN = 'px-3 py-2 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 shadow-sm active:scale-95 transition-all disabled:opacity-50';

/** 闸门名字翻成人话：影子记录里最常看到的就是这些。 */
const GATE_LABELS: Record<string, string> = {
    paused: '已暂停',
    no_snapshot: '还没收到近况',
    sleeping: 'TA 在睡觉',
    active_chat: '你们正在聊天',
    message_cooldown: '离上次主动消息太近',
    daily_budget: '今天想得够多了',
};

const OUTCOME_LABELS: Record<string, string> = {
    noop: '想了想，没说话',
    message: '想跟你说句话',
    task: '想顺手做件事',
    skipped: '没动脑',
    error: '出错了',
};

interface Props {
    open: boolean;
    onClose: () => void;
}

export default function AgentHeartbeatPanel({ open, onClose }: Props) {
    const { addToast, characters, apiConfig, userProfile } = useOS();
    const [backendChars, setBackendChars] = useState<AgentCharacter[]>([]);
    const [runs, setRuns] = useState<AgentModelRun[]>([]);
    const [shadow, setShadow] = useState(true);
    const [jitterSpread, setJitterSpread] = useState(DEFAULT_JITTER_SPREAD);
    const [busy, setBusy] = useState(false);
    const [loaded, setLoaded] = useState(false);

    const refresh = useCallback(async () => {
        if (!isAgentPaired()) return;
        try {
            const [list, audit, status] = await Promise.all([
                AgentBackend.characters(),
                AgentBackend.audit(undefined, 30),
                AgentBackend.status(),
            ]);
            setBackendChars(list);
            setRuns(audit);
            setShadow(status.heartbeat?.shadow !== false);
            setJitterSpread(status.heartbeat?.jitterSpread ?? DEFAULT_JITTER_SPREAD);
        } catch {
            // 连不上就保持上一次的样子：mini 每天 4–7 点休眠是正常状态。
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => { if (open) void refresh(); }, [open, refresh]);

    const run = async (task: () => Promise<void>) => {
        setBusy(true);
        try {
            await task();
        } catch (error) {
            addToast(error instanceof Error ? error.message : '操作失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    /**
     * 把这个角色接到后端：登记 → 同步 API → 传一份近况。
     *
     * 三步都做完心跳才有可能真的跑起来；少了 API 后端调不动模型，
     * 少了近况后端会一直卡在「还没收到近况」这道闸上安静跳过。
     */
    const handleConnect = (charId: string) => run(async () => {
        const char = characters.find(item => item.id === charId);
        if (!char) return;

        /**
         * 心跳优先走「副 API」，和日程生成、情绪评估同一条便宜的路。
         *
         * 心跳绝大多数时候只换来一句「想了想，没说话」——每 15 分钟拿主模型买一次沉默太贵。
         * 角色没配副 API 时才回退到它的聊天 API（预设优先，否则主 API）。
         */
        const { apiConfig: chatApi } = resolveCharacterApiConfig(char, apiConfig);
        const secondary = char.proactiveConfig?.secondaryApi;
        const usingSecondary = Boolean(secondary?.baseUrl && secondary?.apiKey && secondary?.model);
        const resolved = usingSecondary ? secondary! : chatApi;
        if (!resolved.apiKey || !resolved.baseUrl || !resolved.model) {
            addToast('这个角色还没配好 API（地址 / Key / 模型）', 'error');
            return;
        }

        const ref = `char-${charId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
        await AgentBackend.putCredential({
            ref,
            baseUrl: resolved.baseUrl,
            model: resolved.model,
            apiKey: resolved.apiKey,
        });
        await AgentBackend.upsertCharacter({
            charId,
            displayName: char.name,
            runtime: 'api',
            credRef: ref,
        });

        const messages = await DB.getMessagesByCharId(charId);
        const ok = await flushSnapshotUpload(await buildCharacterSnapshot(char, messages, {
            userName: userProfile?.name,
        }));
        addToast(
            ok ? `已接上（${usingSecondary ? '副 API' : '聊天 API'}），近况也传过去了` : '已接上，但近况没传成功',
            ok ? 'success' : 'error',
        );
        await refresh();
    });

    const handleToggle = (charId: string, enabled: boolean) => run(async () => {
        await AgentBackend.upsertCharacter({ charId, heartbeatEnabled: enabled });
        addToast(enabled ? (shadow ? '心跳已开（影子试跑）' : '心跳已开') : '心跳已关', 'success');
        await refresh();
    });

    const handleEveryMin = (charId: string, minutes: number) => run(async () => {
        await AgentBackend.upsertCharacter({ charId, heartbeatEveryMin: minutes });
        addToast(`平均每 ${minutes} 分钟醒一次`, 'success');
        await refresh();
    });

    /** 「平均 60 分钟」实际是 30–90 之间随机——说清楚，免得看着像每小时整点报时。 */
    const rangeText = (everyMin: number) =>
        `${Math.max(1, Math.round(everyMin * (1 - jitterSpread)))}–${Math.round(everyMin * (1 + jitterSpread))} 分钟之间随机`;

    const backendOf = (charId: string) => backendChars.find(item => item.charId === charId);

    return <Modal isOpen={open} title={shadow ? '角色心跳 · 影子试跑' : '角色心跳'} onClose={onClose}>
        <div className="space-y-4">
            <p className="text-[10px] text-slate-400 leading-relaxed rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3">
                {shadow
                    ? '现在是试跑：角色会自己醒来、自己判断要不要找你，但不会真的发消息，只把想说的话记下来给你看。'
                    : '真实执行已开启：角色判断要说话时会真的发给你。'}
            </p>

            <div className="space-y-2">
                <p className="text-xs font-bold text-slate-500">角色</p>
                {characters.length === 0 && <p className="text-[11px] text-slate-400">还没有角色。</p>}
                {characters.map(char => {
                    const backend = backendOf(char.id);
                    const connected = Boolean(backend?.credRef);
                    return <div key={char.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3">
                        <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-slate-600">{char.name}</p>
                            <p className="text-[10px] text-slate-400">
                                {!connected ? '还没接到后端'
                                    : backend?.heartbeatPaused ? '已暂停'
                                        : backend?.heartbeatEnabled ? `平均每 ${backend.heartbeatEveryMin} 分钟醒一次（${rangeText(backend.heartbeatEveryMin)}）` : '心跳关着'}
                            </p>
                            {connected && (
                                <select
                                    value={backend?.heartbeatEveryMin}
                                    disabled={busy}
                                    onChange={event => void handleEveryMin(char.id, Number(event.target.value))}
                                    aria-label="心跳间隔"
                                    className="mt-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500 outline-none"
                                >
                                    {/* 后端里可能还留着旧的 90 之外的自定义值，也要能显示出来，不然下拉会莫名跳档。 */}
                                    {[...new Set([...EVERY_MIN_OPTIONS, backend?.heartbeatEveryMin ?? 60])].sort((a, b) => a - b).map(minutes => (
                                        <option key={minutes} value={minutes}>平均每 {minutes} 分钟</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <button disabled={busy} onClick={() => void handleConnect(char.id)} className={BTN}>
                                {connected ? '重新同步' : '接到后端'}
                            </button>
                            {connected && (
                                <button
                                    disabled={busy}
                                    onClick={() => void handleToggle(char.id, !backend?.heartbeatEnabled)}
                                    className={`${BTN} ${backend?.heartbeatEnabled ? 'text-red-500 border-red-200' : 'text-violet-600 border-violet-200'}`}
                                >
                                    {backend?.heartbeatEnabled ? '关掉' : '开启'}
                                </button>
                            )}
                        </div>
                    </div>;
                })}
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500">{shadow ? '试跑记录' : '最近几次醒来'}</p>
                    <button disabled={busy} onClick={() => void refresh()} className={BTN}>刷新</button>
                </div>
                {loaded && runs.length === 0 && (
                    <p className="text-[11px] text-slate-400">还没有记录。角色第一次醒来之后这里就会有东西。</p>
                )}
                <ul className="space-y-2">
                    {runs.map(item => (
                        <li key={item.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-600">
                                    {characters.find(char => char.id === item.charId)?.name || item.charId}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                    {OUTCOME_LABELS[item.outcome || ''] || item.outcome}
                                </span>
                            </div>
                            {item.outcome === 'skipped' && item.skipGate && (
                                <p className="mt-1 text-[10px] text-slate-400">{GATE_LABELS[item.skipGate] || item.skipGate}</p>
                            )}
                            {item.proposedText && (
                                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                                    「{item.proposedText}」{item.shadow ? '（试跑，没有真的发出去）' : ''}
                                </p>
                            )}
                            {item.reason && (
                                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{item.reason}</p>
                            )}
                            {item.error && <p className="mt-1 text-[10px] text-red-500">{item.error}</p>}
                            <p className="mt-1 text-[10px] text-slate-300">{new Date(item.startedAt).toLocaleString()}</p>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    </Modal>;
}
// [EM-END: agent-backend-heartbeat-panel]
