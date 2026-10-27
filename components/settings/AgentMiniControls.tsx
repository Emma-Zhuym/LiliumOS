// [EM-START: machine-room-split]
/**
 * 设置 → Mac mini 里「配对之后」的那一大块：mini 那边的服务、开关、心跳记录、
 * 这台手机（聊天交给 mini、推送、测试、收信箱）、这台 mini（日历可见性、设备）。
 * 每个角色的心跳（接上、开关、频率、API）留在机房的角色详情里——那是看 TA 的地方顺手调的。
 *
 * 2026-10-27 从机房「连接」「记录」两页搬来（roadmap 结构梳理第 4 步：机器的事归设置，机房只看 TA）。
 * 关掉「只试跑」= 角色会真的给你发消息，先确认；其余开关点了就改，失败拨回去。
 */

import React, { useEffect, useState } from 'react';

import { useOS } from '../../context/OSContext';
import { R, STATUS, F } from '../../utils/clayTokens';
import { AgentBackend, loadAgentConfig, type AgentAdminSettings, type AgentDevice } from '../../utils/emAgentBackend';
import { isAgentChatEnabled, setAgentChatEnabled } from '../../utils/emAgentChat';
import { clockText, linkRows, runKind } from '../../utils/emMachineRoom';
import type { AgentMiniData } from '../../hooks/useAgentMiniData';
import ClayDialog from '../os/ClayDialog';
import AgentTemporalPanel from './AgentTemporalPanel';
import AgentRunsSheet from './AgentRunsSheet';
import { SETTINGS_HUE as P } from './SettingsHome';
import { Group, Row, ToggleRow } from './SettingsParts';

const timeInput: React.CSSProperties = {
    background: F.surfaceSunken, border: '1px solid transparent', borderRadius: R.input, padding: '4px 6px',
    fontSize: 14, color: F.textPrimary, outline: 'none',
};

const AgentMiniControls: React.FC<{ data: AgentMiniData }> = ({ data }) => {
    const { addToast } = useOS();
    const [settings, setSettings] = useState<AgentAdminSettings | null>(data.settings);
    const [saving, setSaving] = useState(false);
    const [confirmLive, setConfirmLive] = useState(false);
    const [temporalOpen, setTemporalOpen] = useState(false);
    const [devices, setDevices] = useState<AgentDevice[] | null>(null);
    const [devicesOpen, setDevicesOpen] = useState(false);
    const [runsOpen, setRunsOpen] = useState(false);
    const [agentChat, setAgentChat] = useState(isAgentChatEnabled);
    const [busy, setBusy] = useState(false);
    const myDeviceId = loadAgentConfig().deviceId;

    useEffect(() => { setSettings(data.settings); }, [data.settings]);
    const loadDevices = () => AgentBackend.devices().then(setDevices).catch(() => setDevices(null));
    useEffect(() => {
        if (!data.reachable) return;
        void loadDevices();
    }, [data.reachable]);

    /** 一次性的小动作：做完弹一句，失败说原因。 */
    const act = async (task: () => Promise<string>) => {
        setBusy(true);
        try {
            addToast(await task(), 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '没做成', 'error');
        } finally {
            setBusy(false);
        }
    };

    const save = async (patch: Partial<AgentAdminSettings>, done: string) => {
        if (!settings) return;
        setSaving(true);
        setSettings({ ...settings, ...patch }); // 先拨过去，失败再拨回来
        try {
            setSettings(await AgentBackend.putSettings(patch));
            addToast(done, 'success');
        } catch (error) {
            setSettings(settings);
            addToast(error instanceof Error ? error.message : '没改成', 'error');
        } finally {
            setSaving(false);
        }
    };

    const rows = linkRows(data.status);
    const activeDevices = devices?.filter(device => !device.revokedAt) ?? [];
    const myDevice = devices?.find(device => device.id === myDeviceId);
    const pushText = !myDevice ? '—' : myDevice.pushStatus === 'active' ? '已登记' : myDevice.pushStatus === 'gone' ? '失效了，重新登记一次' : '还没登记';
    const errorCount = data.runs.filter(run => runKind(run) === 'error').length;

    return (
        <>
            <Group title="服务" foot={rows.some(row => row.key === 'xhs' && row.tone === 'warn') ? '小红书扫码在「设置 → 小红书」里。' : undefined}>
                {rows.map(row => (
                    <Row key={row.key} title={row.label}
                        dot={data.reachable ? (row.tone === 'ok' ? 'ok' : row.tone === 'warn' ? 'bad' : null) : null}
                        value={data.reachable ? row.detail || undefined : '—'} valueTone={data.reachable && row.tone === 'warn' ? 'bad' : 'plain'}
                        onClick={row.key === 'appleEvents' ? () => setTemporalOpen(true) : undefined} />
                ))}
            </Group>

            <Group title="开关" foot={!settings ? (data.reachable ? 'mini 上的后端还是旧版，没有开关接口。在 mini 上拉代码、重启后端就有了。' : '连上 mini 之后才能改。') : undefined}>
                {settings && (
                    <>
                        <ToggleRow title="心跳只试跑，不真发" checked={settings.heartbeatShadow} disabled={saving}
                            sub={settings.heartbeatShadow ? '角色照常醒、照常想，想说的话只记在心跳记录里' : '关着：角色想说话时会真的发给你'}
                            onChange={next => (next ? void save({ heartbeatShadow: true }, '回到试跑了') : setConfirmLive(true))} />
                        <ToggleRow title="心思试运行" checked={settings.drivesTrial} disabled={saving}
                            sub={settings.drivesTrial ? '想你、别扭这些只在后台记账，不影响 TA 找不找你' : '关着：TA 找不找你、过日子做什么跟着心思走'}
                            onChange={next => void save({ drivesTrial: next }, next ? '心思回到试运行' : '心思生效了')} />
                        <Row title="安静时段" sub="这段时间心跳不排，也不发推送"
                            right={<span className="flex items-center shrink-0" style={{ gap: 4 }}>
                                <input type="time" aria-label="安静开始" value={settings.quietStart} disabled={saving} style={timeInput}
                                    onChange={event => event.target.value && void save({ quietStart: event.target.value }, '安静时段改好了')} />
                                <span style={{ color: F.textTertiary }}>–</span>
                                <input type="time" aria-label="安静结束" value={settings.quietEnd} disabled={saving} style={timeInput}
                                    onChange={event => event.target.value && void save({ quietEnd: event.target.value }, '安静时段改好了')} />
                            </span>} />
                        <ToggleRow title="解析失败时存原文" checked={settings.captureRawOnError} disabled={saving}
                            sub="排查「角色怎么又不说话了」用；里面有角色的话，查完记得关"
                            onChange={next => void save({ captureRawOnError: next }, next ? '开了，查完记得关' : '关掉了')} />
                    </>
                )}
            </Group>

            <Group title="排查" foot="出错的原文、没醒的原因、试跑没发出去的那句都在记录里。">
                <Row title="心跳记录" value={data.runs.length ? `${data.runs.length} 条${errorCount ? ` · ${errorCount} 条出错` : ''}` : '—'}
                    valueTone={errorCount ? 'bad' : 'plain'} onClick={() => setRunsOpen(true)} />
            </Group>

            <Group title="这台手机">
                {/* [EM: agent-instant-chat] 本机开关（存 localStorage） */}
                <ToggleRow title="聊天交给 Mac mini 回复" checked={agentChat}
                    sub="点生成后就能锁屏或划掉 App，回复推送回来；mini 不在时这一轮照旧在手机上生成"
                    onChange={next => { setAgentChatEnabled(next); setAgentChat(next); }} />
                <Row title="推送" sub="回到前台时会自动补登记" value={pushText} valueTone={myDevice?.pushStatus === 'gone' ? 'bad' : 'plain'} />
                <Row title="重新登记推送" tone="link" disabled={busy}
                    onClick={() => void act(async () => {
                        const result = await AgentBackend.registerPush();
                        void loadDevices();
                        if (!result.ok) throw new Error(result.reason || '推送登记没完成');
                        return '这台手机的推送登记好了';
                    })} />
                <Row title="连通测试" sub="让 mini 发一条测试通知，看推送通不通" tone="link" disabled={busy}
                    onClick={() => void act(async () => { await AgentBackend.testPing(); return '排上了，稍等一下看通知'; })} />
                <Row title="立刻收一次信箱" sub="平时回到前台会自动收；推送没到、又想马上看时点一下" tone="link" disabled={busy}
                    onClick={() => void act(async () => {
                        // 走跟回到前台同一条收信路（OSContext 的 em-agent-pull），消息会进聊天，不会被吞掉
                        window.dispatchEvent(new Event('em-agent-pull'));
                        return '去收了，有新消息会进聊天';
                    })} />
            </Group>

            <Group title="这台 mini">
                <Row title="角色能看到我哪些日历" sub="逐个日历选给不给看、给看多少" onClick={() => setTemporalOpen(true)} />
                <Row title="配对的设备" value={devices ? String(activeDevices.length) : '—'}
                    sub={devices ? activeDevices.map(device => `${device.name}${device.lastSeenAt ? `（${clockText(device.lastSeenAt)}）` : ''}`).join('、') || '一台都没有' : undefined}
                    onClick={devices ? () => setDevicesOpen(true) : undefined} />
            </Group>

            <AgentTemporalPanel open={temporalOpen} onClose={() => setTemporalOpen(false)} />
            <AgentRunsSheet open={runsOpen} runs={data.runs} onClose={() => setRunsOpen(false)} />
            <ClayDialog isOpen={devicesOpen} title="配对的设备" onClose={() => setDevicesOpen(false)}>
                <Group foot={devices?.length === 0 ? '还没有配对过的设备。' : undefined}>
                    {(devices || []).map(device => (
                        <Row key={device.id}
                            title={`${device.name}${device.id === myDeviceId ? '（这台）' : ''}`}
                            sub={`推送${device.pushStatus === 'active' ? '已登记' : device.pushStatus === 'gone' ? '已失效' : '未登记'}${device.lastSeenAt ? ` · ${clockText(device.lastSeenAt)} 来过` : ''}${device.revokedAt ? ' · 已作废' : ''}`}
                            right={!device.revokedAt && device.id !== myDeviceId ? (
                                <button type="button" disabled={busy} className="shrink-0 active:opacity-40 transition-opacity disabled:opacity-50"
                                    style={{ padding: '8px 12px', borderRadius: R.pill, background: STATUS.danger.tint, color: STATUS.danger.ink, fontSize: 13, fontWeight: 600, border: 'none' }}
                                    onClick={() => void act(async () => { await AgentBackend.revokeDevice(device.id); await loadDevices(); return '那台设备作废了'; })}>
                                    作废
                                </button>
                            ) : undefined} />
                    ))}
                </Group>
            </ClayDialog>
            <ClayDialog isOpen={confirmLive} title="让角色真的发消息？" onClose={() => setConfirmLive(false)}
                footer={<button type="button" className="w-full clay-press" onClick={() => { setConfirmLive(false); void save({ heartbeatShadow: false }, '心跳真发了'); }}
                    style={{ height: 46, borderRadius: R.button, background: P.main, color: F.surface, fontSize: 15, fontWeight: 600, border: 'none' }}>
                    真发
                </button>}>
                <p style={{ fontSize: 14, color: F.textSecondary, lineHeight: 1.7 }}>
                    关掉试跑之后，角色醒来想找你时会<b style={{ color: P.ink }}>真的发消息、推送到手机</b>。随时可以再打开。
                </p>
            </ClayDialog>
        </>
    );
};

export default AgentMiniControls;
// [EM-END: machine-room-split]
