// [EM-START: machine-room]
/**
 * 机房里的角色详情：心跳（接上、开关、多久醒一次、用哪套 API）、心里（心思摘要、两个人的时间到几点）、
 * 攒着想说的、最近几跳。接入逻辑在 utils/emAgentConnect.ts。
 * 2026-10-27 起脾气在神经链接；两个人的时间只写到几点，开关在聊天工具栏的「贴贴」。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChatCircleDots } from '@phosphor-icons/react';

import { useOS } from '../../context/OSContext';
import type { CharacterProfile } from '../../types';
import { F, R, STATUS } from '../../utils/clayTokens';
import { AgentBackend, type AgentModelRun, type AgentPocketItem, type AgentPrivateMoment } from '../../utils/emAgentBackend';
import { connectCharacterToAgent } from '../../utils/emAgentConnect';
import { statusPhrase } from '../../utils/emDriveStatus';
import { HEARTBEAT_API_AUTO, HEARTBEAT_API_CHAT } from '../../utils/emHeartbeatApi';
import { clockText, nextBeatText, runKind, runSummary, type RunKind } from '../../utils/emMachineRoom';
import type { AgentMiniData } from '../../hooks/useAgentMiniData';
import ClayDialog from '../os/ClayDialog';
import { Badge, Card, Empty, P, PillButton, Row, SectionTitle, Toggle, selectStyle } from './ui';

const EVERY_MIN_OPTIONS = [30, 45, 60, 90, 120, 180, 240];

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
    const { addToast, apiConfig, apiPresets, updateCharacter, userProfile } = useOS();
    const backend = data.characters.find(item => item.charId === char.id);
    const connected = Boolean(backend?.credRef);
    const [busy, setBusy] = useState(false);
    const [tuning, setTuning] = useState(false);
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

    const run = async (task: () => Promise<void>) => {
        setBusy(true);
        try { await task(); } catch (error) {
            addToast(error instanceof Error ? error.message : '没改成', 'error');
        } finally { setBusy(false); }
    };
    const connect = (choice?: string) => run(async () => {
        const result = await connectCharacterToAgent(char, {
            apiConfig, apiPresets, userName: userProfile?.name, choice,
            onTemperament: temperament => updateCharacter(char.id, { emDriveTemperament: temperament }),
        });
        addToast(result.message, result.ok ? 'success' : 'error');
        await data.refresh();
    });
    const upsert = (patch: { heartbeatEnabled?: boolean; heartbeatEveryMin?: number }, done: string) => run(async () => {
        await AgentBackend.upsertCharacter({ charId: char.id, ...patch });
        addToast(done, 'success');
        await data.refresh();
        // 刚开心跳时下一跳是后端随后才排上的：过一会儿再问一次，「下一跳」才不会一直写「还没排上」
        if (patch.heartbeatEnabled) setTimeout(() => void data.refresh(), 2000);
    });

    const model = backend?.credRef ? data.credModels[backend.credRef] : undefined;
    const phrase = drives ? statusPhrase(drives) : '';

    const heartbeat = (
        <>
            <SectionTitle right={connected ? (
                <button type="button" onClick={() => setTuning(true)} className="active:opacity-60 transition-opacity"
                    style={{ fontSize: 13, fontWeight: 600, color: P.ink, padding: '12px 4px', margin: '-12px -4px' }}>频率与同步</button>
            ) : undefined}>心跳</SectionTitle>
            {!connected ? (
                <Card>
                    <p style={{ fontSize: 13, color: F.textSecondary, lineHeight: 1.6 }}>还没接到 mini。接上会把 TA 登记过去、同步心跳用的 API、传一份近况，顺手读一下脾气（脾气在神经链接里能改）。</p>
                    <div className="flex" style={{ marginTop: 10 }}><PillButton strong disabled={busy} onClick={() => void connect()}>{busy ? '接着呢…' : '接到 mini'}</PillButton></div>
                </Card>
            ) : (
                <Card style={{ padding: '2px 16px' }}>
                    <Row first title="心跳" sub={backend?.heartbeatPaused ? '暂停中' : backend?.heartbeatEnabled
                        ? `每 ${backend.heartbeatEveryMin ?? 60} 分钟 · 下一跳 ${nextBeatText(backend.nextHeartbeatAt) || '还没排上'}`
                        : '关着：TA 不会自己醒'}
                        right={<Toggle label="心跳" checked={Boolean(backend?.heartbeatEnabled)} disabled={busy}
                            onChange={() => void upsert({ heartbeatEnabled: !backend?.heartbeatEnabled }, backend?.heartbeatEnabled ? '心跳关了' : '心跳开了')} />} />
                    <Row title="用哪套 API" sub={model ? `mini 上现在用：${model}` : undefined}
                        right={<select aria-label="心跳用的 API" value={char.heartbeatApiPresetId ?? HEARTBEAT_API_AUTO} disabled={busy} style={{ ...selectStyle, maxWidth: 140 }}
                            onChange={event => { updateCharacter(char.id, { heartbeatApiPresetId: event.target.value || undefined }); void connect(event.target.value); }}>
                            <option value={HEARTBEAT_API_AUTO}>自动（副 API）</option>
                            <option value={HEARTBEAT_API_CHAT}>跟聊天 API</option>
                            {apiPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                        </select>} />
                </Card>
            )}
            {/* 不常动的两样收进这里：频率一般设一次，同步是换 Key / 改人设后才点 */}
            <ClayDialog isOpen={tuning} title="频率与同步" onClose={() => setTuning(false)}>
                <Card style={{ padding: '2px 16px' }}>
                    <Row first title="多久醒一次" sub="平均值，每一跳会在前后浮动"
                        right={<select aria-label="心跳间隔" value={backend?.heartbeatEveryMin} disabled={busy} style={selectStyle}
                            onChange={event => void upsert({ heartbeatEveryMin: Number(event.target.value) }, `平均每 ${event.target.value} 分钟醒一次`)}>
                            {[...new Set([...EVERY_MIN_OPTIONS, backend?.heartbeatEveryMin ?? 60])].sort((a, b) => a - b).map(minutes => (
                                <option key={minutes} value={minutes}>{minutes} 分钟</option>
                            ))}
                        </select>} />
                    <Row title="重新同步" sub="换了 Key、改了人设之后点一下" right={<PillButton disabled={busy} onClick={() => void connect()}>{busy ? '同步中…' : '同步'}</PillButton>} />
                </Card>
            </ClayDialog>
        </>
    );

    if (!connected) return heartbeat;

    return (
        <>
            {heartbeat}
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
