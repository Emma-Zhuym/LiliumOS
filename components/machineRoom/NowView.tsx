// [EM-START: machine-room]
/**
 * 机房「此刻」：mini 在不在（hero 卡，底色恒定 mint tint）+ 每个接上 mini 的角色一行，点进详情。
 * 没接上的角色收在最下面一行小字里，点名字进详情能一键接上。
 */

import React, { useMemo } from 'react';
import { Users } from '@phosphor-icons/react';

import { useOS } from '../../context/OSContext';
import { F, R } from '../../utils/clayTokens';
import { characterLine, linkRows, nextBeatText } from '../../utils/emMachineRoom';
import TokenImg from '../os/TokenImg';
import type { AgentMiniData } from '../../hooks/useAgentMiniData';
import { Card, Dot, Empty, P, PillButton, SectionTitle } from './ui';

const NowView: React.FC<{ data: AgentMiniData; onOpenChar: (id: string) => void; onOpenSettings: () => void }> = ({ data, onOpenChar, onOpenSettings }) => {
    const { characters } = useOS();
    const { status, reachable, settings, failure } = data;
    const latestByChar = useMemo(() => {
        const map = new Map<string, AgentMiniData['runs'][number]>();
        for (const run of data.runs) if (!map.has(run.charId)) map.set(run.charId, run);
        return map;
    }, [data.runs]);
    const backendOf = (id: string) => data.characters.find(item => item.charId === id);
    const connected = characters.filter(char => Boolean(backendOf(char.id)?.credRef));
    const unconnected = characters.filter(char => !backendOf(char.id)?.credRef);

    const shadow = settings?.heartbeatShadow ?? status?.heartbeat?.shadow ?? true;
    const trial = settings?.drivesTrial ?? status?.heartbeat?.drivesTrial;
    const rows = linkRows(status);
    const troubled = rows.filter(row => row.tone === 'warn');

    const heroTitle = reachable === null ? '正在问 mini…' : reachable ? 'Mac mini 在线' : (failure?.title ?? 'mini 在休息'); // [EM: machine-room-reach-reason]
    const heroSub = reachable === false
        ? `${failure?.sub ?? '连不上，多半是每天 4–7 点的休眠，或者在重启。'}下面是上一次拿到的样子。` // [EM: machine-room-reach-reason]
        : [
            shadow ? '心跳只试跑，不真发' : '心跳真发中',
            trial === true ? '心思试运行中' : trial === false ? '心思已生效' : null,
            status?.quiet?.active ? '安静时段' : null,
        ].filter(Boolean).join(' · ');

    return (
        <>
            <Card tint>
                <div className="flex items-center" style={{ gap: 8 }}>
                    <Dot tone={reachable ? 'ok' : 'off'} />
                    <span style={{ fontSize: 16, fontWeight: 700, color: P.ink }}>{heroTitle}</span>
                </div>
                {heroSub && <p style={{ fontSize: 13, color: P.ink, marginTop: 4, lineHeight: 1.6 }}>{heroSub}</p>}
                {reachable && (
                    <div className="flex flex-wrap" style={{ gap: 6, marginTop: 10 }}>
                        {rows.map(row => (
                            <span key={row.key} className="flex items-center" style={{ gap: 5, fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: R.pill, background: F.surface, color: F.textSecondary }}>
                                <Dot tone={row.tone} />{row.label}
                            </span>
                        ))}
                    </div>
                )}
                {reachable && troubled.length > 0 && (
                    <p style={{ fontSize: 12, color: P.ink, marginTop: 8 }}>
                        要看一下：{troubled.map(row => `${row.label}${row.detail ? `（${row.detail}）` : ''}`).join('、')}。
                    </p>
                )}
                <div className="flex justify-end" style={{ marginTop: 10 }}>
                    <PillButton onClick={onOpenSettings}>后台设置</PillButton>
                </div>
            </Card>

            <SectionTitle right={connected.length ? `${connected.length} 个` : undefined}>角色</SectionTitle>
            {connected.length === 0 && data.reachable !== null && (
                <Empty icon={<Users size={18} weight="bold" color={F.textTertiary} />}>
                    还没有角色接到 mini。点下面的名字进去接上。
                </Empty>
            )}
            {connected.map((char, index) => {
                const backend = backendOf(char.id);
                const next = backend?.heartbeatEnabled && !backend.heartbeatPaused ? nextBeatText(backend.nextHeartbeatAt) : '';
                return (
                    <Card key={char.id} onClick={() => onOpenChar(char.id)} style={{ '--i': index } as React.CSSProperties}>
                        <div className="flex items-center" style={{ gap: 12 }}>
                            {char.avatar
                                ? <TokenImg value={char.avatar} alt={char.name} style={{ width: 40, height: 40, borderRadius: R.pill, objectFit: 'cover', flexShrink: 0 }} />
                                : <div className="flex items-center justify-center shrink-0" style={{ width: 40, height: 40, borderRadius: R.pill, background: F.surfaceSunken }}><Users size={18} weight="bold" color={F.textSecondary} /></div>}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center" style={{ gap: 6 }}>
                                    <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{char.name}</span>
                                </div>
                                <p className="truncate" style={{ fontSize: 12, color: F.textTertiary, marginTop: 2 }}>
                                    {characterLine(backend, latestByChar.get(char.id))}
                                </p>
                            </div>
                            {next && <span className="shrink-0" style={{ fontSize: 11, color: F.textTertiary, textAlign: 'right' }}>下一跳<br />{next.split(' · ')[0]}</span>}
                        </div>
                    </Card>
                );
            })}
            {unconnected.length > 0 && (
                <p style={{ fontSize: 12, color: F.textTertiary, padding: '0 4px', lineHeight: 1.8 }}>
                    还没接上：{unconnected.map((char, index) => (
                        <React.Fragment key={char.id}>
                            {index > 0 && '、'}
                            <button type="button" onClick={() => onOpenChar(char.id)} className="active:opacity-60" style={{ color: P.ink, fontSize: 12, fontWeight: 600, background: 'transparent', border: 'none', padding: 0 }}>{char.name}</button>
                        </React.Fragment>
                    ))}
                </p>
            )}
        </>
    );
};

export default NowView;
// [EM-END: machine-room]
