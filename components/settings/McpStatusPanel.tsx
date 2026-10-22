// [EM-START: settings-ios-list]
/**
 * 设置 → MCP 工具 子页顶部：几台在线、哪台连不上、为什么，外加「全部重测」。
 * 下面的服务器配置仍是原来那块（Settings 里的 MCP 区块和配置弹窗），这里只管看一眼是不是都活着。
 */

import React, { useEffect, useState } from 'react';
import { F } from '../../utils/clayTokens';
import { checkMcpHealth, getMcpHealth, mcpServersToCheck, subscribeMcpHealth } from '../../utils/emMcpHealth';
import { relativeAgo } from '../../utils/emSettingsPages';
import { SettingsGroup, SettingsHero, SettingsRow, SettingsTextButton } from './SettingsHome';

export default function McpStatusPanel() {
    const [{ health, checking }, setState] = useState(getMcpHealth);
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const off = subscribeMcpHealth((h, c) => { setState({ health: h, checking: c }); setNow(Date.now()); });
        void checkMcpHealth();
        return off;
    }, []);

    const configured = mcpServersToCheck().length;
    if (!configured) return null;

    const results = health?.results ?? [];
    const online = results.filter(r => r.ok).length;
    const title = checking && !health ? '正在测…' : `${online}/${results.length} 在线`;
    const sub = checking
        ? '挨个连一遍，几秒钟'
        : health ? `${relativeAgo(health.checkedAt, now)}测过 · 只算开着的服务器` : '';

    return (
        <div className="flex flex-col" style={{ gap: 16 }}>
            <SettingsHero title={title} sub={sub}
                action={<SettingsTextButton onClick={() => void checkMcpHealth(true)} disabled={checking}>{checking ? '测试中…' : '全部重测'}</SettingsTextButton>} />
            {results.length > 0 && (
                <SettingsGroup>
                    {results.map((r, i) => (
                        <SettingsRow key={r.id} first={i === 0} chevron={false}
                            title={r.name}
                            sub={<span style={{ color: r.ok ? F.textTertiary : undefined }}>{r.message}</span>}
                            value={r.ok ? '在线' : '连不上'} dot={r.ok ? 'ok' : 'bad'} valueTone={r.ok ? 'plain' : 'bad'} />
                    ))}
                </SettingsGroup>
            )}
        </div>
    );
}
// [EM-END: settings-ios-list]
