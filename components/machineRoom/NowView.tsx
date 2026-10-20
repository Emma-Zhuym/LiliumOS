// [EM-START: machine-room]
/**
 * 机房「此刻」：mini 在不在（hero 卡，底色恒定 mint tint）+ 每个角色一行。
 * 点角色进详情。没接到 mini 的角色也列出来，进去能一键接上。
 */

import React, { useMemo } from 'react';
import { Users } from '@phosphor-icons/react';

import { useOS } from '../../context/OSContext';
import { F, R } from '../../utils/clayTokens';
import { characterLine, linkRows, nextBeatText } from '../../utils/emMachineRoom';
import TokenImg from '../os/TokenImg';
import type { MachineRoomData } from '../../apps/MachineRoomApp';
import { Badge, Card, Dot, P, SectionTitle } from './ui';

const NowView: React.FC<{ data: MachineRoomData; onOpenChar: (id: string) => void }> = ({ data, onOpenChar }) => {
    const { characters } = useOS();
    const { status, reachable, settings } = data;
    const latestByChar = useMemo(() => {
        const map = new Map<string, MachineRoomData['runs'][number]>();
        for (const run of data.runs) if (!map.has(run.charId)) map.set(run.charId, run);
        return map;
    }, [data.runs]);
    const backendOf = (id: string) => data.characters.find(item => item.charId === id);

    const shadow = settings?.heartbeatShadow ?? status?.heartbeat?.shadow ?? true;
    const trial = settings?.drivesTrial ?? status?.heartbeat?.drivesTrial;
    const rows = linkRows(status);
    const troubled = rows.filter(row => row.tone === 'warn');

    const heroTitle = reachable === null ? '正在问 mini…' : reachable ? 'Mac mini 在线' : 'mini 在休息';
    const heroSub = reachable === false
        ? '连不上，多半是每天 4–7 点的休眠，或者在重启。下面是上一次拿到的样子。'
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
                        要看一下：{troubled.map(row => `${row.label}${row.detail ? `（${row.detail}）` : ''}`).join('、')}，详情在「连接」。
                    </p>
                )}
            </Card>

            <SectionTitle right={`${characters.length} 个`}>角色</SectionTitle>
            {characters.map((char, index) => {
                const backend = backendOf(char.id);
                const next = backend?.heartbeatEnabled && !backend.heartbeatPaused ? nextBeatText(backend.nextHeartbeatAt) : '';
                const connected = Boolean(backend?.credRef);
                return (
                    <Card key={char.id} onClick={() => onOpenChar(char.id)} style={{ '--i': index } as React.CSSProperties}>
                        <div className="flex items-center" style={{ gap: 12 }}>
                            {char.avatar
                                ? <TokenImg value={char.avatar} alt={char.name} style={{ width: 40, height: 40, borderRadius: R.pill, objectFit: 'cover', flexShrink: 0 }} />
                                : <div className="flex items-center justify-center shrink-0" style={{ width: 40, height: 40, borderRadius: R.pill, background: F.surfaceSunken }}><Users size={18} weight="bold" color={F.textSecondary} /></div>}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center" style={{ gap: 6 }}>
                                    <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{char.name}</span>
                                    {!connected && <Badge>没接上</Badge>}
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
        </>
    );
};

export default NowView;
// [EM-END: machine-room]
