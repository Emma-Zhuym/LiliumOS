// [EM-START: window-sill]
/**
 * 窗台首页（画布「C2 · 平常的下午」+「C2 · 跟手指动 · 乙」，2026-11-10 定）：
 *   接上 mini 的每个人一张牌。朝着她的心思最强的那个人当大牌；都平平的时候一样大、按最近动静排。
 *   牌面图案跟手指动；点牌翻面看攒着想说的，背面右下「看 TA 这几天」进详情。
 *   下面是今天所有人的时间线，「全部 / 各人」小签筛。
 *   发牌只在当天第一次打开时播；平时一直在动的东西一个也没有（大牌的心跳 11-10 拿掉了）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useOS } from '../../context/OSContext';
import type { CharacterProfile } from '../../types';
import { AgentBackend } from '../../utils/emAgentBackend';
import { statusPhrase } from '../../utils/emDriveStatus';
import { clockText, isToday, nextBeatText, runSummary } from '../../utils/emMachineRoom';
import { awakeBeats, beatText, pickBigCard, SILL_BEATS_SHOWN, takeDealToday } from '../../utils/emWindowSill';
import { SILL, SILL_FONT, type SillTheme } from '../../utils/sillTokens';
import type { AgentMiniData } from '../../hooks/useAgentMiniData';
import SillPaper from './SillPaper';
import SillPattern, { useFingerTrail } from './SillPattern';
import { useSize } from './useSize';
import './windowSill.css';

type Drives = { drive: string; level: 'mid' | 'high' }[];

interface CardInfo {
    char: CharacterProfile;
    theme: SillTheme;
    mood: string;
    line: string;
    next: string;
    /** 情绪 buff 里那段叙事的情绪底色（聊天里每轮评估写的 char.buffInjection） */
    undertone: string;
}

const SillCard: React.FC<{ info: CardInfo; size: 'big' | 'wide' | 'small'; deal: { dd: number } | null; onOpen: () => void }> = ({ info, size, deal, onOpen }) => {
    const { char, theme, mood, line, next, undertone } = info;
    const ref = useRef<HTMLDivElement>(null);
    const box = useSize(ref);
    const { trail, handlers } = useFingerTrail();
    const [face, setFace] = useState<{ back: boolean; n: number }>({ back: false, n: 0 });
    const flip = () => setFace(prev => ({ back: !prev.back, n: prev.n + 1 }));
    const height = size === 'big' ? 232 : 148;
    const small = size === 'small';
    const foot = small ? '翻面' : '翻面看心情';
    const go = face.n ? (face.n % 2 ? 'a' : 'b') : '';

    return (
        <div className={deal ? 'sill-deal' : undefined}
            style={{ height, '--dd': `${deal?.dd ?? 0}s` } as React.CSSProperties}>
            <div ref={ref} className="sill-card" {...handlers}>
                <div className={`sill-lift ${go ? `l-${go}` : ''}`}>
                    <div className={`sill-flip ${face.back ? 'is-back' : ''} ${go ? `go-${go}` : ''}`}>
                        <button type="button" className="sill-face front" onClick={flip} aria-label={`${char.name}，${mood}。点一下翻面`}
                            style={{ border: 'none', padding: 0, margin: 0, width: '100%', height: '100%', textAlign: 'left', background: theme.field, color: theme.text, pointerEvents: face.back ? 'none' : 'auto' }}>
                            <SillPattern theme={theme} width={box.width} height={box.height} trail={trail} />
                            <div style={{ position: 'absolute', left: small ? 16 : 24, right: small ? 16 : 24, top: small ? 16 : 24, display: 'flex', flexDirection: 'column', gap: small ? 4 : 8, pointerEvents: 'none' }}>
                                <div className="truncate" style={{ fontFamily: SILL_FONT.serif, fontSize: size === 'big' ? 40 : small ? 22 : 28, fontWeight: 600, lineHeight: 1 }}>{char.name}</div>
                                <div style={{ fontFamily: SILL_FONT.serif, fontSize: size === 'big' ? 24 : small ? 13 : 17, fontWeight: 600, color: theme.mood }}>{mood}</div>
                                {!small && line && <div className="line-clamp-2" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 260 }}>{line}</div>}
                            </div>
                            <div style={{
                                position: 'absolute', bottom: 12, fontFamily: SILL_FONT.type, fontSize: small ? 10 : 11, letterSpacing: '.14em', pointerEvents: 'none',
                                color: theme.footText, ...(small ? { left: 16 } : { right: 16 }),
                            }}>{foot}</div>
                        </button>
                        <div className="sill-face back" style={{ background: theme.field, color: theme.text, pointerEvents: face.back ? 'auto' : 'none' }}>
                            <SillPaper theme={theme} />
                            <button type="button" onClick={flip} aria-label={`${char.name}的情绪底色，点一下翻回去`}
                                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', background: 'none', padding: 0, margin: 0, textAlign: 'left', color: 'inherit' }}>
                                <div style={{ position: 'absolute', left: small ? 16 : 24, right: small ? 16 : 24, top: small ? 16 : 24, display: 'flex', flexDirection: 'column', gap: small ? 8 : 12 }}>
                                    <div style={{ fontFamily: SILL_FONT.type, fontSize: small ? 10 : 11, letterSpacing: '.2em', color: theme.textSoft }}>情绪底色</div>
                                    <div className={small ? 'line-clamp-4' : 'line-clamp-4'} style={{ fontFamily: SILL_FONT.serif, fontSize: small ? 13 : 15, lineHeight: 1.6 }}>
                                        {undertone || '这会儿心里平平的，还没在聊天里起什么波澜'}
                                    </div>
                                    {!small && (
                                        <div style={{ fontSize: 12, lineHeight: 1.7, color: theme.textSoft, borderTop: `1px solid ${theme.textSoft}`, paddingTop: 8 }}>
                                            心里：{mood}{next ? ` · ${next}` : ''}
                                        </div>
                                    )}
                                </div>
                            </button>
                            <button type="button" onClick={onOpen} className="active:opacity-40"
                                style={{ position: 'absolute', right: 0, bottom: 0, minHeight: 44, padding: '0 16px', border: 'none', background: 'none', color: theme.text, fontFamily: SILL_FONT.serif, fontSize: 13, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 4 }}>
                                {small ? '这几天' : '看 TA 这几天'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SillHome: React.FC<{
    data: AgentMiniData;
    themeOf: (charId: string) => SillTheme;
    onOpenChar: (id: string) => void;
    onOpenSettings: () => void;
}> = ({ data, themeOf, onOpenChar, onOpenSettings }) => {
    const { characters } = useOS();
    const [drives, setDrives] = useState<Record<string, Drives>>({});
    const [only, setOnly] = useState<string>('all');
    const [dealing] = useState(() => takeDealToday());

    const backendOf = (id: string) => data.characters.find(item => item.charId === id);
    const connected = characters.filter(char => Boolean(backendOf(char.id)?.credRef));
    const unconnected = characters.filter(char => !backendOf(char.id)?.credRef);
    const connectedKey = connected.map(char => char.id).join(',');

    useEffect(() => {
        if (!data.reachable || !connectedKey) return;
        let alive = true;
        for (const id of connectedKey.split(',')) {
            AgentBackend.driveState(id).then(result => { if (alive) setDrives(prev => ({ ...prev, [id]: result.drives })); }).catch(() => {});
        }
        return () => { alive = false; };
    }, [connectedKey, data.reachable, data.runs]);

    const latestAt = (id: string) => data.runs.find(run => run.charId === id)?.startedAt ?? null;
    const cards: CardInfo[] = connected.map(char => {
        const backend = backendOf(char.id);
        const latest = data.runs.find(run => run.charId === char.id);
        const awake = Boolean(backend?.heartbeatEnabled) && !backend?.heartbeatPaused;
        return {
            char,
            theme: themeOf(char.id),
            mood: drives[char.id] ? (statusPhrase(drives[char.id].slice(0, 1)) || '平平常常') : '…',
            line: latest ? runSummary(latest) : '还没醒过',
            next: awake ? `下一跳 ${(nextBeatText(backend?.nextHeartbeatAt) || '').split(' · ')[0] || '还没排上'}` : '',
            undertone: (char.buffInjection ?? '').trim(),
        };
    });
    const bigId = pickBigCard(connected.map(char => ({ charId: char.id, drives: drives[char.id] ?? [], lastAt: latestAt(char.id) })));
    // 没有大牌时按最近动静排
    const ordered = bigId
        ? [cards.find(c => c.char.id === bigId)!, ...cards.filter(c => c.char.id !== bigId)]
        : [...cards].sort((a, b) => (Date.parse(latestAt(b.char.id) ?? '') || 0) - (Date.parse(latestAt(a.char.id) ?? '') || 0));
    const big = bigId ? ordered[0] : null;
    const rest = bigId ? ordered.slice(1) : ordered;

    const dealFor = (index: number, _total: number) => (dealing ? { dd: index * 0.06 } : null);

    const today = useMemo(() => data.runs.filter(run => isToday(run.startedAt) && connected.some(char => char.id === run.charId)), [data.runs, connectedKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const [expanded, setExpanded] = useState(false);
    const allRows = awakeBeats(today.filter(run => only === 'all' || run.charId === only));
    const rows = expanded ? allRows : allRows.slice(0, SILL_BEATS_SHOWN);
    const nameOf = (id: string) => characters.find(char => char.id === id)?.name ?? '';

    return (
        <div className="flex flex-col" style={{ gap: 12, color: SILL.ink, fontFamily: SILL_FONT.sans }}>
            {data.reachable === false && (
                <p style={{ fontSize: 12, lineHeight: 1.6, color: SILL.inkSoft }}>
                    {data.failure?.title ?? 'mini 在休息'}。下面是上一次拿到的样子。
                </p>
            )}

            {connected.length === 0 && data.reachable !== null && (
                <p style={{ fontSize: 13, lineHeight: 1.7, color: SILL.inkSoft, padding: '24px 0' }}>还没有人接到 mini。点下面的名字进去接上。</p>
            )}

            {big && <SillCard info={big} size="big" deal={dealFor(0, ordered.length)} onOpen={() => onOpenChar(big.char.id)} />}
            {big ? (
                rest.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                        {rest.map((info, i) => <SillCard key={info.char.id} info={info} size="small" deal={dealFor(i + 1, ordered.length)} onOpen={() => onOpenChar(info.char.id)} />)}
                    </div>
                )
            ) : rest.map((info, i) => <SillCard key={info.char.id} info={info} size="wide" deal={dealFor(i, ordered.length)} onOpen={() => onOpenChar(info.char.id)} />)}

            {connected.length > 0 && (
                <>
                    <div className="flex items-center justify-between" style={{ marginTop: 2 }}>
                        <span style={{ fontFamily: SILL_FONT.type, fontSize: 11, letterSpacing: '.18em' }}>今天</span>
                        <div className="flex items-center" style={{ gap: 2 }}>
                            {[{ id: 'all', label: '全部', dot: SILL.ink }, ...connected.map(char => ({ id: char.id, label: char.name, dot: themeOf(char.id).field }))].map(chip => (
                                <button key={chip.id} type="button" aria-pressed={only === chip.id} onClick={() => setOnly(chip.id)}
                                    style={{ minWidth: 44, height: 44, border: 'none', background: 'none', padding: '0 3px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SILL.ink }}>
                                    <span className="flex items-center" style={{
                                        gap: 6, height: 28, padding: '0 10px', borderRadius: 14, fontSize: 12, boxSizing: 'border-box', maxWidth: 96,
                                        border: `1px solid ${only === chip.id ? SILL.ink : SILL.line}`, background: only === chip.id ? SILL.chipOn : 'transparent',
                                    }}>
                                        <span className="shrink-0" style={{ width: 8, height: 8, borderRadius: '50%', background: chip.dot }} />
                                        <span className="truncate">{chip.label}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                    {rows.length === 0 ? (
                        <p style={{ fontSize: 13, color: SILL.inkSoft }}>今天还没醒过</p>
                    ) : (
                        <div className="flex flex-col" style={{ gap: 10 }}>
                            {rows.map(run => {
                                const { text, faint } = beatText(run);
                                return (
                                    <div key={run.id} className="flex items-stretch" style={{ gap: 10, fontSize: 13, lineHeight: 1.5, color: faint ? SILL.inkFaint : SILL.ink }}>
                                        <div className="shrink-0" style={{ width: 6, background: faint ? SILL.line : themeOf(run.charId).field }} />
                                        <div className="shrink-0" style={{ fontFamily: SILL_FONT.type, width: 40 }}>{clockText(run.startedAt)}</div>
                                        <div className="min-w-0"><span style={{ fontFamily: SILL_FONT.serif, fontWeight: 600 }}>{nameOf(run.charId)}</span> {text}</div>
                                    </div>
                                );
                            })}
                            {allRows.length > SILL_BEATS_SHOWN && (
                                <div>
                                    <button type="button" onClick={() => setExpanded(v => !v)} className="active:opacity-40"
                                        style={{ minHeight: 44, border: 'none', background: 'none', padding: 0, fontSize: 13, color: SILL.ink, textDecoration: 'underline', textUnderlineOffset: 4 }}>
                                        {expanded ? '收起' : `还有 ${allRows.length - SILL_BEATS_SHOWN} 条`}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            <div className="flex flex-col" style={{ gap: 4, marginTop: 12 }}>
                {unconnected.length > 0 && (
                    <p style={{ fontSize: 12, color: SILL.inkSoft, lineHeight: 1.8 }}>
                        还没接上：{unconnected.map((char, index) => (
                            <React.Fragment key={char.id}>
                                {index > 0 && '、'}
                                <button type="button" onClick={() => onOpenChar(char.id)} className="active:opacity-40"
                                    style={{ color: SILL.ink, fontSize: 12, fontWeight: 600, background: 'none', border: 'none', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3 }}>{char.name}</button>
                            </React.Fragment>
                        ))}
                    </p>
                )}
                <div>
                    <button type="button" onClick={onOpenSettings} className="active:opacity-40"
                        style={{ minHeight: 44, border: 'none', background: 'none', padding: 0, fontSize: 12, color: SILL.inkSoft, textDecoration: 'underline', textUnderlineOffset: 4 }}>
                        mini 的设置在「设置 → Mac mini」
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SillHome;
// [EM-END: window-sill]
