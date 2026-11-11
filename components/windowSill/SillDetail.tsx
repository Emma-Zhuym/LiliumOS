// [EM-START: window-sill]
/**
 * 窗台 · 点进一个人（画布「C3 · 点进一个人」定稿，2026-11-10）。从上到下：
 *   顶卡：这一季的图案（跟手指动）+ 心思 + 这一跳在干嘛；左下 API 选择器，右下下一跳
 *   你不在时：每一跳干了什么，时间下面一个小胶囊写用了什么软件
 *   七日心事：九种心思七天的浓淡，一整页用 TA 的颜色，底下一句「最重的一笔」
 *   未寄的话：攒着还没说的话，一句一页，右边半透明索引贴翻页（别页的贴压在纸下）
 *   作息：让 TA 自己醒来的开关 + 频率与同步
 * 取值全部来自 utils/sillTokens.ts（窗台不走 F）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useOS } from '../../context/OSContext';
import type { CharacterProfile } from '../../types';
import { AgentBackend, type AgentPocketItem } from '../../utils/emAgentBackend';
import { connectCharacterToAgent } from '../../utils/emAgentConnect';
import { statusPhrase } from '../../utils/emDriveStatus';
import { HEARTBEAT_API_AUTO, HEARTBEAT_API_CHAT } from '../../utils/emHeartbeatApi';
import { clockText, nextBeatText, runSummary } from '../../utils/emMachineRoom';
import { beatText, runApp, SILL_DRIVE_GROUPS, strongestLine, weekdayLabels } from '../../utils/emWindowSill';
import { SILL, SILL_FLAG, SILL_FONT, SILL_HEAT_ALPHA, type SillTheme } from '../../utils/sillTokens';
import type { AgentMiniData } from '../../hooks/useAgentMiniData';
import ClayDialog from '../os/ClayDialog';
import SillPaper from './SillPaper';
import SillPattern, { useFingerTrail } from './SillPattern';
import { useSize } from './useSize';
import './windowSill.css';

const EVERY_MIN_OPTIONS = [30, 45, 60, 90, 120, 180, 240];

const Title: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
    <div className="flex items-center justify-between" style={{ minHeight: 44 }}>
        <span style={{ fontFamily: SILL_FONT.serif, fontSize: 17, fontWeight: 600, color: SILL.ink }}>{children}</span>
        {right}
    </div>
);

const LinkButton: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean }> = ({ onClick, children, disabled }) => (
    <button type="button" onClick={onClick} disabled={disabled} className="active:opacity-40 transition-opacity disabled:opacity-40"
        style={{ minHeight: 44, border: 'none', background: 'none', padding: 0, fontSize: 13, color: SILL.ink, textDecoration: 'underline', textUnderlineOffset: 4 }}>
        {children}
    </button>
);

const Switch: React.FC<{ checked: boolean; onChange: () => void; label: string; theme: SillTheme; disabled?: boolean }> = ({ checked, onChange, label, theme, disabled }) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} disabled={disabled}
        className="disabled:opacity-50"
        style={{ position: 'relative', width: 51, height: 31, flexShrink: 0, border: 'none', borderRadius: 999, padding: 0, background: checked ? theme.accent : SILL.switchOff, transition: 'background-color 200ms ease' }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 22 : 2, width: 27, height: 27, borderRadius: '50%', background: SILL.paper, transition: 'left 200ms ease' }} />
    </button>
);

// ── 顶卡 ───────────────────────────────────────────────────────
const Hero: React.FC<{ theme: SillTheme; mood: string; line: string; next: string; api?: React.ReactNode }> = ({ theme, mood, line, next, api }) => {
    const ref = useRef<HTMLDivElement>(null);
    const size = useSize(ref);
    const { trail, handlers } = useFingerTrail();
    return (
        <div ref={ref} className="sill-card" {...handlers}
            style={{ height: 150, flexShrink: 0, overflow: 'hidden', borderRadius: SILL.radius, background: theme.field, color: theme.text, transition: 'background-color 260ms ease' }}>
            <SillPattern key={theme.id} theme={theme} width={size.width} height={size.height} hero trail={trail} />
            <div style={{ position: 'absolute', left: 20, right: 20, top: 16, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
                <div style={{ fontFamily: SILL_FONT.serif, fontSize: 24, fontWeight: 600, color: theme.mood, lineHeight: 1.1 }}>{mood}</div>
                {line && <div className="line-clamp-2" style={{ fontSize: 13, lineHeight: 1.55 }}>{line}</div>}
            </div>
            {api}
            {next && <div style={{ position: 'absolute', right: 16, bottom: 16, fontFamily: SILL_FONT.type, fontSize: 10, letterSpacing: '.14em', color: theme.nextText, pointerEvents: 'none' }}>{next}</div>}
        </div>
    );
};

// ── 未寄的话 ───────────────────────────────────────────────────
const Unsent: React.FC<{ theme: SillTheme; items: AgentPocketItem[] }> = ({ theme, items }) => {
    const [page, setPage] = useState(0);
    const [fading, setFading] = useState(false);
    const current = items[Math.min(page, items.length - 1)];
    const pick = (index: number) => {
        if (index === page || fading) return;
        setFading(true);
        window.setTimeout(() => {
            setPage(index);
            requestAnimationFrame(() => setFading(false));
        }, 180);
    };
    return (
        <div style={{ position: 'relative', paddingRight: items.length > 1 ? 26 : 0 }}>
            <div role="tabpanel" style={{ position: 'relative', zIndex: 1, overflow: 'hidden', background: theme.field, color: theme.text, borderRadius: SILL.radius, padding: `16px ${items.length > 1 ? 30 : 18}px 14px 18px`, minHeight: 120, boxSizing: 'border-box' }}>
                <SillPaper theme={theme} />
                <div className="sill-note-body" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, opacity: fading ? 0 : 1 }}>
                    <div style={{ fontFamily: SILL_FONT.serif, fontSize: 15, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{current.text}</div>
                    <div style={{ fontSize: 11, color: theme.textSoft }}>
                        {clockText(current.createdAt)} 想到的{current.kind === 'grievance' ? ' · 憋着的' : ''}
                    </div>
                </div>
            </div>
            {items.length > 1 && (
                <div role="tablist" aria-label="未寄的话" style={{ position: 'absolute', right: 0, top: 14, display: 'flex', flexDirection: 'column' }}>
                    {items.slice(0, 6).map((item, index) => {
                        const on = index === page;
                        return (
                            <button key={`${item.createdAt}-${index}`} type="button" role="tab" aria-selected={on} aria-label={`第 ${index + 1} 句`} onClick={() => pick(index)}
                                style={{ position: 'relative', zIndex: on ? 2 : 0, width: 44, height: 34, border: 'none', background: 'none', padding: 0 }}>
                                <span className="sill-flag" style={{
                                    position: 'absolute', right: on ? 0 : 6, top: 3, width: 36, height: 28, boxSizing: 'border-box', borderRadius: '1px 4px 4px 1px',
                                    background: on ? theme.flagOn : theme.flagOff, borderTop: `1px solid ${SILL_FLAG.topEdge}`, borderBottom: `1px solid ${on ? theme.flagOnEdge : theme.flagOffEdge}`,
                                    boxShadow: on ? SILL_FLAG.shadowOn : SILL_FLAG.shadowOff,
                                }} />
                                <span className="sill-flag" style={{ position: 'absolute', right: on ? 0 : 6, top: 3, width: 8, height: 28, borderRadius: '0 4px 4px 0', background: on ? SILL_FLAG.sheenOn : SILL_FLAG.sheenOff }} />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ── 整页 ───────────────────────────────────────────────────────
const SillDetail: React.FC<{ char: CharacterProfile; data: AgentMiniData; theme: SillTheme }> = ({ char, data, theme }) => {
    const { addToast, apiConfig, apiPresets, updateCharacter, userProfile } = useOS();
    const backend = data.characters.find(item => item.charId === char.id);
    const connected = Boolean(backend?.credRef);
    const [busy, setBusy] = useState(false);
    const [tuning, setTuning] = useState(false);
    const [shown, setShown] = useState(6);
    const [drives, setDrives] = useState<{ drive: string; level: 'mid' | 'high' }[] | null>(null);
    const [pocket, setPocket] = useState<AgentPocketItem[] | null>(null);
    const [week, setWeek] = useState<{ days: string[]; rows: { drive: string; levels: number[] }[] } | null | 'none'>(null);
    const runs = useMemo(() => data.runs.filter(run => run.charId === char.id), [data.runs, char.id]);

    useEffect(() => {
        if (!connected || !data.reachable) return;
        let alive = true;
        AgentBackend.driveState(char.id).then(result => { if (alive) setDrives(result.drives); }).catch(() => {});
        AgentBackend.pocket(char.id).then(items => { if (alive) setPocket(items); }).catch(() => {});
        // 旧后端没有 /drives/week：七日心事那块说「mini 还是旧版」
        AgentBackend.driveWeek(char.id).then(result => { if (alive) setWeek(result); }).catch(() => { if (alive) setWeek('none'); });
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
        // 刚开心跳时下一跳是后端随后才排上的：过一会儿再问一次
        if (patch.heartbeatEnabled) setTimeout(() => void data.refresh(), 2000);
    });

    const mood = drives ? (statusPhrase(drives.slice(0, 1)) || '平平常常') : connected ? '…' : '还没接到 mini';
    const latest = runs[0];
    const line = connected ? (latest ? runSummary(latest) : '还没醒过') : '接上以后，TA 会在你不在的时候自己醒来过日子';
    const awake = Boolean(backend?.heartbeatEnabled) && !backend?.heartbeatPaused;
    const next = awake ? `下一跳 ${(nextBeatText(backend?.nextHeartbeatAt) || '').split(' · ')[0] || '还没排上'}` : '';

    const apiSelect = connected ? (
        <label style={{ position: 'absolute', left: 0, bottom: 0, height: 44, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8, color: theme.apiText }}>
            <span style={{ flexShrink: 0, fontFamily: SILL_FONT.type, fontSize: 10, letterSpacing: '.14em' }}>API</span>
            <select aria-label="心跳用的 API" value={char.heartbeatApiPresetId ?? HEARTBEAT_API_AUTO} disabled={busy}
                onChange={event => { updateCharacter(char.id, { heartbeatApiPresetId: event.target.value || undefined }); void connect(event.target.value); }}
                style={{ maxWidth: 160, minHeight: 32, padding: '0 4px', border: 'none', background: 'transparent', color: theme.apiText, fontFamily: SILL_FONT.sans, fontSize: 13, textDecoration: 'underline', textUnderlineOffset: 4 }}>
                <option value={HEARTBEAT_API_AUTO}>自动（副 API）</option>
                <option value={HEARTBEAT_API_CHAT}>跟聊天 API</option>
                {apiPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
        </label>
    ) : undefined;

    const strongest = week && week !== 'none' ? strongestLine(week.rows, week.days) : null;
    const levelsOf = (drive: string) => (week && week !== 'none' ? week.rows.find(row => row.drive === drive)?.levels : undefined) ?? new Array(7).fill(0);

    return (
        <div className="flex flex-col" style={{ gap: 24, color: SILL.ink, fontFamily: SILL_FONT.sans }}>
            <Hero theme={theme} mood={mood} line={line} next={next} api={apiSelect} />

            {!connected ? (
                <div className="flex flex-col" style={{ gap: 10 }}>
                    <p style={{ fontSize: 13, lineHeight: 1.7, color: SILL.inkSoft }}>接上会把 TA 登记到 mini、同步心跳用的 API、传一份近况，顺手读一下脾气（脾气在神经链接里能改）。</p>
                    <div><LinkButton onClick={() => void connect()} disabled={busy}>{busy ? '接着呢…' : '接到 mini'}</LinkButton></div>
                </div>
            ) : (
                <>
                    <section>
                        <Title right={runs.length > shown ? <LinkButton onClick={() => setShown(n => n + 10)}>往前翻</LinkButton> : undefined}>你不在时</Title>
                        {runs.length === 0 ? (
                            <p style={{ fontSize: 13, color: SILL.inkSoft, borderTop: `1px solid ${SILL.line}`, padding: '12px 0' }}>还没醒过</p>
                        ) : runs.slice(0, shown).map(item => {
                            const app = runApp(item);
                            const { text, faint } = beatText(item);
                            return (
                                <div key={item.id} className="flex items-start" style={{ gap: 12, padding: '12px 0', borderTop: `1px solid ${SILL.line}`, color: faint ? SILL.inkFaint : SILL.ink }}>
                                    <div className="flex flex-col items-start shrink-0" style={{ width: 44, gap: 4, paddingTop: 2 }}>
                                        <span style={{ fontFamily: SILL_FONT.type, fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap' }}>{clockText(item.startedAt)}</span>
                                        {app && <span style={{ padding: '2px 8px', borderRadius: 999, background: theme.capsuleBg, color: theme.accent, fontSize: 10, lineHeight: 1.4, whiteSpace: 'nowrap' }}>{app}</span>}
                                    </div>
                                    <span className="flex-1 min-w-0" style={{ fontSize: 14, lineHeight: 1.55 }}>{text}</span>
                                </div>
                            );
                        })}
                    </section>

                    <section className="flex flex-col" style={{ gap: 8 }}>
                        <Title right={<span style={{ fontSize: 11, color: SILL.inkSoft }}>墨色越深，心事越重</span>}>七日心事</Title>
                        {week === 'none' ? (
                            <p style={{ fontSize: 13, color: SILL.inkSoft }}>mini 上还是旧版，拉一下代码重启后端就有了</p>
                        ) : (
                            <>
                                <div className="flex items-center" style={{ gap: 2, paddingLeft: 52, fontFamily: SILL_FONT.type, fontSize: 10, color: SILL.inkSoft }}>
                                    {(week ? weekdayLabels(week.days) : ['', '', '', '', '', '', '今']).map((label, index) => (
                                        <div key={index} className="flex-1 text-center" style={index === 6 ? { color: SILL.ink, fontWeight: 600 } : undefined}>{label}</div>
                                    ))}
                                </div>
                                <div role="img" aria-label="九种心思七天的浓淡" className="flex flex-col" style={{ gap: 6 }}>
                                    {SILL_DRIVE_GROUPS.map((group, gi) => (
                                        <div key={gi} className="flex flex-col" style={{ gap: 2 }}>
                                            {group.map(item => (
                                                <div key={item.drive} className="flex items-center" style={{ gap: 2, height: 16 }}>
                                                    <span className="shrink-0" style={{ width: 50, fontSize: 11, lineHeight: 1, fontWeight: strongest?.label === item.label ? 700 : 400 }}>{item.label}</span>
                                                    {levelsOf(item.drive).map((level, di) => (
                                                        <span key={di} className="flex-1" style={{ height: 14, background: `rgba(${theme.accentRgb},${SILL_HEAT_ALPHA[Math.max(0, Math.min(4, level))]})` }} />
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-baseline" style={{ gap: 8, paddingTop: 4, fontSize: 13, lineHeight: 1.6 }}>
                                    {strongest ? (
                                        <>
                                            <span className="shrink-0" style={{ fontFamily: SILL_FONT.serif, fontWeight: 600, color: theme.accent }}>最重的一笔 · {strongest.label}</span>
                                            <span>{strongest.text}</span>
                                        </>
                                    ) : <span style={{ color: SILL.inkSoft }}>{week ? '这七天都在平常水平' : '正在翻心思账…'}</span>}
                                </div>
                            </>
                        )}
                    </section>

                    <section className="flex flex-col" style={{ gap: 10 }}>
                        <Title right={pocket && pocket.length > 1 ? <span style={{ fontFamily: SILL_FONT.type, fontSize: 11, letterSpacing: '.14em', color: SILL.inkSoft }}>{pocket.length} 句</span> : undefined}>未寄的话</Title>
                        {pocket && pocket.length > 0
                            ? <Unsent theme={theme} items={pocket} />
                            : <p style={{ fontSize: 13, color: SILL.inkSoft }}>{pocket ? '现在没有攒着的话' : '读不到（mini 不在线或者还是旧版）'}</p>}
                    </section>

                    <section>
                        <Title right={(
                            <div className="flex items-center" style={{ gap: 14 }}>
                                <LinkButton onClick={() => setTuning(true)}>频率与同步</LinkButton>
                                <Switch theme={theme} label="让 TA 自己醒来" checked={Boolean(backend?.heartbeatEnabled)} disabled={busy}
                                    onChange={() => void upsert({ heartbeatEnabled: !backend?.heartbeatEnabled }, backend?.heartbeatEnabled ? 'TA 不会自己醒了' : 'TA 会自己醒来了')} />
                            </div>
                        )}>作息</Title>
                        <p style={{ fontSize: 12, lineHeight: 1.6, color: SILL.inkSoft }}>
                            {backend?.heartbeatPaused ? '暂停中：TA 这会儿不会自己醒'
                                : backend?.heartbeatEnabled ? `你不在时，TA 会自己醒来过日子（平均每 ${backend.heartbeatEveryMin ?? 60} 分钟一次）`
                                    : 'TA 只在你来找的时候醒着'}
                        </p>
                    </section>
                </>
            )}

            {/* 不常动的两样收进这里：频率一般设一次，同步是换 Key / 改人设后才点 */}
            <ClayDialog isOpen={tuning} title="频率与同步" onClose={() => setTuning(false)}>
                <div className="flex flex-col" style={{ color: SILL.ink, fontFamily: SILL_FONT.sans }}>
                    <label className="flex items-center justify-between" style={{ minHeight: 56, gap: 12 }}>
                        <span className="flex flex-col">
                            <span style={{ fontSize: 15 }}>多久醒一次</span>
                            <span style={{ fontSize: 12, color: SILL.inkSoft }}>平均值，每一跳会在前后浮动</span>
                        </span>
                        <select aria-label="心跳间隔" value={backend?.heartbeatEveryMin} disabled={busy}
                            onChange={event => void upsert({ heartbeatEveryMin: Number(event.target.value) }, `平均每 ${event.target.value} 分钟醒一次`)}
                            style={{ minHeight: 36, padding: '0 8px', border: `1px solid ${SILL.line}`, borderRadius: SILL.radius, background: 'transparent', color: SILL.ink, fontSize: 14 }}>
                            {[...new Set([...EVERY_MIN_OPTIONS, backend?.heartbeatEveryMin ?? 60])].sort((a, b) => a - b).map(minutes => (
                                <option key={minutes} value={minutes}>{minutes} 分钟</option>
                            ))}
                        </select>
                    </label>
                    <div className="flex items-center justify-between" style={{ minHeight: 56, gap: 12, borderTop: `1px solid ${SILL.line}` }}>
                        <span className="flex flex-col">
                            <span style={{ fontSize: 15 }}>重新同步</span>
                            <span style={{ fontSize: 12, color: SILL.inkSoft }}>换了 Key、改了人设之后点一下</span>
                        </span>
                        <LinkButton onClick={() => void connect()} disabled={busy}>{busy ? '同步中…' : '同步'}</LinkButton>
                    </div>
                </div>
            </ClayDialog>
        </div>
    );
};

export default SillDetail;
// [EM-END: window-sill]
