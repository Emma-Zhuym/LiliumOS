// [EM-START: agent-backend-panel]
/**
 * Mac mini 私人 Agent 后端的设置区块（阶段 1a / 1b）。
 *
 * 只做配对、推送登记、连通测试和后端消息补收。心跳、影子记录在 1c 之后加。
 * 后端连不上一律安静降级显示「后台休息中」——mini 每天 4–7 点休眠是正常状态，不是故障。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, MoonStars, WarningCircle } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { F, R, S, STATUS } from '../../utils/clayTokens';
import ClayDialog from '../os/ClayDialog';
import AgentHeartbeatPanel from './AgentHeartbeatPanel';
import {
    AgentBackend,
    AgentBackendError,
    clearAgentConfig,
    isAgentPaired,
    loadAgentConfig,
    type AgentDevice,
    type AgentMessage,
    type AgentStatus,
} from '../../utils/emAgentBackend';

const DEP_LABELS: Record<string, string> = {
    appleEvents: '日历 / 提醒桥接',
    homeAssistant: 'Home Assistant',
    push: '推送',
    codex: 'Codex（还没接）',
};

const buttonStyle = {
    minHeight: 44,
    background: F.surface,
    color: F.textPrimary,
    borderRadius: R.button,
    boxShadow: S.raisedSoft,
} as const;

const inputStyle = {
    minHeight: 44,
    background: F.surfaceSunken,
    color: F.textPrimary,
    borderRadius: R.input,
    boxShadow: S.sunken,
    outlineColor: F.accent,
} as const;

export default function AgentBackendSection() {
    const { addToast } = useOS();
    const [config, setConfig] = useState(loadAgentConfig);
    const [status, setStatus] = useState<AgentStatus | null>(null);
    const [reachable, setReachable] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [devices, setDevices] = useState<AgentDevice[] | null>(null);
    const [pairing, setPairing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState({ baseUrl: '', code: '', deviceName: '' });
    const [heartbeatOpen, setHeartbeatOpen] = useState(false);
    const version = useRef(0);

    const paired = isAgentPaired(config);

    const refresh = useCallback(async () => {
        if (!isAgentPaired()) { setStatus(null); setReachable(null); return; }
        const current = ++version.current;
        setLoading(true);
        try {
            const next = await AgentBackend.status();
            if (version.current !== current) return;
            setStatus(next);
            setReachable(true);
        } catch (error) {
            if (version.current !== current) return;
            setStatus(null);
            // 连不上和「后端说不」是两回事：前者是休眠，后者要如实报错。
            setReachable(error instanceof AgentBackendError && error.code === 'UNREACHABLE' ? false : null);
            if (!(error instanceof AgentBackendError) || error.code !== 'UNREACHABLE') {
                addToast(error instanceof Error ? error.message : '读不到后端状态', 'error');
            }
        } finally {
            if (version.current === current) setLoading(false);
        }
    }, [addToast]);

    useEffect(() => { void refresh(); }, [refresh]);

    const run = async (task: () => Promise<void>) => {
        if (busy) return;
        setBusy(true);
        try { await task(); } finally { setBusy(false); }
    };

    const handlePair = () => run(async () => {
        try {
            const next = await AgentBackend.pair(form.baseUrl, form.code.trim(), form.deviceName.trim() || '我的设备');
            setConfig(next);
            setPairing(false);
            setForm({ baseUrl: '', code: '', deviceName: '' });
            addToast('配对成功', 'success');
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : '配对失败', 'error');
        }
    });

    const handleRegisterPush = () => run(async () => {
        try {
            const result = await AgentBackend.registerPush();
            addToast(result.ok ? '这台设备的推送已登记' : result.reason || '推送登记未完成', result.ok ? 'success' : 'error');
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : '推送登记失败', 'error');
        }
    });

    const handleTestPing = () => run(async () => {
        try {
            await AgentBackend.testPing();
            addToast('已排入连通测试，最多 15 秒后会收到通知', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '排任务失败', 'error');
        }
    });

    const handleFetchInbox = () => run(async () => {
        try {
            const received = await AgentBackend.inbox();
            if (received.length > 0) await AgentBackend.ackInbox(received.map(message => message.messageId));
            setMessages(received);
            addToast(received.length > 0 ? `收到 ${received.length} 条` : '信箱里没有新消息', 'info');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '取消息失败', 'error');
        }
    });

    const handleOpenDevices = () => run(async () => {
        try { setDevices(await AgentBackend.devices()); } catch (error) {
            addToast(error instanceof Error ? error.message : '读不到设备列表', 'error');
        }
    });

    const handleUnpair = () => {
        clearAgentConfig();
        setConfig(loadAgentConfig());
        setStatus(null);
        setReachable(null);
        setMessages([]);
        addToast('已解除本机绑定；后端上的这台设备仍在，需要时到 Mac mini 上作废', 'info');
    };

    // 「读取中」必须和「状态未知」分开：都画成黄色警告的话，每次刷新都像出了故障。
    const tone = !paired ? 'idle' : loading ? 'loading' : reachable === false ? 'sleeping' : status ? 'online' : 'unknown';
    const toneStyle = {
        online: { tint: STATUS.success.tint, ink: STATUS.success.ink, text: '在线' },
        sleeping: { tint: F.surfaceSunken, ink: F.textSecondary, text: '后台休息中' },
        loading: { tint: F.surfaceSunken, ink: F.textSecondary, text: '读取中' },
        unknown: { tint: STATUS.warning.tint, ink: STATUS.warning.ink, text: '状态未知' },
        idle: { tint: F.surfaceSunken, ink: F.textSecondary, text: '未配对' },
    }[tone];

    return <section className="space-y-4 p-5" style={{ background: F.surface, color: F.textPrimary, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
        <div className="flex items-start justify-between gap-3">
            <div>
                <h2 className="text-base font-semibold">Mac mini 后端</h2>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: F.textSecondary }}>
                    常驻在 Mac mini 上的私人后端，负责定时任务与通知。它离线时聊天和主动消息都不受影响。
                </p>
            </div>
            <span className="shrink-0 px-3 py-1 text-xs font-semibold" style={{ background: toneStyle.tint, color: toneStyle.ink, borderRadius: R.pill }}>
                {toneStyle.text}
            </span>
        </div>

        {paired && status && (
            <div className="space-y-2 p-3" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken }}>
                <div className="flex items-center justify-between text-xs" style={{ color: F.textSecondary }}>
                    <span>版本 {status.version}</span>
                    <span>{status.quiet.active ? `安静时段（${status.quiet.start}–${status.quiet.end}）` : `安静时段 ${status.quiet.start}–${status.quiet.end}`}</span>
                </div>
                <ul className="space-y-1">
                    {Object.entries(status.deps).map(([key, dep]) => (
                        <li key={key} className="flex items-center justify-between text-xs">
                            <span style={{ color: F.textSecondary }}>{DEP_LABELS[key] || key}</span>
                            <span className="flex items-center gap-1" style={{ color: dep.ok ? STATUS.success.ink : F.textTertiary }}>
                                {dep.ok
                                    ? <CheckCircle size={14} weight="bold" />
                                    : <WarningCircle size={14} weight="bold" />}
                                {dep.ok ? '正常' : dep.detail || '不可用'}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        )}

        {paired && reachable === false && (
            <div className="flex items-center gap-2 p-3 text-xs" style={{ background: F.surfaceSunken, color: F.textSecondary, borderRadius: R.input, boxShadow: S.sunken }}>
                <MoonStars size={16} weight="bold" />
                <span>现在连不上。Mac mini 每天 4–7 点休眠，这段时间属于正常情况。</span>
            </div>
        )}

        {messages.length > 0 && (
            <ul className="space-y-2">
                {messages.map(message => (
                    <li key={message.messageId} className="p-3" style={{ background: F.surfaceWarm, borderRadius: R.input }}>
                        <p className="text-xs font-semibold">{String(message.payload.text || '（没有正文）')}</p>
                        {message.payload.detail && (
                            <p className="mt-1 text-xs leading-relaxed" style={{ color: F.textSecondary }}>{String(message.payload.detail)}</p>
                        )}
                        <p className="mt-1 text-xs" style={{ color: F.textTertiary }}>{new Date(message.createdAt).toLocaleString()}</p>
                    </li>
                ))}
            </ul>
        )}

        <div className="flex flex-wrap gap-3">
            {paired ? <>
                <button disabled={busy} onClick={() => void refresh()} className="flex-1 px-4 text-sm" style={buttonStyle}>刷新状态</button>
                <button disabled={busy} onClick={handleRegisterPush} className="flex-1 px-4 text-sm" style={buttonStyle}>登记推送</button>
                <button disabled={busy} onClick={handleTestPing} className="flex-1 px-4 text-sm" style={buttonStyle}>连通测试</button>
                <button disabled={busy} onClick={handleFetchInbox} className="flex-1 px-4 text-sm" style={buttonStyle}>收取消息</button>
                <button disabled={busy} onClick={handleOpenDevices} className="flex-1 px-4 text-sm" style={buttonStyle}>设备列表</button>
                <button disabled={busy} onClick={() => setHeartbeatOpen(true)} className="flex-1 px-4 text-sm" style={buttonStyle}>角色心跳</button>
                <button disabled={busy} onClick={handleUnpair} className="flex-1 px-4 text-sm" style={{ ...buttonStyle, color: STATUS.danger.ink }}>解除绑定</button>
            </> : (
                <button onClick={() => { setForm({ baseUrl: config.baseUrl, code: '', deviceName: '' }); setPairing(true); }} className="flex-1 px-4 text-sm font-semibold" style={buttonStyle}>
                    配对这台设备
                </button>
            )}
        </div>

        <AgentHeartbeatPanel open={heartbeatOpen} onClose={() => setHeartbeatOpen(false)} />

        <ClayDialog
            isOpen={pairing}
            title="配对 Mac mini 后端"
            onClose={() => { if (!busy) setPairing(false); }}
            footer={<button disabled={busy || !form.baseUrl.trim() || form.code.trim().length !== 6} onClick={handlePair} className="w-full px-4 text-sm font-semibold" style={buttonStyle}>
                {busy ? '配对中…' : '配对'}
            </button>}
        >
            <div className="space-y-4">
                <p className="text-xs leading-relaxed" style={{ color: F.textSecondary }}>
                    在 Mac mini 上运行 <span style={{ color: F.textPrimary }}>node server/agent-backend/cli.mjs pair</span> 拿到 6 位配对码，10 分钟内有效，只能用一次。
                </p>
                <label className="block space-y-2">
                    <span className="text-xs font-semibold">后端地址</span>
                    <input
                        value={form.baseUrl}
                        onChange={event => setForm(prev => ({ ...prev, baseUrl: event.target.value }))}
                        placeholder="https://mini.tailnet.ts.net"
                        inputMode="url"
                        className="w-full px-4 text-sm"
                        style={inputStyle}
                    />
                </label>
                <label className="block space-y-2">
                    <span className="text-xs font-semibold">配对码</span>
                    <input
                        value={form.code}
                        onChange={event => setForm(prev => ({ ...prev, code: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
                        placeholder="6 位数字"
                        inputMode="numeric"
                        className="w-full px-4 text-sm tracking-[0.3em]"
                        style={inputStyle}
                    />
                </label>
                <label className="block space-y-2">
                    <span className="text-xs font-semibold">这台设备叫什么</span>
                    <input
                        value={form.deviceName}
                        onChange={event => setForm(prev => ({ ...prev, deviceName: event.target.value.slice(0, 30) }))}
                        placeholder="阿萌的 iPhone"
                        className="w-full px-4 text-sm"
                        style={inputStyle}
                    />
                </label>
            </div>
        </ClayDialog>

        <ClayDialog isOpen={devices !== null} title="已配对的设备" onClose={() => setDevices(null)}>
            <ul className="space-y-2">
                {(devices || []).map(device => (
                    <li key={device.id} className="flex items-center justify-between gap-3 p-3" style={{ background: F.surfaceWarm, borderRadius: R.input }}>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{device.name}{device.id === config.deviceId ? '（本机）' : ''}</p>
                            <p className="text-xs" style={{ color: F.textTertiary }}>
                                推送 {device.pushStatus === 'active' ? '已登记' : device.pushStatus === 'gone' ? '已失效' : '未登记'}
                                {device.revokedAt ? ' · 已作废' : ''}
                            </p>
                        </div>
                        {!device.revokedAt && device.id !== config.deviceId && (
                            <button
                                disabled={busy}
                                onClick={() => void run(async () => {
                                    try {
                                        await AgentBackend.revokeDevice(device.id);
                                        setDevices(await AgentBackend.devices());
                                        addToast('已作废该设备', 'success');
                                    } catch (error) {
                                        addToast(error instanceof Error ? error.message : '作废失败', 'error');
                                    }
                                })}
                                className="shrink-0 px-3 text-xs font-semibold"
                                style={{ ...buttonStyle, color: STATUS.danger.ink }}
                            >
                                作废
                            </button>
                        )}
                    </li>
                ))}
                {devices?.length === 0 && <li className="p-3 text-xs" style={{ color: F.textTertiary }}>还没有配对过任何设备。</li>}
            </ul>
        </ClayDialog>
    </section>;
}
// [EM-END: agent-backend-panel]
