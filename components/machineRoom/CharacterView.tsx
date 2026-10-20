// [EM-START: machine-room]
/**
 * 机房里的角色详情：心跳（开关、频率、用哪套 API）、心里（心思摘要、两个人的时间）、
 * 脾气（原来藏在心跳面板一行 10px 的小字里）、攒着想说的、最近几跳。
 * 接入逻辑和脾气读写跟设置页的心跳面板共用（utils/emAgentConnect.ts、hooks/useTemperament.ts）。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChatCircleDots } from '@phosphor-icons/react';

import { useOS } from '../../context/OSContext';
import type { CharacterProfile, DriveKey, DriveLevel, DriveTemperament } from '../../types';
import { F } from '../../utils/clayTokens';
import { AgentBackend, type AgentPocketItem, type AgentPrivateMoment } from '../../utils/emAgentBackend';
import { connectCharacterToAgent } from '../../utils/emAgentConnect';
import { statusPhrase } from '../../utils/emDriveStatus';
import { HEARTBEAT_API_AUTO, HEARTBEAT_API_CHAT } from '../../utils/emHeartbeatApi';
import { clockText, nextBeatText } from '../../utils/emMachineRoom';
import { DRIVE_KEYS, DRIVE_NAMES, LEVEL_NAMES, OUTLET_NAMES, RECOVERY_NAMES, editTemperament } from '../../utils/emTemperament';
import { useTemperament } from '../../hooks/useTemperament';
import type { MachineRoomData } from '../../apps/MachineRoomApp';
import { RunCard } from './RunsView';
import { Badge, Card, Empty, PillButton, Row, SectionTitle, Toggle, selectStyle } from './ui';

const EVERY_MIN_OPTIONS = [30, 45, 60, 90, 120, 180, 240];
const LEVELS: DriveLevel[] = ['low', 'mid', 'high'];

const TemperamentCard: React.FC<{ char: CharacterProfile }> = ({ char }) => {
    const { temperament: t, busy, save, read } = useTemperament(char);
    const setLevel = (field: 'baseline' | 'sensitivity', key: DriveKey, level: DriveLevel) =>
        t && void save(editTemperament(t, { [field]: { ...t[field], [key]: level } }));
    const select = (value: string, onChange: (value: string) => void, options: [string, string][], label: string) => (
        <select aria-label={label} value={value} disabled={busy} onChange={event => onChange(event.target.value)} style={{ ...selectStyle, padding: '4px 8px', fontSize: 12 }}>
            {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
    );
    return (
        <Card>
            <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>脾气</span>
                {t && <Badge tone={t.source === 'confirmed' ? 'ok' : 'plain'}>{t.source === 'confirmed' ? '你改过' : '自动读的'}</Badge>}
                <span className="flex-1" />
                <PillButton onClick={() => void read()} disabled={busy}>{busy ? '读着呢…' : t ? '重新读一遍' : '读一下'}</PillButton>
            </div>
            <p style={{ fontSize: 12, color: F.textTertiary, marginTop: 6, lineHeight: 1.6 }}>
                {t?.reasoning || '读一下人设，定这个角色各种心思平时多强、多容易被触动。读完每一项都能改。'}
            </p>
            {t && (
                <>
                    <div className="grid items-center" style={{ gridTemplateColumns: '3.5rem 1fr 1fr', gap: '6px 8px', marginTop: 10, fontSize: 13, color: F.textSecondary }}>
                        <span />
                        <span style={{ fontSize: 11, color: F.textTertiary }}>平时</span>
                        <span style={{ fontSize: 11, color: F.textTertiary }}>多容易触动</span>
                        {DRIVE_KEYS.filter(key => !t.disabled.includes(key)).map(key => (
                            <React.Fragment key={key}>
                                <span>{DRIVE_NAMES[key]}</span>
                                {(['baseline', 'sensitivity'] as const).map(field => (
                                    <React.Fragment key={field}>
                                        {select(t[field][key] ?? 'mid', value => setLevel(field, key, value as DriveLevel), LEVELS.map(level => [level, LEVEL_NAMES[level]]), `${DRIVE_NAMES[key]}${field === 'baseline' ? '平时' : '多容易触动'}`)}
                                    </React.Fragment>
                                ))}
                            </React.Fragment>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center" style={{ gap: '8px 12px', marginTop: 10, fontSize: 13, color: F.textSecondary }}>
                        <span className="flex items-center" style={{ gap: 6 }}>别扭、压力消得
                            {select(t.recovery, value => void save(editTemperament(t, { recovery: value as DriveTemperament['recovery'] })), Object.entries(RECOVERY_NAMES), '别扭压力消得快慢')}
                        </span>
                        <span className="flex items-center" style={{ gap: 6 }}>压力大时
                            {select(t.stressOutlet, value => void save(editTemperament(t, { stressOutlet: value as DriveTemperament['stressOutlet'] })), Object.entries(OUTLET_NAMES), '压力出口')}
                        </span>
                    </div>
                    {t.disabled.length > 0 && <p style={{ fontSize: 12, color: F.textTertiary, marginTop: 8 }}>不适用：{t.disabled.map(key => DRIVE_NAMES[key]).join('、')}</p>}
                </>
            )}
        </Card>
    );
};

const CharacterView: React.FC<{ char: CharacterProfile; data: MachineRoomData }> = ({ char, data }) => {
    const { addToast, apiConfig, apiPresets, updateCharacter, userProfile } = useOS();
    const backend = data.characters.find(item => item.charId === char.id);
    const connected = Boolean(backend?.credRef);
    const [busy, setBusy] = useState(false);
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
    const togglePrivate = () => run(async () => {
        const next = await AgentBackend.setPrivateMoment(char.id, !privateMoment?.active);
        setPrivateMoment(next);
        addToast(next.active ? '两个人的时间开始了：2 小时内 TA 不会主动来打扰' : '两个人的时间结束了', 'success');
    });

    const model = backend?.credRef ? data.credModels[backend.credRef] : undefined;
    const phrase = drives ? statusPhrase(drives) : '';

    return (
        <>
            <SectionTitle>心跳</SectionTitle>
            {!connected ? (
                <Card>
                    <p style={{ fontSize: 13, color: F.textSecondary, lineHeight: 1.6 }}>还没接到 mini。接上会把 TA 登记过去、同步心跳用的 API、传一份近况，顺手读一下脾气。</p>
                    <div className="flex" style={{ marginTop: 10 }}><PillButton strong disabled={busy} onClick={() => void connect()}>{busy ? '接着呢…' : '接到 mini'}</PillButton></div>
                </Card>
            ) : (
                <Card style={{ padding: '2px 16px' }}>
                    <Row first title="心跳" sub={backend?.heartbeatPaused ? '暂停中' : backend?.heartbeatEnabled ? `下一跳 ${nextBeatText(backend.nextHeartbeatAt) || '还没排上'}` : '关着：TA 不会自己醒'}
                        right={<Toggle label="心跳" checked={Boolean(backend?.heartbeatEnabled)} disabled={busy}
                            onChange={() => void upsert({ heartbeatEnabled: !backend?.heartbeatEnabled }, backend?.heartbeatEnabled ? '心跳关了' : '心跳开了')} />} />
                    <Row title="多久醒一次" sub="平均值，每一跳会在前后浮动"
                        right={<select aria-label="心跳间隔" value={backend?.heartbeatEveryMin} disabled={busy} style={selectStyle}
                            onChange={event => void upsert({ heartbeatEveryMin: Number(event.target.value) }, `平均每 ${event.target.value} 分钟醒一次`)}>
                            {[...new Set([...EVERY_MIN_OPTIONS, backend?.heartbeatEveryMin ?? 60])].sort((a, b) => a - b).map(minutes => (
                                <option key={minutes} value={minutes}>{minutes} 分钟</option>
                            ))}
                        </select>} />
                    <Row title="用哪套 API" sub={model ? `mini 上现在用：${model}` : undefined}
                        right={<select aria-label="心跳用的 API" value={char.heartbeatApiPresetId ?? HEARTBEAT_API_AUTO} disabled={busy} style={{ ...selectStyle, maxWidth: 140 }}
                            onChange={event => { updateCharacter(char.id, { heartbeatApiPresetId: event.target.value || undefined }); void connect(event.target.value); }}>
                            <option value={HEARTBEAT_API_AUTO}>自动（副 API）</option>
                            <option value={HEARTBEAT_API_CHAT}>跟聊天 API</option>
                            {apiPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                        </select>} />
                    <Row title="重新同步" sub="换了 Key、改了人设之后点一下" right={<PillButton disabled={busy} onClick={() => void connect()}>同步</PillButton>} />
                </Card>
            )}

            {connected && (
                <>
                    <SectionTitle right={trial === true ? '试运行中，只记账' : undefined}>心里</SectionTitle>
                    <Card style={{ padding: '2px 16px' }}>
                        <Row first title={phrase || (drives ? '都在平常水平' : '还没有心思数据')} sub="只给档位、不给数字，跟查手机首页那句一样" />
                        <Row title="两个人的时间" sub={privateMoment?.active ? `到 ${clockText(privateMoment.until)}，这期间心跳不打扰` : '开着时心跳整个跳过；聊天工具栏的「贴贴」也是它'}
                            right={<Toggle label="两个人的时间" checked={Boolean(privateMoment?.active)} disabled={busy || privateMoment === null} onChange={() => void togglePrivate()} />} />
                    </Card>
                </>
            )}

            <TemperamentCard char={char} />

            {connected && (
                <>
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
            )}
        </>
    );
};

export default CharacterView;
// [EM-END: machine-room]
