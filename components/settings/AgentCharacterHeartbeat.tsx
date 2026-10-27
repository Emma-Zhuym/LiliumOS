// [EM-START: machine-room-split]
/**
 * 设置 → Mac mini → 角色心跳：一个角色一行，点开一张单子管 TA 在 mini 上的心跳——
 * 接上 / 重新同步、心跳开关、多久醒一次、用哪套 API。
 *
 * 2026-10-27 从机房的角色详情搬来（机房只看 TA 怎么样，机器的事归设置）。
 * 接入逻辑跟以前一样走 utils/emAgentConnect.ts：登记过去、同步 API、传一份近况，顺手读一下脾气。
 */

import React, { useState } from 'react';

import { useOS } from '../../context/OSContext';
import type { CharacterProfile } from '../../types';
import { F, R } from '../../utils/clayTokens';
import { AgentBackend, type AgentCharacter } from '../../utils/emAgentBackend';
import { connectCharacterToAgent } from '../../utils/emAgentConnect';
import { HEARTBEAT_API_AUTO, HEARTBEAT_API_CHAT } from '../../utils/emHeartbeatApi';
import { nextBeatText } from '../../utils/emMachineRoom';
import type { AgentMiniData } from '../../hooks/useAgentMiniData';
import ClayDialog from '../os/ClayDialog';
import { Group, Row, ToggleRow } from './SettingsParts';

const EVERY_MIN_OPTIONS = [30, 45, 60, 90, 120, 180, 240];

export const selectStyle: React.CSSProperties = {
    background: F.surfaceSunken, border: '1px solid transparent', borderRadius: R.input, padding: '6px 10px',
    fontSize: 14, color: F.textPrimary, outline: 'none', maxWidth: 160,
};

/** 首页那一行右边写什么：没接上 / 心跳关着 / 每 60 分钟 · 下一跳 14:20 */
export const heartbeatRowValue = (backend: AgentCharacter | undefined): string => {
    if (!backend?.credRef) return '没接上';
    if (backend.heartbeatPaused) return '暂停中';
    if (!backend.heartbeatEnabled) return '心跳关着';
    const next = nextBeatText(backend.nextHeartbeatAt);
    return next ? `下一跳 ${next.split(' · ')[0]}` : `每 ${backend.heartbeatEveryMin} 分钟`;
};

const AgentCharacterHeartbeat: React.FC<{ char: CharacterProfile | null; data: AgentMiniData; onClose: () => void }> = ({ char, data, onClose }) => {
    const { addToast, apiConfig, apiPresets, updateCharacter, userProfile } = useOS();
    const [busy, setBusy] = useState(false);
    const backend = char ? data.characters.find(item => item.charId === char.id) : undefined;
    const connected = Boolean(backend?.credRef);

    const run = async (task: () => Promise<void>) => {
        setBusy(true);
        try { await task(); } catch (error) {
            addToast(error instanceof Error ? error.message : '没改成', 'error');
        } finally { setBusy(false); }
    };
    const connect = (choice?: string) => char && run(async () => {
        const result = await connectCharacterToAgent(char, {
            apiConfig, apiPresets, userName: userProfile?.name, choice,
            onTemperament: temperament => updateCharacter(char.id, { emDriveTemperament: temperament }),
        });
        addToast(result.message, result.ok ? 'success' : 'error');
        await data.refresh();
    });
    const upsert = (patch: { heartbeatEnabled?: boolean; heartbeatEveryMin?: number }, done: string) => char && run(async () => {
        await AgentBackend.upsertCharacter({ charId: char.id, ...patch });
        addToast(done, 'success');
        await data.refresh();
        // 刚开心跳时下一跳是后端随后才排上的：过一会儿再问一次，「下一跳」才不会一直写「还没排上」
        if (patch.heartbeatEnabled) setTimeout(() => void data.refresh(), 2000);
    });

    const model = backend?.credRef ? data.credModels[backend.credRef] : undefined;

    return (
        <ClayDialog isOpen={Boolean(char)} title={char ? `${char.name}的心跳` : '心跳'} onClose={onClose}>
            {char && (
                <div className="flex flex-col" style={{ gap: 22 }}>
                    {!connected ? (
                        <Group foot="接上会把 TA 登记到 mini、同步心跳用的 API、传一份近况，顺手读一下脾气（脾气在神经链接里能改）。">
                            <Row title={busy ? '接着呢…' : '接到 mini'} tone="link" disabled={busy || !data.reachable} onClick={() => void connect()} />
                        </Group>
                    ) : (
                        <>
                            <Group>
                                <ToggleRow title="心跳" checked={Boolean(backend?.heartbeatEnabled)} disabled={busy}
                                    sub={backend?.heartbeatPaused ? '暂停中' : backend?.heartbeatEnabled ? `下一跳 ${nextBeatText(backend.nextHeartbeatAt) || '还没排上'}` : '关着：TA 不会自己醒'}
                                    onChange={next => void upsert({ heartbeatEnabled: next }, next ? '心跳开了' : '心跳关了')} />
                                <Row title="多久醒一次" sub="平均值，每一跳会在前后浮动"
                                    right={<select aria-label="心跳间隔" value={backend?.heartbeatEveryMin} disabled={busy} style={selectStyle}
                                        onChange={event => void upsert({ heartbeatEveryMin: Number(event.target.value) }, `平均每 ${event.target.value} 分钟醒一次`)}>
                                        {[...new Set([...EVERY_MIN_OPTIONS, backend?.heartbeatEveryMin ?? 60])].sort((a, b) => a - b).map(minutes => (
                                            <option key={minutes} value={minutes}>{minutes} 分钟</option>
                                        ))}
                                    </select>} />
                                <Row title="用哪套 API" sub={model ? `mini 上现在用：${model}` : undefined}
                                    right={<select aria-label="心跳用的 API" value={char.heartbeatApiPresetId ?? HEARTBEAT_API_AUTO} disabled={busy} style={selectStyle}
                                        onChange={event => { updateCharacter(char.id, { heartbeatApiPresetId: event.target.value || undefined }); void connect(event.target.value); }}>
                                        <option value={HEARTBEAT_API_AUTO}>自动（副 API）</option>
                                        <option value={HEARTBEAT_API_CHAT}>跟聊天 API</option>
                                        {apiPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                                    </select>} />
                            </Group>
                            <Group foot="换了 Key、改了人设之后点一下。">
                                <Row title={busy ? '同步中…' : '重新同步'} tone="link" disabled={busy || !data.reachable} onClick={() => void connect()} />
                            </Group>
                        </>
                    )}
                </div>
            )}
        </ClayDialog>
    );
};

export default AgentCharacterHeartbeat;
// [EM-END: machine-room-split]
