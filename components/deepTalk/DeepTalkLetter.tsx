// [EM-START: deep-talk]
/**
 * 点折叠卡翻开的整页信笺（样稿第二屏的 sheet），和右上角进去的「所有夜晚」（第三屏）。
 * DeepTalkNights 只靠 charId 读库，不依赖聊天页——以后情侣空间的书架直接挂它。
 */
import React, { useEffect, useState } from 'react';
import { CaretDown, CaretLeft, X } from '@phosphor-icons/react';
import type { CharacterProfile } from '../../types';
import { F, FONT, R } from '../../utils/clayTokens';
import { deepTalkEventText, padNight, type DeepTalkNight } from '../../utils/deepTalk';
import { removeKeptLine } from '../../utils/deepTalkActions';
import ClayDialog from '../os/ClayDialog';
import { resolveCharTimeZone } from '../../utils/timezone';
import { useOS } from '../../context/OSContext';
import { Candle, useDeepTalkTheme, WobbleDefs, type DeepTalkPalette } from './DeepTalkInk';
import { DeepTalkEdge, DeepTalkSegments, LINE, talkTextStyle } from './DeepTalkTalk';
import { DEEP_TALK_OPEN_LETTER_EVENT, useClosedNights, useNight, useNightSegments } from './useDeepTalk';

const clock = (ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const monthDay = (ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};
const labelStyle = (palette: DeepTalkPalette): React.CSSProperties => ({
    fontSize: 11, letterSpacing: '.14em', color: palette.inkSoft, fontVariantNumeric: 'tabular-nums',
});

const IconButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({ label, onClick, children }) => (
    <button type="button" aria-label={label} onClick={onClick} className="grid place-items-center active:opacity-40 transition-opacity"
        style={{ width: 44, height: 44, background: 'transparent', border: 'none' }}>{children}</button>
);

/** 页边的线稿：蜡烛 + 一路往下的烛泪 */
const MarginArt: React.FC<{ palette: DeepTalkPalette }> = ({ palette }) => (
    <svg viewBox="0 0 52 900" preserveAspectRatio="xMidYMin meet" aria-hidden="true"
        style={{ position: 'absolute', left: 6, top: 0, width: 52, height: '100%', fill: 'none', stroke: palette.ink, strokeWidth: 1.3, strokeLinecap: 'round' }}>
        <g style={{ filter: 'url(#em-dt-wob)' }}>
            <path d="M6 30h40M6 30v62M46 30v62M6 51h40M6 72h40M19.5 30v62M33 30v62M6 92h40" style={{ stroke: palette.line }} />
            <path d="M4 26c13-4 31-4 44 0M4 96c13 3 31 3 44 0" />
        </g>
        <g transform="translate(14 104)">
            <path d="M12 2.6c-2.3 3.1-3.1 4.7-3.1 6.4 0 1.8 1.4 3.2 3.1 3.2s3-1.3 3-3.1c0-1.8-.8-3.3-3-6.5z" style={{ stroke: palette.flame, fill: palette.flameFill }} />
            <path d="M12 12.4v2.1M8.3 14.9c.1 4.3 0 9.2.2 13.1M15.8 14.7c-.2 4.4-.1 9.4 0 13.3M8.2 15c2.5-.5 5.2-.4 7.7-.3M4.8 28.3c4.7.5 9.8.3 14.4 0" />
        </g>
        <path d="M26 140c-10 40 14 70 4 120s-22 70-6 120 20 90 2 140-18 90 0 140 16 100-2 150" />
        <path d="M30 260c10-6 14 2 8 8M24 380c-10-4-12 6-6 10M26 520c10-8 15 0 9 7M26 660c-10-5-13 5-6 10" style={{ stroke: palette.inkSoft, strokeWidth: 1 }} />
    </svg>
);

/** TA 挑出来带回平时的那一两句：平时聊天里 TA 能想起原话。阿萌不想让 TA 带回去的可以删 */
const KeptLines: React.FC<{ night: DeepTalkNight; palette: DeepTalkPalette; names: { userName: string; charName: string } }> = ({ night, palette, names }) => {
    const { remoteVectorConfig } = useOS();
    const [pending, setPending] = useState<number | null>(null);
    const kept = night.kept || [];
    if (!kept.length) return null;
    return (
        <div style={{ marginTop: LINE, paddingTop: 14, borderTop: `1px solid ${palette.line}` }}>
            <span style={{ ...labelStyle(palette), display: 'block', marginBottom: 6 }}>{names.charName}带回平时的话</span>
            {kept.map((line, index) => (
                <div key={`${index}-${line.text}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                    <p style={{ margin: 0, flex: 1, minWidth: 0, padding: '10px 0', fontFamily: FONT.heading, fontWeight: 400, fontSize: 15, lineHeight: '24px', color: line.speaker === 'user' ? palette.inkMe : palette.ink }}>
                        「{line.text}」
                        <span style={{ fontFamily: FONT.hand, fontSize: 15, color: palette.inkSoft, marginLeft: 6 }}>{line.speaker === 'user' ? names.userName : names.charName}</span>
                    </p>
                    <button type="button" aria-label={`不让${names.charName}带回这句`} onClick={() => setPending(index)}
                        className="grid place-items-center shrink-0 active:opacity-40 transition-opacity" style={{ width: 44, height: 44, background: 'transparent', border: 'none' }}>
                        <X size={18} weight="bold" color={palette.inkSoft} />
                    </button>
                </div>
            ))}
            <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: '18px', color: palette.inkSoft }}>
                这一夜的其他话只留在信笺和以后的烛下，平时聊天里{names.charName}只记得这几句。
            </p>
            <ClayDialog isOpen={pending !== null} title="不让 TA 带回这句" onClose={() => setPending(null)} footer={
                <div className="flex" style={{ gap: 10 }}>
                    <button type="button" onClick={() => setPending(null)} className="flex-1 clay-press"
                        style={{ height: 44, borderRadius: R.button, background: F.surface, border: `1px solid ${F.borderSoft}`, color: F.textPrimary, fontSize: 15, fontWeight: 600 }}>
                        留着
                    </button>
                    <button type="button" className="flex-1 clay-press"
                        onClick={() => { const i = pending; setPending(null); if (i !== null) void removeKeptLine(night, i, remoteVectorConfig); }}
                        style={{ height: 46, borderRadius: R.button, background: F.textPrimary, border: 'none', color: F.surface, fontSize: 15, fontWeight: 600 }}>
                        删掉
                    </button>
                </div>
            }>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>
                    删掉以后，平时聊天里{names.charName}就想不起这句原话了；信笺里的原文还在。
                </p>
            </ClayDialog>
        </div>
    );
};

export const DeepTalkLetter: React.FC<{
    char: CharacterProfile; userName: string; nightId: string;
    onClose: () => void; onNights: () => void;
}> = ({ char, userName, nightId, onClose, onNights }) => {
    const { palette } = useDeepTalkTheme(char.id, resolveCharTimeZone(char));
    const night = useNight(char.id, nightId);
    const segments = useNightSegments(char.id, nightId);
    const names = { userName, charName: char.name };
    return (
        <section role="dialog" aria-label={`第 ${padNight(night?.nightNo)} 夜 信笺`} className="clay-sheet-in absolute inset-0 z-[46] flex flex-col overflow-hidden"
            style={{ background: palette.paper, color: palette.ink }}>
            <WobbleDefs />
            <header className="shrink-0 flex items-center justify-between px-1.5 py-1.5" style={{ paddingTop: 'var(--chrome-top)' }}>
                <IconButton label="收起信笺" onClick={onClose}><CaretDown size={22} weight="bold" color={palette.ink} /></IconButton>
                <button type="button" onClick={onNights} className="active:opacity-40 transition-opacity"
                    style={{ height: 44, padding: '0 10px', background: 'transparent', border: 'none', fontSize: 12, letterSpacing: '.12em', color: palette.ink }}>
                    所有夜晚
                </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto">
                {night && (
                    <div style={{ position: 'relative', padding: `4px 18px calc(36px + var(--safe-bottom)) 64px` }}>
                        <MarginArt palette={palette} />
                        <span style={{ ...labelStyle(palette), display: 'block' }}>
                            第 {padNight(night.nightNo)} 夜 · {monthDay(night.startedAt)} · {clock(night.startedAt)}–{clock(night.endedAt)}
                        </span>
                        <h2 style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 28, lineHeight: 1.25, margin: '8px 0 4px', letterSpacing: '.04em' }}>{night.title}</h2>
                        <div style={{ fontSize: 13, color: palette.inkSoft, marginBottom: 18 }}>{char.name}给这一夜起的名字</div>
                        <div style={talkTextStyle(palette)}>
                            <DeepTalkSegments segments={segments} palette={palette} names={names} />
                            <DeepTalkEdge palette={palette} candle={<Candle lit={false} palette={palette} />}>
                                {deepTalkEventText(night.burntOut ? 'burnt_out' : 'end', names)}
                            </DeepTalkEdge>
                        </div>
                        <KeptLines night={night} palette={palette} names={names} />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, marginTop: LINE }}>
                            <span style={{ ...labelStyle(palette), letterSpacing: '.2em' }}>烛下 · {char.name}记</span>
                            <b style={{ fontFamily: FONT.hand, fontWeight: 400, fontSize: 34, lineHeight: 1 }}>{char.name}</b>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};

/** 每深谈一次，蜡烛上多一道烛泪（最多画七道）；阶段一是静态的 */
const BigCandle: React.FC<{ palette: DeepTalkPalette; count: number }> = ({ palette, count }) => {
    const drips = ['M33.5 47.5c.8 6 .2 10-1 13.5', 'M38 47c.4 10 .2 15-.8 18', 'M47.8 47c.6 4.5.2 8-.6 11', 'M51.5 47.2c.3 7 .1 12-1 15.5',
        'M44 47c.6 13 .4 19-.8 23', 'M35.6 47.3c1 3.2.6 6-.5 8', 'M49.6 47c.5 5.3.3 9-.5 12.4'].slice(0, Math.min(7, count));
    return (
        <svg viewBox="0 0 84 150" width={84} height={150} aria-hidden="true" style={{ fill: 'none', stroke: palette.ink, strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', flexShrink: 0 }}>
            <path d="M42 14c-6 8-8.5 12.6-8.5 17.2 0 5 3.8 8.8 8.5 8.8s8.4-3.7 8.4-8.6c0-4.8-2.4-9-8.4-17.4z" style={{ stroke: palette.flame, fill: palette.flameFill }} />
            <path d="M42 40v6" />
            <g style={{ filter: 'url(#em-dt-wob)' }}>
                <path d="M30 47c.3 26 0 56 .5 86M54.5 46.5c-.4 27-.2 58 0 86.5M29.8 47.4c8-1.4 16.6-1.3 24.8-.6" />
                {drips.map(d => <path key={d} d={d} />)}
                <path d="M12 134c18 2 42 2 60 0M18 140c15 1.5 34 1.5 48 0" />
            </g>
        </svg>
    );
};

export const DeepTalkNights: React.FC<{
    charId: string; charName: string; timeZone?: string;
    onBack: () => void; onOpenNight: (nightId: string) => void;
}> = ({ charId, charName, timeZone, onBack, onOpenNight }) => {
    const { palette } = useDeepTalkTheme(charId, timeZone);
    const nights = useClosedNights(charId);
    const earliest = nights.length ? nights[nights.length - 1] : null;
    return (
        <section aria-label="所有夜晚" className="absolute inset-0 z-[47] flex flex-col overflow-hidden" style={{ background: palette.paper, color: palette.ink }}>
            <WobbleDefs />
            <header className="shrink-0 px-1.5 py-1.5" style={{ paddingTop: 'var(--chrome-top)' }}>
                <IconButton label="回到信笺" onClick={onBack}><CaretLeft size={22} weight="bold" color={palette.ink} /></IconButton>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ paddingBottom: 'calc(30px + var(--safe-bottom))' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 12, padding: '8px 20px 18px' }}>
                    <div>
                        <span style={labelStyle(palette)}>烛下 · {charName}</span>
                        <h2 style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 26, margin: '4px 0 6px' }}>所有夜晚</h2>
                        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: palette.inkSoft }}>
                            {nights.length ? `点过 ${nights.length} 次 · 最早一次 ${monthDay(earliest?.startedAt)}` : '还没有点过蜡烛'}
                        </p>
                    </div>
                    <BigCandle palette={palette} count={nights.length} />
                </div>
                <ol style={{ listStyle: 'none', margin: 0, padding: '4px 20px 0', position: 'relative' }}>
                    {nights.length > 1 && <span aria-hidden="true" style={{ position: 'absolute', left: 31, top: 10, bottom: 10, borderLeft: `1.2px solid ${palette.line}` }} />}
                    {nights.map(night => (
                        <li key={night.id} style={{ position: 'relative' }}>
                            <button type="button" onClick={() => onOpenNight(night.id)} className="w-full text-left clay-press-card"
                                style={{ display: 'grid', gridTemplateColumns: '24px 1fr', columnGap: 14, padding: '12px 0 14px', background: 'transparent', border: 'none', color: palette.ink }}>
                                <span style={{ background: palette.paper, position: 'relative', zIndex: 1, height: 30 }}><Candle lit={false} palette={palette} width={24} height={30} /></span>
                                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, borderBottom: `1px solid ${palette.line}`, paddingBottom: 14 }}>
                                    <span style={labelStyle(palette)}>第 {padNight(night.nightNo)} 夜 · {monthDay(night.startedAt)}</span>
                                    <span style={{ fontFamily: FONT.heading, fontWeight: 600, fontSize: 17 }}>{night.title}</span>
                                    {night.oneLine && <span style={{ fontFamily: FONT.heading, fontWeight: 400, fontSize: 13.5, lineHeight: 1.7, color: palette.inkMe }}>{night.oneLine}</span>}
                                </span>
                            </button>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
};

/**
 * 聊天页里放一个：听卡片发来的「翻开信笺」，管信笺 ↔ 所有夜晚的切换和返回键。
 */
export const DeepTalkOverlays: React.FC<{ char: CharacterProfile; userName: string }> = ({ char, userName }) => {
    const { registerBackHandler } = useOS();
    const [view, setView] = useState<{ kind: 'letter' | 'nights'; nightId: string } | null>(null);
    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ charId?: string; nightId?: string }>).detail;
            if (detail?.charId === char.id && detail.nightId) setView({ kind: 'letter', nightId: detail.nightId });
        };
        window.addEventListener(DEEP_TALK_OPEN_LETTER_EVENT, handler);
        return () => window.removeEventListener(DEEP_TALK_OPEN_LETTER_EVENT, handler);
    }, [char.id]);
    useEffect(() => { setView(null); }, [char.id]);
    useEffect(() => {
        if (!view) return;
        return registerBackHandler(() => {
            setView(v => (v?.kind === 'nights' ? { ...v, kind: 'letter' } : null));
            return true;
        });
    }, [view, registerBackHandler]);
    if (!view) return null;
    return view.kind === 'letter'
        ? <DeepTalkLetter char={char} userName={userName} nightId={view.nightId}
            onClose={() => setView(null)} onNights={() => setView({ ...view, kind: 'nights' })} />
        : <DeepTalkNights charId={char.id} charName={char.name} timeZone={resolveCharTimeZone(char)}
            onBack={() => setView({ ...view, kind: 'letter' })} onOpenNight={nightId => setView({ kind: 'letter', nightId })} />;
};
// [EM-END: deep-talk]
