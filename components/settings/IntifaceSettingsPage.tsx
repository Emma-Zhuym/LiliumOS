// [EM-START: settings-subpages-f]
/**
 * 设置 → Intiface 硬件。原来是一块带 🎮 的紫色卡片，换成分组列表：
 * 状态卡（连没连上、几个设备）/ 地址 / 设备列表 / 试一下震动。
 * intifaceClient 是单例，这一页自己挂 useIntiface 就行。
 */

import React, { useState } from 'react';
import { useIntiface } from '../../hooks/useIntiface';
import { F, R } from '../../utils/clayTokens';
import { SETTINGS_HUE } from './SettingsHome';
import { FieldRow, Group, Hero, HeroAction, Page, Row } from './SettingsParts';

const URL_KEY = 'intiface-url';

const IntifaceSettingsPage: React.FC = () => {
    const intiface = useIntiface();
    const [url, setUrl] = useState(() => localStorage.getItem(URL_KEY) || 'ws://localhost:12345');
    const [intensity, setIntensity] = useState(0);
    const connected = intiface.status === 'connected';

    const title = connected ? `已连接 · ${intiface.devices.length} 个设备`
        : intiface.status === 'connecting' ? '正在连…'
        : intiface.status === 'error' ? '连不上' : '没连接';
    const sub = intiface.status === 'error' && intiface.errorMessage
        ? intiface.errorMessage
        : '通过 Intiface Central 连蓝牙设备。连上后角色在聊天里能主动控制，见面时跟着剧情走。';

    return (
        <Page testId="settings-intiface-page">
            <Hero title={title} sub={sub}
                dot={connected ? 'ok' : intiface.status === 'error' ? 'bad' : null}
                actions={connected
                    ? <><HeroAction onClick={() => void intiface.rescan()}>重新扫描</HeroAction><HeroAction onClick={() => void intiface.disconnect()}>断开</HeroAction></>
                    : <HeroAction onClick={() => void intiface.connect(url)} disabled={intiface.status === 'connecting'}>连接</HeroAction>} />

            <Group foot="Intiface Central 开着、「Start Server」点过之后才连得上。">
                <FieldRow label="Intiface 地址" value={url} mono placeholder="ws://localhost:12345"
                    onDraft={v => { const next = v.trim(); setUrl(next); localStorage.setItem(URL_KEY, next); }} onCommit={() => {}} />
            </Group>

            {intiface.devices.length > 0 && (
                <Group title="设备">
                    {intiface.devices.map(d => (
                        <Row key={d.index} title={d.displayName ?? d.name} value={`#${d.index}`} dot={connected ? 'ok' : null} />
                    ))}
                </Group>
            )}

            {connected && intiface.devices.length > 0 && (
                <Group title="试一下" foot="拖动时震，松手就停。">
                    <div style={{ padding: '12px 14px 14px' }}>
                        <div className="flex justify-between" style={{ fontSize: 15, color: F.textPrimary, marginBottom: 10 }}>
                            <span>震动强度</span>
                            <span style={{ color: F.textTertiary, fontVariantNumeric: 'tabular-nums' }}>{intensity}%</span>
                        </div>
                        <input type="range" min={0} max={100} value={intensity} aria-label="测试震动强度"
                            onChange={e => { const v = Number(e.target.value); setIntensity(v); void intiface.vibrate(v); }}
                            onPointerUp={() => { setIntensity(0); void intiface.stop(); }}
                            className="w-full" style={{ accentColor: SETTINGS_HUE.main, height: 28, borderRadius: R.pill }} />
                    </div>
                </Group>
            )}
        </Page>
    );
};

export default IntifaceSettingsPage;
// [EM-END: settings-subpages-f]
