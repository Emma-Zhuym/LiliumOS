// [EM-START: machine-room]
/**
 * 机房里的角色详情：心里（心思摘要、两个人的时间到几点）、攒着想说的、最近几跳。
 * 2026-10-27 起心跳开关 / 频率 / API 在「设置 → Mac mini → 角色心跳」，脾气在神经链接；
 * 两个人的时间只写到几点，开关在聊天工具栏的「贴贴」。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChatCircleDots } from '@phosphor-icons/react';

import type { CharacterProfile } from '../../types';
import { F, R, STATUS } from '../../utils/clayTokens';
import { AgentBackend, type AgentModelRun, type AgentPocketItem, type AgentPrivateMoment } from '../../utils/emAgentBackend';
import { statusPhrase } from '../../utils/emDriveStatus';
import { clockText, runKind, runSummary, type RunKind } from '../../utils/emMachineRoom';
import type { AgentMiniData } from '../../hooks/useAgentMiniData';
import { Badge, Card, Empty, P, Row, SectionTitle } from './ui';

const KIND_BADGE: Partial<Record<RunKind, { tone: 'ok' | 'warn' | 'danger' | 'info' | 'plain'; text: string }>> = {
    message: { tone: 'info', text: '发了消息' },
    skipped: { tone: 'plain', text: '没醒' },
    error: { tone: 'danger', text: '出错' },
};

/** 一跳：时间 + 干了什么 + 本来想说的那句 + 心里。出错的原因去设置 → Mac mini 的心跳记录看。 */
const RunCard: React.FC<{ run: AgentModelRun }> = ({ run }) => {
    const kind = runKind(run);
    const badge = KIND_BADGE[kind];
    return (
        <Card>
            <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ fontSize: 12, color: F.textTertiary }}>{clockText(run.startedAt)}</span>
                <span className="flex-1" />
                {run.shadow && kind === 'message' ? <Badge tone="warn">试跑没发</Badge> : badge && <Badge tone={badge.tone}>{badge.text}</Badge>}
            </div>
            <p style={{ fontSize: 14, color: kind === 'error' ? STATUS.danger.ink : F.textPrimary, marginTop: 6, lineHeight: 1.6 }}>{runSummary(run)}</p>
            {run.proposedText && (
                <p style={{ fontSize: 13, color: P.ink, background: P.tint, borderRadius: R.medium, padding: '8px 10px', marginTop: 8, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {run.proposedText}
                </p>
            )}
            {run.reason && <p style={{ fontSize: 12, color: F.textTertiary, marginTop: 6, lineHeight: 1.6 }}>心里：{run.reason}</p>}
        </Card>
    );
};

const CharacterView: React.FC<{ char: CharacterProfile; data: AgentMiniData }> = ({ char, data }) => {
    const backend = data.characters.find(item => item.charId === char.id);
    const connected = Boolean(backend?.credRef);
    const [drives, setDrives] = useState<{ drive: string; level: 'mid' | 'high' }[] | null>(null);
    const [privateMoment, setPrivateMoment] = useState<AgentPrivateMoment | null>(null);
    const [pocket, setPocket] = useState<AgentPocketItem[] | null>(null);
    const runs = useMemo(() => data.runs.filter(run => run.charId === char.id).slice(0, 8), [data.runs, char.id]);
    const trial = data.settings?.drivesTrial ?? data.status?.heartbeat?.drivesTrial;

    useEffect(() => {
        if (!connected || !data.reachable) return;
        let alive = true;
        AgentBackend.driveState(char.id)
            .then(result => { if (alive) { setDrives(result.drives); setPrivateMoment(result.private ?? null); } })
            .catch(() => { /* 旧后端没有心思：这一块显示「还没有」 */ });
        AgentBackend.pocket(char.id).then(items => { if (alive) setPocket(items); }).catch(() => {});
        return () => { alive = false; };
    }, [char.id, connected, data.reachable]);

    if (!connected) {
        return <Empty icon={<ChatCircleDots size={18} weight="bold" color={F.textTertiary} />}>TA 还没接到 mini。在「设置 → Mac mini → 角色心跳」里接上。</Empty>;
    }

    const phrase = drives ? statusPhrase(drives) : '';

    return (
        <>
            <SectionTitle right={trial === true ? '试运行中，只记账' : undefined}>心里</SectionTitle>
            <Card style={{ padding: '2px 16px' }}>
                <Row first title={phrase || (drives ? '都在平常水平' : '还没有心思数据')} sub="只给档位、不给数字，跟查手机首页那句一样" />
                {privateMoment?.active && <Row title="两个人的时间" sub={`到 ${clockText(privateMoment.until)}，这期间心跳不打扰`} />}
            </Card>

            <SectionTitle right={pocket?.length ? `${pocket.length} 句` : undefined}>攒着想说的</SectionTitle>
            {pocket && pocket.length > 0 ? (
                <Card style={{ padding: '2px 16px' }}>
                    {pocket.map((item, index) => (
                        <Row key={`${item.createdAt}-${index}`} first={index === 0} title={<span style={{ fontWeight: 500, whiteSpace: 'normal' }}>{item.text}</span>}
                            sub={`${clockText(item.createdAt)} 攒下${item.expiresAt ? ` · 放到 ${clockText(item.expiresAt)}` : ''}`}
                            right={item.kind === 'grievance' ? <Badge tone="warn">憋着</Badge> : undefined} />
                    ))}
                </Card>
            ) : (
                <Empty icon={<ChatCircleDots size={18} weight="bold" color={F.textTertiary} />}>{pocket ? '现在没有攒着的话。' : '读不到（mini 不在线或者还是旧版）。'}</Empty>
            )}

            <SectionTitle>最近几跳</SectionTitle>
            {runs.length ? runs.map(item => <RunCard key={item.id} run={item} />) : (
                <Empty icon={<ChatCircleDots size={18} weight="bold" color={F.textTertiary} />}>还没醒过。</Empty>
            )}
        </>
    );
};

export default CharacterView;
// [EM-END: machine-room]
