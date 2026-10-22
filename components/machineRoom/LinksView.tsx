// [EM-START: machine-room]
/**
 * 机房「连接」：mini 那边各项服务的状态，和那几个原来只能在 mini 终端里改的开关。
 * 关掉「只试跑」= 角色会真的给你发消息，所以要确认一下；其余开关点了就改。
 * 日历可见性复用原来的面板（AgentTemporalPanel）。
 * 2026-10-21 起设置里「Mac mini」只留配对 / 解绑，其余（聊天交给 mini、推送登记、连通测试、
 * 立刻收信箱、设备列表和作废）都在这里——手机关了还在跑的归机房，手机自己的配置归设置。
 */

import React, { useEffect, useState } from 'react';

import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { F, R, STATUS } from '../../utils/clayTokens';
import { AgentBackend, loadAgentConfig, type AgentAdminSettings, type AgentDevice } from '../../utils/emAgentBackend';
import { isAgentChatEnabled, setAgentChatEnabled } from '../../utils/emAgentChat';
import { clockText, linkRows } from '../../utils/emMachineRoom';
import ClayDialog from '../os/ClayDialog';
import AgentTemporalPanel from '../settings/AgentTemporalPanel';
import type { MachineRoomData } from '../../apps/MachineRoomApp';
import { Card, Dot, P, PillButton, Row, SectionTitle, Toggle, selectStyle } from './ui';

const LinksView: React.FC<{ data: MachineRoomData }> = ({ data }) => {
    const { addToast, openApp } = useOS();
    const [settings, setSettings] = useState<AgentAdminSettings | null>(data.settings);
    const [saving, setSaving] = useState(false);
    const [confirmLive, setConfirmLive] = useState(false);
    const [temporalOpen, setTemporalOpen] = useState(false);
    const [devices, setDevices] = useState<AgentDevice[] | null>(null);
    const [devicesOpen, setDevicesOpen] = useState(false);
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

    return (
        <>
            <SectionTitle>服务</SectionTitle>
            <Card style={{ padding: '2px 16px' }}>
                {rows.map((row, index) => (
                    <Row key={row.key} first={index === 0}
                        title={<span className="flex items-center" style={{ gap: 8 }}><Dot tone={data.reachable ? row.tone : 'off'} />{row.label}</span>}
                        right={<span style={{ fontSize: 12, fontWeight: row.tone === 'warn' ? 600 : 400, color: row.tone === 'warn' ? STATUS.warning.ink : F.textTertiary }}>{data.reachable ? row.detail : '—'}</span>}
                        onClick={row.key === 'appleEvents' ? () => setTemporalOpen(true) : row.key === 'xhs' && row.tone === 'warn' ? () => openApp(AppID.Settings) : undefined}
                    />
                ))}
            </Card>
            {rows.some(row => row.key === 'xhs' && row.tone === 'warn') && (
                <p style={{ fontSize: 12, color: F.textTertiary, padding: '0 4px', lineHeight: 1.6 }}>小红书扫码在「设置 → 实时感知 → 小红书 · 本地」里。</p>
            )}

            <SectionTitle>开关</SectionTitle>
            {!settings ? (
                <Card><p style={{ fontSize: 13, color: F.textSecondary, lineHeight: 1.6 }}>
                    {data.reachable ? 'mini 上的后端还是旧版，没有开关接口。在 mini 上拉代码、重启后端就有了。' : '连上 mini 之后才能改。'}
                </p></Card>
            ) : (
                <Card style={{ padding: '2px 16px' }}>
                    <Row first title="心跳只试跑，不真发" sub={settings.heartbeatShadow ? '角色照常醒、照常想，想说的话只记在「记录」里' : '关着：角色想说话时会真的发给你'}
                        right={<Toggle label="心跳只试跑" checked={settings.heartbeatShadow} disabled={saving}
                            onChange={() => (settings.heartbeatShadow ? setConfirmLive(true) : void save({ heartbeatShadow: true }, '回到试跑了'))} />} />
                    <Row title="心思试运行" sub={settings.drivesTrial ? '想你、别扭这些只在后台记账，不影响 TA 找不找你' : '关着：TA 找不找你、过日子做什么跟着心思走'}
                        right={<Toggle label="心思试运行" checked={settings.drivesTrial} disabled={saving}
                            onChange={() => void save({ drivesTrial: !settings.drivesTrial }, settings.drivesTrial ? '心思生效了' : '心思回到试运行')} />} />
                    <Row title="安静时段" sub="这段时间心跳不排，也不发推送"
                        right={<span className="flex items-center shrink-0" style={{ gap: 4 }}>
                            <input type="time" aria-label="安静开始" value={settings.quietStart} disabled={saving} style={{ ...selectStyle, padding: '4px 6px' }}
                                onChange={event => event.target.value && void save({ quietStart: event.target.value }, '安静时段改好了')} />
                            <span style={{ color: F.textTertiary }}>–</span>
                            <input type="time" aria-label="安静结束" value={settings.quietEnd} disabled={saving} style={{ ...selectStyle, padding: '4px 6px' }}
                                onChange={event => event.target.value && void save({ quietEnd: event.target.value }, '安静时段改好了')} />
                        </span>} />
                    <Row title="解析失败时存原文" sub="排查「角色怎么又不说话了」用；里面有角色的话，查完记得关"
                        right={<Toggle label="解析失败时存原文" checked={settings.captureRawOnError} disabled={saving}
                            onChange={() => void save({ captureRawOnError: !settings.captureRawOnError }, settings.captureRawOnError ? '关掉了' : '开了，查完记得关')} />} />
                </Card>
            )}

            <SectionTitle>这台手机</SectionTitle>
            <Card style={{ padding: '2px 16px' }}>
                {/* [EM: agent-instant-chat] 本机开关（存 localStorage），从设置搬来 */}
                <Row first title="聊天交给 Mac mini 回复" sub="点生成后就能锁屏或划掉 App，回复推送回来；mini 不在时这一轮照旧在手机上生成"
                    right={<Toggle label="聊天交给 Mac mini 回复" checked={agentChat}
                        onChange={() => { setAgentChatEnabled(!agentChat); setAgentChat(!agentChat); }} />} />
                <Row title="推送" sub={`这台手机：${pushText}。回到前台时会自动补登记`}
                    right={<PillButton disabled={busy} onClick={() => void act(async () => {
                        const result = await AgentBackend.registerPush();
                        void loadDevices();
                        if (!result.ok) throw new Error(result.reason || '推送登记没完成');
                        return '这台手机的推送登记好了';
                    })}>重新登记</PillButton>} />
                <Row title="连通测试" sub="让 mini 发一条测试通知，看推送通不通"
                    right={<PillButton disabled={busy} onClick={() => void act(async () => { await AgentBackend.testPing(); return '排上了，稍等一下看通知'; })}>测试</PillButton>} />
                <Row title="立刻收一次信箱" sub="平时回到前台会自动收；推送没到、又想马上看时点一下"
                    right={<PillButton disabled={busy} onClick={() => void act(async () => {
                        // 走跟回到前台同一条收信路（OSContext 的 em-agent-pull），消息会进聊天，不会被吞掉
                        window.dispatchEvent(new Event('em-agent-pull'));
                        return '去收了，有新消息会进聊天';
                    })}>收取</PillButton>} />
            </Card>

            <SectionTitle>这台 mini</SectionTitle>
            <Card style={{ padding: '2px 16px' }}>
                <Row first title="角色能看到我哪些日历" sub="逐个日历选给不给看、给看多少" onClick={() => setTemporalOpen(true)} />
                <Row title="配对的设备" sub={devices ? activeDevices.map(device => `${device.name}${device.lastSeenAt ? `（${clockText(device.lastSeenAt)}）` : ''}`).join('、') || '一台都没有' : '—'}
                    onClick={devices ? () => setDevicesOpen(true) : undefined} />
                <Row title="配对、解绑" sub="在「设置 → Mac mini」里" onClick={() => openApp(AppID.Settings)} />
                {data.status?.version && <Row title="后端版本" right={<span style={{ fontSize: 12, color: F.textTertiary }}>{data.status.version}</span>} />}
            </Card>

            <AgentTemporalPanel open={temporalOpen} onClose={() => setTemporalOpen(false)} />
            <ClayDialog isOpen={devicesOpen} title="配对的设备" onClose={() => setDevicesOpen(false)}>
                <div className="flex flex-col">
                    {(devices || []).map((device, index) => (
                        <Row key={device.id} first={index === 0}
                            title={`${device.name}${device.id === myDeviceId ? '（这台）' : ''}`}
                            sub={`推送${device.pushStatus === 'active' ? '已登记' : device.pushStatus === 'gone' ? '已失效' : '未登记'}${device.lastSeenAt ? ` · ${clockText(device.lastSeenAt)} 来过` : ''}${device.revokedAt ? ' · 已作废' : ''}`}
                            right={!device.revokedAt && device.id !== myDeviceId ? (
                                <button type="button" disabled={busy} className="shrink-0 active:opacity-40 transition-opacity disabled:opacity-50"
                                    style={{ padding: '8px 12px', borderRadius: R.pill, background: STATUS.danger.tint, color: STATUS.danger.ink, fontSize: 13, fontWeight: 600 }}
                                    onClick={() => void act(async () => { await AgentBackend.revokeDevice(device.id); await loadDevices(); return '那台设备作废了'; })}>
                                    作废
                                </button>
                            ) : undefined} />
                    ))}
                    {devices?.length === 0 && <p style={{ fontSize: 13, color: F.textTertiary }}>还没有配对过的设备。</p>}
                </div>
            </ClayDialog>
            <ClayDialog isOpen={confirmLive} title="让角色真的发消息？" onClose={() => setConfirmLive(false)}
                footer={<div className="flex justify-end" style={{ gap: 8 }}>
                    <button type="button" onClick={() => setConfirmLive(false)} style={{ padding: '10px 16px', borderRadius: R.button, color: F.textSecondary, fontSize: 14, fontWeight: 600 }}>再想想</button>
                    <PillButton strong onClick={() => { setConfirmLive(false); void save({ heartbeatShadow: false }, '心跳真发了'); }}>真发</PillButton>
                </div>}>
                <p style={{ fontSize: 14, color: F.textSecondary, lineHeight: 1.7 }}>
                    关掉试跑之后，角色醒来想找你时会<b style={{ color: P.ink }}>真的发消息、推送到手机</b>。随时可以再打开。
                </p>
            </ClayDialog>
        </>
    );
};

export default LinksView;
// [EM-END: machine-room]
