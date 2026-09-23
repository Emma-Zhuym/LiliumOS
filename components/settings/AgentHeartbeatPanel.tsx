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
import { Brain, CheckCircle, MoonStars } from '@phosphor-icons/react';

import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { F, R, S, STATUS } from '../../utils/clayTokens';
import { resolveCharacterApiConfig } from '../../utils/characterApi';
import { buildCharacterSnapshot } from '../../utils/emAgentSnapshot';
import {
    AgentBackend,
    flushSnapshotUpload,
    isAgentPaired,
    type AgentCharacter,
    type AgentModelRun,
} from '../../utils/emAgentBackend';
import ClayDialog from '../os/ClayDialog';

const buttonStyle = {
    minHeight: 44,
    background: F.surface,
    color: F.textPrimary,
    borderRadius: R.button,
    boxShadow: S.raisedSoft,
} as const;

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

        const { apiConfig: resolved } = resolveCharacterApiConfig(char, apiConfig);
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
        addToast(ok ? '已接上，近况也传过去了' : '已接上，但近况没传成功', ok ? 'success' : 'error');
        await refresh();
    });

    const handleToggle = (charId: string, enabled: boolean) => run(async () => {
        await AgentBackend.upsertCharacter({ charId, heartbeatEnabled: enabled });
        addToast(enabled ? '心跳已开（影子试跑）' : '心跳已关', 'success');
        await refresh();
    });

    const backendOf = (charId: string) => backendChars.find(item => item.charId === charId);

    return <ClayDialog isOpen={open} title="角色心跳 · 影子试跑" onClose={onClose}>
        <div className="space-y-4">
            <div className="flex items-start gap-2 p-3" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken }}>
                <Brain size={16} weight="bold" style={{ color: F.textSecondary, flexShrink: 0, marginTop: 2 }} />
                <p className="text-xs leading-relaxed" style={{ color: F.textSecondary }}>
                    {shadow
                        ? '现在是试跑：角色会自己醒来、自己判断要不要找你，但不会真的发消息，只把想说的话记下来给你看。'
                        : '真实执行已开启：角色判断要说话时会真的发给你。'}
                </p>
            </div>

            <div className="space-y-2">
                <p className="text-xs font-semibold">角色</p>
                {characters.length === 0 && (
                    <p className="text-xs" style={{ color: F.textTertiary }}>还没有角色。</p>
                )}
                {characters.map(char => {
                    const backend = backendOf(char.id);
                    const connected = Boolean(backend?.credRef);
                    return <div key={char.id} className="flex items-center justify-between gap-3 p-3" style={{ background: F.surfaceWarm, borderRadius: R.input }}>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{char.name}</p>
                            <p className="text-xs" style={{ color: F.textTertiary }}>
                                {!connected ? '还没接到后端'
                                    : backend?.heartbeatPaused ? '已暂停'
                                        : backend?.heartbeatEnabled ? `每 ${backend.heartbeatEveryMin} 分钟醒一次` : '心跳关着'}
                            </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <button disabled={busy} onClick={() => void handleConnect(char.id)} className="px-3 text-xs" style={buttonStyle}>
                                {connected ? '重新同步' : '接到后端'}
                            </button>
                            {connected && (
                                <button
                                    disabled={busy}
                                    onClick={() => void handleToggle(char.id, !backend?.heartbeatEnabled)}
                                    className="px-3 text-xs font-semibold"
                                    style={{ ...buttonStyle, color: backend?.heartbeatEnabled ? STATUS.danger.ink : F.textPrimary }}
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
                    <p className="text-xs font-semibold">试跑记录</p>
                    <button disabled={busy} onClick={() => void refresh()} className="px-3 text-xs" style={buttonStyle}>刷新</button>
                </div>
                {loaded && runs.length === 0 && (
                    <p className="text-xs" style={{ color: F.textTertiary }}>还没有记录。角色第一次醒来之后这里就会有东西。</p>
                )}
                <ul className="space-y-2">
                    {runs.map(item => (
                        <li key={item.id} className="p-3" style={{ background: F.surfaceWarm, borderRadius: R.input }}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold">
                                    {characters.find(char => char.id === item.charId)?.name || item.charId}
                                </span>
                                <span className="flex items-center gap-1 text-xs" style={{ color: F.textTertiary }}>
                                    {item.outcome === 'skipped'
                                        ? <MoonStars size={12} weight="bold" />
                                        : <CheckCircle size={12} weight="bold" />}
                                    {OUTCOME_LABELS[item.outcome || ''] || item.outcome}
                                </span>
                            </div>
                            {item.outcome === 'skipped' && item.skipGate && (
                                <p className="mt-1 text-xs" style={{ color: F.textSecondary }}>
                                    {GATE_LABELS[item.skipGate] || item.skipGate}
                                </p>
                            )}
                            {item.proposedText && (
                                <p className="mt-1 text-xs leading-relaxed" style={{ color: F.textPrimary }}>
                                    「{item.proposedText}」{item.shadow ? '（试跑，没有真的发出去）' : ''}
                                </p>
                            )}
                            {item.reason && (
                                <p className="mt-1 text-xs leading-relaxed" style={{ color: F.textTertiary }}>{item.reason}</p>
                            )}
                            {item.error && (
                                <p className="mt-1 text-xs" style={{ color: STATUS.danger.ink }}>{item.error}</p>
                            )}
                            <p className="mt-1 text-xs" style={{ color: F.textTertiary }}>
                                {new Date(item.startedAt).toLocaleString()}
                            </p>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    </ClayDialog>;
}
// [EM-END: agent-backend-heartbeat-panel]
