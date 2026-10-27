// [EM-START: machine-room-split]
/**
 * 设置 → Mac mini → 心跳记录：所有角色最近的心跳流水，按「发消息 / 过日子 / 跳过 / 出错」筛。
 * 排查「角色怎么又不说话了」用：出错的原文、没醒的原因、试跑没发出去的那句都在这里。
 * 2026-10-27 从机房「记录」页搬来；机房的角色详情只留 TA 最近几跳的人话版。
 */

import React, { useMemo, useState } from 'react';
import { ListBullets } from '@phosphor-icons/react';

import { useOS } from '../../context/OSContext';
import { F, R, STATUS } from '../../utils/clayTokens';
import type { AgentModelRun } from '../../utils/emAgentBackend';
import { clockText, matchesFilter, RUN_FILTERS, runKind, runSummary, type RunKind } from '../../utils/emMachineRoom';
import ClayDialog from '../os/ClayDialog';
import { SETTINGS_HUE as P } from './SettingsHome';
import { Segmented } from './SettingsParts';

const KIND_LABEL: Partial<Record<RunKind, { tone: 'info' | 'plain' | 'danger'; text: string }>> = {
    message: { tone: 'info', text: '发了消息' },
    skipped: { tone: 'plain', text: '没醒' },
    error: { tone: 'danger', text: '出错' },
};

const Badge: React.FC<{ tone: 'info' | 'plain' | 'danger' | 'warn'; children: React.ReactNode }> = ({ tone, children }) => {
    const pair = tone === 'plain' ? { tint: F.surfaceSunken, ink: F.textSecondary }
        : tone === 'warn' ? STATUS.warning : tone === 'danger' ? STATUS.danger : STATUS.info;
    return <span className="shrink-0 whitespace-nowrap" style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: R.pill, background: pair.tint, color: pair.ink }}>{children}</span>;
};

const RunItem: React.FC<{ run: AgentModelRun; name: string }> = ({ run, name }) => {
    const kind = runKind(run);
    const label = KIND_LABEL[kind];
    return (
        <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: '12px 14px' }}>
            <div className="flex items-center" style={{ gap: 8 }}>
                <span className="truncate" style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary }}>{name}</span>
                <span style={{ fontSize: 12, color: F.textTertiary, fontVariantNumeric: 'tabular-nums' }}>{clockText(run.startedAt)}</span>
                <span className="flex-1" />
                {run.shadow && kind === 'message' ? <Badge tone="warn">试跑没发</Badge> : label && <Badge tone={label.tone}>{label.text}</Badge>}
            </div>
            <p style={{ fontSize: 14, color: kind === 'error' ? STATUS.danger.ink : F.textPrimary, marginTop: 6, lineHeight: 1.6, wordBreak: 'break-word' }}>{runSummary(run)}</p>
            {run.proposedText && (
                <p style={{ fontSize: 13, color: P.ink, background: P.tint, borderRadius: R.medium, padding: '8px 10px', marginTop: 8, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {run.proposedText}
                </p>
            )}
            {run.reason && <p style={{ fontSize: 12, color: F.textTertiary, marginTop: 6, lineHeight: 1.6 }}>心里：{run.reason}</p>}
        </div>
    );
};

const AgentRunsSheet: React.FC<{ open: boolean; runs: AgentModelRun[]; onClose: () => void }> = ({ open, runs, onClose }) => {
    const { characters } = useOS();
    const [filter, setFilter] = useState<RunKind | 'all'>('all');
    const shown = useMemo(() => runs.filter(run => matchesFilter(run, filter)), [runs, filter]);
    const nameOf = (id: string) => characters.find(char => char.id === id)?.name ?? id;

    return (
        <ClayDialog isOpen={open} title="心跳记录" onClose={onClose}>
            <div className="flex flex-col" style={{ gap: 12 }}>
                <Segmented standalone label="筛选心跳记录" value={filter} onChange={setFilter}
                    options={RUN_FILTERS.map(item => ({ value: item.id, label: item.label }))} />
                {shown.length === 0 ? (
                    <div className="flex flex-col items-center text-center" style={{ gap: 8, background: F.surfaceSunken, borderRadius: R.bigCard, padding: '20px 16px', fontSize: 13, color: F.textTertiary }}>
                        <ListBullets size={18} weight="bold" color={F.textTertiary} />
                        {runs.length ? '这一类最近没有。' : '还没有记录。角色第一次醒来之后这里就会有东西。'}
                    </div>
                ) : shown.map(run => <RunItem key={run.id} run={run} name={nameOf(run.charId)} />)}
            </div>
        </ClayDialog>
    );
};

export default AgentRunsSheet;
// [EM-END: machine-room-split]
