// [EM-START: heartbeat-api-chain]
/**
 * 主 API 1–4（聊天，设置 → 主 API 页）、副 API 1–4（心跳，设置 → Mac mini 页）。逻辑在 utils/emApiChain.ts。
 * 主的只在手机上用，选了就存；副的要点「同步到 mini」才把 Key 和顺序送过去（一次推四条，别每拨一下就推）。
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

const COPY: Record<ApiChainTier, { title: string; label: string; foot: string }> = {
    main: {
        title: '聊天的备用 · 主 API 1–4',
        label: '主',
        foot: '先用这个角色自己绑的那条（没绑就是上面的主 API），不通再按 1→4 接着试，一样的会跳过。交给 Mac mini 回复的那一轮也一样。都不选就只用本来那条。',
    },
    sub: {
        title: '心跳用的 · 副 API 1–4',
        label: '副',
        foot: 'TA 醒来想做什么、说什么，按 1→4 试，全挂了推一条通知给你。补朋友圈评论这类小活跟那一跳用上的那条。都不选就用窗台里给每个角色选的那条。',
    },
};

const AgentApiChainGroup: React.FC<{ tier: ApiChainTier; reachable?: boolean; supported?: boolean }> = ({ tier, reachable = true, supported = true }) => {
    const { apiPresets, addToast } = useOS();
    const [choice, setChoice] = useState<ApiChainChoice>(loadApiChain);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const copy = COPY[tier];

    const pick = (index: number, id: string) => {
        // 另一串可能在别的页刚改过：以存着的为准，只换这一格
        const latest = loadApiChain();
        const next = { ...latest, [tier]: latest[tier].map((v, i) => (i === index ? id : v)) };
        setChoice(next);
        saveApiChain(next);
        if (tier === 'sub') setDirty(true);
    };

    const sync = async () => {
        setBusy(true);
        try {
            addToast(await syncApiChain(loadApiChain(), apiPresets), 'success');
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
            <Group title={copy.title} foot={copy.foot}>
                {Array.from({ length: API_CHAIN_SLOTS }, (_, i) => (
                    <Row key={i} title={`${copy.label} ${i + 1}`}
                        right={(
                            <select aria-label={`${copy.label} API 第 ${i + 1} 条`} value={choice[tier][i]} disabled={busy}
                                onChange={event => pick(i, event.target.value)} style={selectStyle}>
                                <option value="">不用</option>
                                {apiPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                            </select>
                        )} />
                ))}
            </Group>
            {tier === 'sub' && (
                <Group foot={!supported && reachable ? 'mini 上的后端还是旧版，没有这一项。在 mini 上拉代码、重启后端就有了。' : '换了预设里的 Key 之后也要再同步一次。'}>
                    <Row title={busy ? '同步中…' : dirty ? '同步到 mini（有改动）' : '同步到 mini'} tone="link" disabled={disabled}
                        onClick={disabled ? undefined : () => void sync()} />
                </Group>
            )}
        </>
    );
};

export default AgentApiChainGroup;
// [EM-END: heartbeat-api-chain]
