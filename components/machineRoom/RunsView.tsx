// [EM-START: machine-room]
/**
 * 机房「记录」：所有角色最近的心跳流水，按「发了消息 / 过日子 / 被跳过 / 出错」筛。
 * 角色本来想说的那句（试跑没发出去的也算）和 TA 心里的想法（reason）都摆出来，排查就靠这个。
 * 心思曲线（试运行满一周后要看的）以后也放这里。
 */

import React, { useMemo, useState } from 'react';
import { ListBullets } from '@phosphor-icons/react';

import { useOS } from '../../context/OSContext';
import { F, R, STATUS } from '../../utils/clayTokens';
import { clockText, matchesFilter, RUN_FILTERS, runKind, runSummary, type RunKind } from '../../utils/emMachineRoom';
import type { AgentModelRun } from '../../utils/emAgentBackend';
import type { MachineRoomData } from '../../apps/MachineRoomApp';
import { Badge, Card, Empty, P } from './ui';

const KIND_BADGE: Partial<Record<RunKind, { tone: 'ok' | 'warn' | 'danger' | 'info' | 'plain'; text: string }>> = {
    message: { tone: 'info', text: '发了消息' },
    skipped: { tone: 'plain', text: '没醒' },
    error: { tone: 'danger', text: '出错' },
};

export const RunCard: React.FC<{ run: AgentModelRun; name?: string; onOpenChar?: () => void }> = ({ run, name, onOpenChar }) => {
    const kind = runKind(run);
    const badge = KIND_BADGE[kind];
    return (
        <Card>
            <div className="flex items-center" style={{ gap: 8 }}>
                {name && (onOpenChar
                    ? <button type="button" onClick={onOpenChar} className="truncate active:opacity-60" style={{ fontSize: 14, fontWeight: 700, color: F.textPrimary }}>{name}</button>
                    : <span className="truncate" style={{ fontSize: 14, fontWeight: 700, color: F.textPrimary }}>{name}</span>)}
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

const RunsView: React.FC<{ data: MachineRoomData; onOpenChar: (id: string) => void }> = ({ data, onOpenChar }) => {
    const { characters } = useOS();
    const [filter, setFilter] = useState<RunKind | 'all'>('all');
    const shown = useMemo(() => data.runs.filter(run => matchesFilter(run, filter)), [data.runs, filter]);
    const nameOf = (id: string) => characters.find(char => char.id === id)?.name ?? id;

    return (
        <>
            <div className="flex flex-wrap" style={{ gap: 8 }}>
                {RUN_FILTERS.map(item => {
                    const active = filter === item.id;
                    return (
                        <button key={item.id} type="button" onClick={() => setFilter(item.id)}
                            className="active:opacity-60 transition-opacity"
                            style={{
                                fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: R.pill,
                                background: active ? P.tint : F.surface, color: active ? P.ink : F.textSecondary,
                                border: `1px solid ${active ? P.soft : F.borderSoft}`,
                            }}>
                            {item.label}
                        </button>
                    );
                })}
            </div>
            {shown.length === 0
                ? <Empty icon={<ListBullets size={18} weight="bold" color={F.textTertiary} />}>{data.runs.length ? '这一类最近没有。' : '还没有记录。角色第一次醒来之后这里就会有东西。'}</Empty>
                : shown.map(run => <RunCard key={run.id} run={run} name={nameOf(run.charId)} onOpenChar={() => onOpenChar(run.charId)} />)}
        </>
    );
};

export default RunsView;
// [EM-END: machine-room]
