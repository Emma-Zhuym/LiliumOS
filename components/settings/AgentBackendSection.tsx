// [EM-START: agent-backend-panel]
/**
 * Mac mini 私人 Agent 后端的设置区块。
 *
 * 配对、推送登记、连通测试、消息补收，以及角色心跳（影子试跑）的入口。
 * 后端连不上一律安静降级显示「后台休息中」——mini 每天 4–7 点休眠是正常状态，不是故障。
 *
 * 外观跟随这一页原本的风格（白卡 + slate 文字 + 折叠标题），不用 Clay tokens：
 * 系统设置整页都是上游那套样子，单独一块换配色会很突兀。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import Modal from '../os/Modal';
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

/** 这一页的按钮统一长相：白底、细边、slate 文字，跟备份区那些对齐。 */
const BTN = 'py-2.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 shadow-sm active:scale-95 transition-all disabled:opacity-50';
const INPUT = 'w-full bg-white/80 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-300';

export default function AgentBackendSection() {
    const { addToast } = useOS();
    const [config, setConfig] = useState(loadAgentConfig);
    const [status, setStatus] = useState<AgentStatus | null>(null);
    const [reachable, setReachable] = useState<boolean | null>(null);
    const [revoked, setRevoked] = useState(false);
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [devices, setDevices] = useState<AgentDevice[] | null>(null);
    const [pairing, setPairing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ baseUrl: '', code: '', deviceName: '' });
    const [heartbeatOpen, setHeartbeatOpen] = useState(false);
    const version = useRef(0);

    const paired = isAgentPaired(config);

    const refresh = useCallback(async () => {
        if (!isAgentPaired()) return;
        const mine = ++version.current;
        setLoading(true);
        try {
            const next = await AgentBackend.status();
            if (mine !== version.current) return;
            setStatus(next);
            setReachable(true);
            setRevoked(false);
        } catch (error) {
            if (mine !== version.current) return;
            // 连不上和「后端报错」是两回事：前者是休眠，后者才值得红字。
            setReachable(!(error instanceof AgentBackendError && error.code === 'UNREACHABLE'));
            // 这台设备在后端被作废后，本机钥匙还留着，看起来就像「状态未知」。
            // 说清楚是钥匙失效，否则只能靠猜——重新配对才是出路。
            setRevoked(error instanceof AgentBackendError && error.status === 401);
        } finally {
            if (mine === version.current) setLoading(false);
        }
    }, []);

    // 展开时才去问后端：这一块默认折叠，收着的时候不该有网络请求。
    useEffect(() => { if (open && paired) void refresh(); }, [open, paired, refresh]);

    const run = async (task: () => Promise<void>) => {
        setBusy(true);
        try {
            await task();
        } finally {
            setBusy(false);
        }
    };

    const handlePair = () => run(async () => {
        try {
            const next = await AgentBackend.pair(form.baseUrl, form.code, form.deviceName || '我的设备');
            setConfig(next);
            setPairing(false);
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
            addToast('已排入连通测试，稍等一下看通知', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '排任务失败', 'error');
        }
    });

    const handleFetchInbox = () => run(async () => {
        try {
            const next = await AgentBackend.inbox();
            setMessages(next);
            if (next.length > 0) await AgentBackend.ackInbox(next.map(item => item.messageId));
            addToast(next.length > 0 ? `收到 ${next.length} 条` : '信箱是空的', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '收取失败', 'error');
        }
    });

    const handleOpenDevices = () => run(async () => {
        try {
            setDevices(await AgentBackend.devices());
        } catch (error) {
            addToast(error instanceof Error ? error.message : '读取设备失败', 'error');
        }
    });

    const handleUnpair = () => {
        clearAgentConfig();
        setConfig(loadAgentConfig());
        setStatus(null);
        setReachable(null);
        setRevoked(false);
        setMessages([]);
        addToast('已解除本机绑定', 'info');
    };

    // 「读取中」必须和「状态未知」分开：都画成黄色警告的话，每次刷新都像出了故障。
    const tone = !paired ? 'idle'
        : loading ? 'loading'
            : revoked ? 'revoked'
                : reachable === false ? 'sleeping'
                    : status ? 'online' : 'unknown';
    const badge = {
        online: { cls: 'bg-emerald-100 text-emerald-700', text: '在线' },
        sleeping: { cls: 'bg-slate-100 text-slate-500', text: '后台休息中' },
        loading: { cls: 'bg-slate-100 text-slate-500', text: '读取中' },
        unknown: { cls: 'bg-amber-100 text-amber-700', text: '状态未知' },
        revoked: { cls: 'bg-amber-100 text-amber-700', text: '钥匙已失效' },
        idle: { cls: 'bg-slate-100 text-slate-500', text: '未配对' },
    }[tone];

    return (
        <section className="bg-[#fffefe] rounded-3xl p-5 shadow-[0_8px_24px_rgba(15,23,42,0.05)] border border-slate-200/80">
            <div className={`flex items-center justify-between gap-2 ${open ? 'mb-4' : ''}`}>
                <button type="button" onClick={() => setOpen(v => !v)} className="flex items-center gap-2 flex-1 min-w-0 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
                    <div className="p-2 bg-slate-100 rounded-xl text-slate-500 shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3m-13.5 0v2.25a3 3 0 0 0 3 3h7.5a3 3 0 0 0 3-3V14.25M7.5 18h.008v.008H7.5V18Z" />
                        </svg>
                    </div>
                    <h2 className="text-sm font-semibold text-slate-600 tracking-wider">Mac mini 后端</h2>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>{badge.text}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-3 h-3 text-slate-300 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                </button>
            </div>

            {open && <div className="space-y-3">
                <p className="text-[10px] text-slate-400 leading-relaxed">
                    常驻在 Mac mini 上的私人后端，负责定时任务与通知。它离线时聊天和主动消息都不受影响。
                </p>

                {paired && status && (
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>版本 {status.version}</span>
                            <span>安静时段 {status.quiet.start}–{status.quiet.end}</span>
                        </div>
                        {Object.entries(status.deps).map(([key, dep]) => (
                            <div key={key} className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-500">{DEP_LABELS[key] || key}</span>
                                <span className={dep.ok ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                                    {dep.ok ? '正常' : dep.detail || '不可用'}
                                </span>
                            </div>
                        ))}
                        {status.heartbeat && (
                            <div className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-500">角色心跳</span>
                                <span className="text-slate-400">
                                    {status.heartbeat.shadow ? '影子试跑' : '真实执行'}
                                    {status.heartbeat.everyMinOverride ? ` · 提速 ${status.heartbeat.everyMinOverride} 分钟` : ''}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {paired && revoked && (
                    <p className="text-[10px] text-amber-600 leading-relaxed px-1">
                        这台设备在后端已被作废。解除本机绑定后重新配对一次即可。
                    </p>
                )}

                {paired && !revoked && reachable === false && (
                    <p className="text-[10px] text-slate-400 leading-relaxed px-1">
                        现在连不上。Mac mini 每天 4–7 点休眠，这段时间属于正常情况。
                    </p>
                )}

                {messages.length > 0 && (
                    <ul className="space-y-2">
                        {messages.map(message => (
                            <li key={message.messageId} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3">
                                <p className="text-[11px] font-bold text-slate-600">{String(message.payload.text || '（没有正文）')}</p>
                                {message.payload.detail && (
                                    <p className="mt-1 text-[10px] text-slate-400 leading-relaxed line-clamp-3">{String(message.payload.detail)}</p>
                                )}
                                <p className="mt-1 text-[10px] text-slate-300">{new Date(message.createdAt).toLocaleString()}</p>
                            </li>
                        ))}
                    </ul>
                )}

                {paired ? <>
                    {/* 一行两个：挤到一行六个时，按钮里的中文会被压成竖排。 */}
                    <div className="grid grid-cols-2 gap-2">
                        <button disabled={busy} onClick={() => void refresh()} className={BTN}>刷新状态</button>
                        <button disabled={busy} onClick={handleRegisterPush} className={BTN}>登记推送</button>
                        <button disabled={busy} onClick={handleTestPing} className={BTN}>连通测试</button>
                        <button disabled={busy} onClick={handleFetchInbox} className={BTN}>收取消息</button>
                        <button disabled={busy} onClick={handleOpenDevices} className={BTN}>设备列表</button>
                        <button disabled={busy} onClick={() => setHeartbeatOpen(true)} className={`${BTN} text-violet-600 border-violet-200`}>角色心跳</button>
                    </div>
                    <button disabled={busy} onClick={handleUnpair} className="w-full py-2 text-[10px] font-bold text-slate-400 active:scale-95 transition-all">
                        解除本机绑定
                    </button>
                </> : (
                    <button
                        onClick={() => { setForm({ baseUrl: config.baseUrl, code: '', deviceName: '' }); setPairing(true); }}
                        className="w-full py-3 bg-violet-500 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all"
                    >
                        配对这台设备
                    </button>
                )}
            </div>}

            <AgentHeartbeatPanel open={heartbeatOpen} onClose={() => setHeartbeatOpen(false)} />

            <Modal
                isOpen={pairing}
                title="配对 Mac mini 后端"
                onClose={() => { if (!busy) setPairing(false); }}
                footer={<button
                    disabled={busy || !form.baseUrl.trim() || form.code.trim().length !== 6}
                    onClick={handlePair}
                    className="w-full py-3 bg-violet-500 text-white font-bold rounded-2xl disabled:opacity-50"
                >
                    {busy ? '配对中…' : '配对'}
                </button>}
            >
                <div className="space-y-4">
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                        在 Mac mini 上运行 <span className="font-mono text-slate-500">cli.mjs pair</span> 拿到 6 位配对码，10 分钟内有效，只能用一次。
                    </p>
                    <label className="block space-y-1.5">
                        <span className="text-xs text-slate-500 font-medium">后端地址</span>
                        <input
                            value={form.baseUrl}
                            onChange={event => setForm(prev => ({ ...prev, baseUrl: event.target.value }))}
                            placeholder="https://mini.tailnet.ts.net"
                            inputMode="url"
                            className={INPUT}
                        />
                    </label>
                    <label className="block space-y-1.5">
                        <span className="text-xs text-slate-500 font-medium">配对码</span>
                        <input
                            value={form.code}
                            onChange={event => setForm(prev => ({ ...prev, code: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
                            placeholder="6 位数字"
                            inputMode="numeric"
                            className={`${INPUT} tracking-[0.3em] font-mono`}
                        />
                    </label>
                    <label className="block space-y-1.5">
                        <span className="text-xs text-slate-500 font-medium">这台设备叫什么</span>
                        <input
                            value={form.deviceName}
                            onChange={event => setForm(prev => ({ ...prev, deviceName: event.target.value.slice(0, 30) }))}
                            placeholder="阿萌的 iPhone"
                            className={INPUT}
                        />
                    </label>
                </div>
            </Modal>

            <Modal isOpen={devices !== null} title="已配对的设备" onClose={() => setDevices(null)}>
                <ul className="space-y-2">
                    {(devices || []).map(device => (
                        <li key={device.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3">
                            <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-slate-600">{device.name}{device.id === config.deviceId ? '（本机）' : ''}</p>
                                <p className="text-[10px] text-slate-400">
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
                                    className="shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-bold text-red-500 bg-red-50 active:scale-95 transition-all"
                                >
                                    作废
                                </button>
                            )}
                        </li>
                    ))}
                    {devices?.length === 0 && <p className="text-xs text-slate-400">还没有配对过的设备。</p>}
                </ul>
            </Modal>
        </section>
    );
}
// [EM-END: agent-backend-panel]
