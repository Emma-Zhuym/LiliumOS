// [EM-START: agent-backend-panel]
/**
 * 设置 → Mac mini：只管「这台手机连哪台 mini」——配对、看连不连得上、解绑。
 *
 * 2026-10-21 起心跳、脾气、日历可见性、聊天交给 mini、推送登记、连通测试、收信箱、设备列表
 * 全在机房 App（规矩：手机关了还在跑的归机房，手机自己的配置归设置）。这里只留一扇「打开机房」的门。
 * 后端连不上一律安静显示「休息中」——mini 每天 4–7 点休眠是正常状态，不是故障。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import ClayDialog from '../os/ClayDialog';
import { F, R, STATUS } from '../../utils/clayTokens';
import {
    AgentBackend,
    AgentBackendError,
    clearAgentConfig,
    isAgentPaired,
    loadAgentConfig,
    type AgentStatus,
} from '../../utils/emAgentBackend';
import { SETTINGS_HUE, SettingsGroup, SettingsHero, SettingsRow, SettingsTextButton } from './SettingsHome';

type Tone = 'idle' | 'loading' | 'online' | 'sleeping' | 'revoked' | 'blocked' | 'unknown';

const TONE_TEXT: Record<Tone, { title: string; sub: string }> = {
    idle: { title: '还没配对', sub: '在 Mac mini 上运行 cli.mjs pair 拿 6 位配对码，再点下面的「配对这台手机」。' },
    loading: { title: '正在问 mini…', sub: '' },
    online: { title: 'mini 在线', sub: '心跳、脾气、开关都在机房里。' },
    sleeping: { title: 'mini 在休息', sub: '连不上，多半是每天 4–7 点的休眠或者在重启，属于正常情况。' },
    revoked: { title: '钥匙失效了', sub: '这台手机在 mini 上被作废了。解除本机绑定，再重新配对一次。' },
    blocked: { title: '被浏览器拦了', sub: '' },
    unknown: { title: '状态未知', sub: '' },
};

const fieldStyle: React.CSSProperties = {
    width: '100%', height: 48, padding: '0 14px', fontSize: 15, color: F.textPrimary,
    background: F.surfaceSunken, border: '1px solid transparent', borderRadius: R.input, outline: 'none',
};

export default function AgentBackendSection(_props: { defaultOpen?: boolean } = {}) { // [EM: settings-ios-list] 子页里不再折叠，defaultOpen 留着兼容旧调用
    const { addToast, openApp } = useOS();
    const [config, setConfig] = useState(loadAgentConfig);
    const [status, setStatus] = useState<AgentStatus | null>(null);
    const [reachable, setReachable] = useState<boolean | null>(null);
    const [blocked, setBlocked] = useState<string | null>(null); // [EM: agent-backend-cors-probe] mini 在线但请求被浏览器拦了
    const [revoked, setRevoked] = useState(false);
    const [loading, setLoading] = useState(false);
    const [pairing, setPairing] = useState(false);
    const [confirmUnpair, setConfirmUnpair] = useState(false);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState({ baseUrl: '', code: '', deviceName: '' });
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
            setBlocked(null);
        } catch (error) {
            if (mine !== version.current) return;
            // 连不上和「后端报错」是两回事：前者是休眠，后者才值得提醒。
            setReachable(!(error instanceof AgentBackendError && error.code === 'UNREACHABLE'));
            // 钥匙在后端被作废后本机还留着，看起来像「状态未知」——说清楚是钥匙失效，重新配对才是出路。
            setRevoked(error instanceof AgentBackendError && error.status === 401);
            setBlocked(error instanceof AgentBackendError && error.code === 'BLOCKED' ? error.message : null); // [EM: agent-backend-cors-probe]
        } finally {
            if (mine === version.current) setLoading(false);
        }
    }, []);

    useEffect(() => { if (paired) void refresh(); }, [paired, refresh]);

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
        setStatus(null);
        setReachable(null);
        setRevoked(false);
        setBlocked(null);
        setConfirmUnpair(false);
        addToast('已解除本机绑定', 'info');
    };

    const startPairing = () => {
        setForm({ baseUrl: config.baseUrl, code: '', deviceName: '' });
        setPairing(true);
    };

    // 「读取中」必须和「状态未知」分开：都画成警告的话，每次刷新都像出了故障。
    const tone: Tone = !paired ? 'idle'
        : loading && !status ? 'loading'
            : revoked ? 'revoked'
                : blocked ? 'blocked'
                    : reachable === false ? 'sleeping'
                        : status ? 'online' : 'unknown';
    const head = TONE_TEXT[tone];
    const heroSub = tone === 'blocked' ? blocked : head.sub;

    return (
        <div className="flex flex-col" style={{ gap: 22 }}>
            <SettingsHero title={head.title} sub={heroSub || undefined}
                action={paired && !revoked
                    ? <SettingsTextButton onClick={() => openApp(AppID.MachineRoom)}>打开机房</SettingsTextButton>
                    : undefined} />

            {paired ? (
                <>
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
