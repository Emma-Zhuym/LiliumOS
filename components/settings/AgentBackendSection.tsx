// [EM-START: agent-backend-panel]
/**
 * 设置 → Mac mini：mini 这台机器的家——配对 / 解绑、连不上时说清楚原因，
 * 配对后是服务、开关、角色心跳、心跳记录、这台手机和这台 mini（AgentMiniControls）。
 *
 * 2026-10-27 倒回 10-21 的分工（roadmap 结构梳理第 4 步）：机器的事都回到这里，
 * 机房只看 TA 们在干嘛，脾气在神经链接。连不上一律安静写原因——mini 每天 4–7 点休眠是正常状态，不是故障。
 */

import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import ClayDialog from '../os/ClayDialog';
import { F, R, STATUS } from '../../utils/clayTokens';
import {
    AgentBackend,
    clearAgentConfig,
    isAgentPaired,
    loadAgentConfig,
} from '../../utils/emAgentBackend';
import { useAgentMiniData } from '../../hooks/useAgentMiniData'; // [EM: machine-room-split]
import AgentMiniControls from './AgentMiniControls'; // [EM: machine-room-split]
import { SETTINGS_HUE, SettingsGroup, SettingsHero, SettingsRow, SettingsTextButton } from './SettingsHome';

const fieldStyle: React.CSSProperties = {
    width: '100%', height: 48, padding: '0 14px', fontSize: 15, color: F.textPrimary,
    background: F.surfaceSunken, border: '1px solid transparent', borderRadius: R.input, outline: 'none',
};

export default function AgentBackendSection(_props: { defaultOpen?: boolean } = {}) { // [EM: settings-ios-list] 子页里不再折叠，defaultOpen 留着兼容旧调用
    const { addToast, openApp } = useOS();
    const [config, setConfig] = useState(loadAgentConfig);
    const data = useAgentMiniData(); // [EM: machine-room-split] 跟机房同一份：状态、开关、角色、流水
    const [pairing, setPairing] = useState(false);
    const [confirmUnpair, setConfirmUnpair] = useState(false);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState({ baseUrl: '', code: '', deviceName: '' });

    const paired = isAgentPaired(config);
    const { refresh, loading, status, revoked } = data;

    const handlePair = async () => {
        setBusy(true);
        try {
            const next = await AgentBackend.pair(form.baseUrl, form.code, form.deviceName || '我的设备');
            setConfig(next);
            setPairing(false);
            addToast('配对好了', 'success');
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : '配对没成', 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleUnpair = () => {
        clearAgentConfig();
        setConfig(loadAgentConfig());
        setConfirmUnpair(false);
        addToast('已解除本机绑定', 'info');
    };

    const startPairing = () => {
        setForm({ baseUrl: config.baseUrl, code: '', deviceName: '' });
        setPairing(true);
    };

    // 「读取中」必须和「连不上」分开：都画成警告的话，每次刷新都像出了故障。
    // 连不上时说清楚是哪一种（钥匙失效 / 没网 / 被拦 / mini 在休息），跟机房同一套措辞（describeReachFailure）。
    const shadow = data.settings?.heartbeatShadow ?? status?.heartbeat?.shadow ?? true;
    const trial = data.settings?.drivesTrial ?? status?.heartbeat?.drivesTrial;
    const head: { title: string; sub?: string } = !paired
        ? { title: '还没配对', sub: '在 Mac mini 上运行 cli.mjs pair 拿 6 位配对码，再点下面的「配对这台手机」。' }
        : revoked ? { title: '钥匙失效了', sub: '这台手机在 mini 上被作废了。解除本机绑定，再重新配对一次。' }
            : data.reachable === false ? { title: data.failure?.title ?? 'mini 在休息', sub: data.failure?.sub ?? '连不上，多半是每天 4–7 点的休眠或者在重启，属于正常情况。' }
                : status ? {
                    title: 'mini 在线',
                    sub: [shadow ? '心跳只试跑，不真发' : '心跳真发中', trial === true ? '心思试运行中' : trial === false ? '心思已生效' : null, status.quiet?.active ? '安静时段' : null].filter(Boolean).join(' · '),
                }
                    : { title: '正在问 mini…' };

    return (
        <div className="flex flex-col" style={{ gap: 22 }}>
            <SettingsHero title={head.title} sub={head.sub || undefined}
                action={paired && !revoked
                    ? <SettingsTextButton onClick={() => openApp(AppID.MachineRoom)}>看看 TA 们在干嘛</SettingsTextButton>
                    : undefined} />

            {paired ? (
                <>
                    {!revoked && <AgentMiniControls data={data} />}
                    <SettingsGroup title="这台手机连着">
                        <SettingsRow first chevron={false} title="地址" value={config.baseUrl.replace(/^https?:\/\//, '')} />
                        {status?.version && <SettingsRow chevron={false} title="后端版本" value={status.version} />}
                        <SettingsRow title="刷新状态" titleColor={SETTINGS_HUE.main} chevron={false} onClick={() => void refresh()} value={loading ? '…' : undefined} />
                    </SettingsGroup>
                    <SettingsGroup foot={revoked ? '钥匙失效时先解绑，再用新的配对码配一次。' : '解绑后这台手机不再收 mini 的推送和心跳消息；mini 那边的角色和记录都还在。'}>
                        {revoked && <SettingsRow first title="重新配对" titleColor={SETTINGS_HUE.main} chevron={false} onClick={() => { handleUnpair(); startPairing(); }} />}
                        <SettingsRow first={!revoked} title="解除本机绑定" titleColor={STATUS.danger.ink} chevron={false} onClick={() => setConfirmUnpair(true)} />
                    </SettingsGroup>
                </>
            ) : (
                <SettingsGroup>
                    <SettingsRow first title="配对这台手机" titleColor={SETTINGS_HUE.main} chevron={false} onClick={startPairing} />
                </SettingsGroup>
            )}

            <ClayDialog isOpen={pairing} title="配对 Mac mini" onClose={() => { if (!busy) setPairing(false); }}
                footer={<button type="button"
                    disabled={busy || !form.baseUrl.trim() || form.code.trim().length !== 6}
                    onClick={() => void handlePair()}
                    className="w-full clay-press disabled:opacity-50"
                    style={{ height: 46, borderRadius: R.button, background: SETTINGS_HUE.main, color: F.surface, fontSize: 15, fontWeight: 600 }}>
                    {busy ? '配对中…' : '配对'}
                </button>}>
                <div className="flex flex-col" style={{ gap: 14 }}>
                    <p style={{ fontSize: 13, lineHeight: '20px', color: F.textSecondary }}>
                        在 Mac mini 上运行 <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>cli.mjs pair</span> 拿到 6 位配对码，10 分钟内有效，只能用一次。
                    </p>
                    <label className="flex flex-col" style={{ gap: 6 }}>
                        <span style={{ fontSize: 12, color: F.textTertiary }}>后端地址</span>
                        <input value={form.baseUrl} onChange={event => setForm(prev => ({ ...prev, baseUrl: event.target.value }))}
                            placeholder="https://mini.tailnet.ts.net" inputMode="url" style={fieldStyle} />
                    </label>
                    <label className="flex flex-col" style={{ gap: 6 }}>
                        <span style={{ fontSize: 12, color: F.textTertiary }}>配对码</span>
                        <input value={form.code} onChange={event => setForm(prev => ({ ...prev, code: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
                            placeholder="6 位数字" inputMode="numeric" style={{ ...fieldStyle, letterSpacing: '0.3em', fontVariantNumeric: 'tabular-nums' }} />
                    </label>
                    <label className="flex flex-col" style={{ gap: 6 }}>
                        <span style={{ fontSize: 12, color: F.textTertiary }}>这台手机叫什么</span>
                        <input value={form.deviceName} onChange={event => setForm(prev => ({ ...prev, deviceName: event.target.value.slice(0, 30) }))}
                            placeholder="阿萌的 iPhone" style={fieldStyle} />
                    </label>
                </div>
            </ClayDialog>

            <ClayDialog isOpen={confirmUnpair} title="解除这台手机的绑定？" onClose={() => setConfirmUnpair(false)}
                footer={<button type="button" onClick={handleUnpair} className="w-full clay-press"
                    style={{ height: 46, borderRadius: R.button, background: STATUS.danger.main, color: F.surface, fontSize: 15, fontWeight: 600 }}>
                    解除绑定
                </button>}>
                <p style={{ fontSize: 14, lineHeight: '22px', color: F.textSecondary }}>
                    解绑后这台手机不再收 mini 的推送和心跳消息，想接回来要重新拿配对码。mini 那边的角色、心跳记录都不受影响。
                </p>
            </ClayDialog>
        </div>
    );
}
// [EM-END: agent-backend-panel]
