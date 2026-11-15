// [EM-START: heartbeat-api-chain]
/**
 * 设置 → Mac mini：心跳的主 API 1–4、副 API 1–4（全局一份，逻辑在 utils/emApiChain.ts）。
 * 改了不自动推：点「同步到 mini」才把 Key 和顺序送过去（一次推八条，别每拨一下就推）。
 */
import React, { useState } from 'react';

import { useOS } from '../../context/OSContext';
import { F, R } from '../../utils/clayTokens';
import { API_CHAIN_SLOTS, loadApiChain, saveApiChain, syncApiChain, type ApiChainChoice, type ApiChainTier } from '../../utils/emApiChain';
import { Group, Row } from './SettingsParts';

const selectStyle: React.CSSProperties = {
    maxWidth: 170, minHeight: 36, padding: '0 8px', borderRadius: R.input, border: '1px solid transparent',
    background: F.surfaceSunken, color: F.textPrimary, fontSize: 14, outline: 'none',
};

const TIERS: { tier: ApiChainTier; title: string; foot: string }[] = [
    { tier: 'main', title: '心跳用的主 API', foot: 'TA 醒来想做什么、说什么，按 1→4 试。全挂了不会降到副 API，只推一条通知给你。都不选就用窗台里给每个角色选的那条。' },
    { tier: 'sub', title: '杂活用的副 API', foot: '补朋友圈亲友评论这类小活，按 1→4 试，放 flash / 便宜模型就行。都不选就跟那一跳用上的那条。' },
];

const AgentApiChainGroup: React.FC<{ reachable: boolean; supported: boolean }> = ({ reachable, supported }) => {
    const { apiPresets, addToast } = useOS();
    const [choice, setChoice] = useState<ApiChainChoice>(loadApiChain);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);

    const pick = (tier: ApiChainTier, index: number, id: string) => {
        const next = { ...choice, [tier]: choice[tier].map((v, i) => (i === index ? id : v)) };
        setChoice(next);
        saveApiChain(next);
        setDirty(true);
    };

    const sync = async () => {
        setBusy(true);
        try {
            addToast(await syncApiChain(choice, apiPresets), 'success');
            setDirty(false);
        } catch (error) {
            addToast(error instanceof Error ? error.message : '没同步成', 'error');
        } finally {
            setBusy(false);
        }
    };

    const disabled = !reachable || !supported || busy;
    return (
        <>
            {TIERS.map(({ tier, title, foot }) => (
                <Group key={tier} title={title} foot={foot}>
                    {Array.from({ length: API_CHAIN_SLOTS }, (_, i) => (
                        <Row key={i} title={`${tier === 'main' ? '主' : '副'} ${i + 1}`}
                            right={(
                                <select aria-label={`${tier === 'main' ? '主' : '副'} API 第 ${i + 1} 条`} value={choice[tier][i]} disabled={busy}
                                    onChange={event => pick(tier, i, event.target.value)} style={selectStyle}>
                                    <option value="">不用</option>
                                    {apiPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                                </select>
                            )} />
                    ))}
                </Group>
            ))}
            <Group foot={!supported && reachable ? 'mini 上的后端还是旧版，没有这一项。在 mini 上拉代码、重启后端就有了。' : '换了预设里的 Key 之后也要再同步一次。'}>
                <Row title={busy ? '同步中…' : dirty ? '同步到 mini（有改动）' : '同步到 mini'} tone="link" disabled={disabled}
                    onClick={disabled ? undefined : () => void sync()} />
            </Group>
        </>
    );
};

export default AgentApiChainGroup;
// [EM-END: heartbeat-api-chain]
