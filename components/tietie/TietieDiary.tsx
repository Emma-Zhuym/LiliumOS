/**
 * 点卡片翻开的日记（样稿 A）：玫瑰 tint 底上一张白纸，标题、三格（什么时候 / 多久 / 在哪）、
 * TA 的整段日记、签名，末尾「TA 记住的」（进了记忆宫殿的那条，可以删）。
 * 正文用衬线 400，跟烛下信笺同一个例外（APP_CONVENTIONS P17）。
 */
import React, { useEffect, useState } from 'react';
import { Trash, X } from '@phosphor-icons/react';
import type { CharacterProfile } from '../../types';
import { F, FONT, HUE, R } from '../../utils/clayTokens';
import { formatTietieDuration, tietieMinutes, tietieNoLabel, type TietieRecord } from '../../utils/tietie';
import { discardTietieRecord, forgetTietieMemory } from '../../utils/tietieActions';
import { useOS } from '../../context/OSContext';
import ClayDialog from '../os/ClayDialog';
import { TIETIE_OPEN_EVENT, useTietieRecord } from './useTietie';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const clock = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const dateLine = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEKDAYS[d.getDay()]}`;
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div style={{ background: HUE.rose.tint, borderRadius: R.bigCard, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: HUE.rose.ink }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
    </div>
);

const Remembered: React.FC<{ record: TietieRecord; charName: string }> = ({ record, charName }) => {
    const { remoteVectorConfig } = useOS();
    const [confirming, setConfirming] = useState(false);
    if (!record.memory) return null;
    return (
        <div style={{ borderTop: `1px solid ${F.divider}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: F.textTertiary }}>{charName}记住的</span>
                <button type="button" aria-label="不让 TA 记住这一次的细节" onClick={() => setConfirming(true)}
                    className="grid place-items-center active:opacity-40 transition-opacity"
                    style={{ width: 44, height: 44, margin: '-12px -12px -12px 0', background: 'transparent', border: 'none' }}>
                    <Trash size={18} weight="bold" color={F.textTertiary} />
                </button>
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: F.textSecondary }}>{record.memory}</p>
            <ClayDialog isOpen={confirming} title="不让 TA 记住细节" onClose={() => setConfirming(false)} footer={
                <div className="flex" style={{ gap: 10 }}>
                    <button type="button" onClick={() => setConfirming(false)} className="flex-1 clay-press"
                        style={{ height: 44, borderRadius: R.button, background: F.surface, border: `1px solid ${F.borderSoft}`, color: F.textPrimary, fontSize: 15, fontWeight: 600 }}>
                        留着
                    </button>
                    <button type="button" className="flex-1 clay-press"
                        onClick={() => { setConfirming(false); void forgetTietieMemory(record, remoteVectorConfig); }}
                        style={{ height: 44, borderRadius: R.button, background: F.textPrimary, border: 'none', color: F.surface, fontSize: 15, fontWeight: 600 }}>
                        删掉
                    </button>
                </div>
            }>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>
                    删掉以后，{charName}平时聊天里就想不起这一次的细节了，只记得有过。这页日记还在。
                </p>
            </ClayDialog>
        </div>
    );
};

/** 这次不算：日记、TA 记住的、聊天里的卡一起删（阿萌 2026-10-30：猜错开的贴贴照样写了记录） */
const Discard: React.FC<{ record: TietieRecord; charName: string; onDone: () => void }> = ({ record, charName, onDone }) => {
    const { remoteVectorConfig } = useOS();
    const [confirming, setConfirming] = useState(false);
    return (
        <>
            <button type="button" aria-label="这次不算" onClick={() => setConfirming(true)} className="absolute grid place-items-center active:opacity-40 transition-opacity"
                style={{ right: 6, bottom: 4, width: 44, height: 44, background: 'transparent', border: 'none' }}>
                <Trash size={21} weight="bold" color={F.textPrimary} />
            </button>
            <ClayDialog isOpen={confirming} title="这次不算" onClose={() => setConfirming(false)} footer={
                <div className="flex" style={{ gap: 10 }}>
                    <button type="button" onClick={() => setConfirming(false)} className="flex-1 clay-press"
                        style={{ height: 44, borderRadius: R.button, background: F.surface, border: `1px solid ${F.borderSoft}`, color: F.textPrimary, fontSize: 15, fontWeight: 600 }}>
                        留着
                    </button>
                    <button type="button" className="flex-1 clay-press"
                        onClick={() => { setConfirming(false); void discardTietieRecord(record, remoteVectorConfig).then(onDone); }}
                        style={{ height: 44, borderRadius: R.button, background: F.textPrimary, border: 'none', color: F.surface, fontSize: 15, fontWeight: 600 }}>
                        删掉
                    </button>
                </div>
            }>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>
                    这页日记、{charName}记住的那条和聊天里的卡片一起删掉，健康日历上的记号也会消失。{charName}事后说的那一两句还在聊天里，想删可以长按删。
                </p>
            </ClayDialog>
        </>
    );
};

export const TietieDiary: React.FC<{ charId: string; charName: string; recordId: string; onClose: () => void }> = ({ charId, charName, recordId, onClose }) => {
    const record = useTietieRecord(charId, recordId);
    if (!record) return null;
    return (
        <section role="dialog" aria-label={`${charName}写的：${record.title || '这一次'}`}
            className="absolute inset-0 z-[47] flex flex-col overflow-hidden clay-sheet-in" style={{ background: HUE.rose.tint, color: F.textPrimary }}>
            <header className="shrink-0 relative flex items-center justify-center" style={{ paddingTop: 'var(--chrome-top)', height: 'calc(var(--chrome-top) + 52px)' }}>
                <button type="button" aria-label="合上" onClick={onClose} className="absolute grid place-items-center active:opacity-40 transition-opacity"
                    style={{ left: 6, bottom: 4, width: 44, height: 44, background: 'transparent', border: 'none' }}>
                    <X size={22} weight="bold" color={F.textPrimary} />
                </button>
                <span style={{ fontSize: 13, color: HUE.rose.ink, letterSpacing: 2, fontVariantNumeric: 'tabular-nums' }}>{tietieNoLabel(record.no)}</span>
                <Discard record={record} charName={charName} onDone={onClose} />
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: '0 16px', paddingBottom: 'calc(20px + var(--safe-bottom))' }}>
                <article style={{ background: F.surface, border: `1px solid ${HUE.rose.soft}`, borderRadius: R.bigCard, padding: '26px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <h2 style={{ margin: 0, fontFamily: FONT.heading, fontSize: 22, fontWeight: 700, color: HUE.rose.ink }}>{record.title || '这一次'}</h2>
                        <span style={{ fontSize: 12, color: F.textTertiary }}>{dateLine(record.startedAt)}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                        <Stat label="什么时候" value={clock(record.startedAt)} />
                        <Stat label="多久" value={formatTietieDuration(tietieMinutes(record))} />
                        <Stat label="在哪" value={record.place || '—'} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {(record.story || []).map((p, i) => (
                            <p key={i} style={{ margin: 0, fontFamily: FONT.heading, fontWeight: 400, fontSize: 15, lineHeight: 1.95 }}>{p}</p>
                        ))}
                    </div>
                    <span style={{ alignSelf: 'flex-end', fontFamily: FONT.hand, fontSize: 24, color: HUE.rose.main }}>—— {charName}</span>
                    <Remembered record={record} charName={charName} />
                </article>
            </div>
        </section>
    );
};

/** 聊天页里放一个：听卡片发来的「翻开」，管返回键 */
export const TietieOverlays: React.FC<{ char: CharacterProfile }> = ({ char }) => {
    const { registerBackHandler } = useOS();
    const [recordId, setRecordId] = useState<string | null>(null);
    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ charId?: string; recordId?: string }>).detail;
            if (detail?.charId === char.id && detail.recordId) setRecordId(detail.recordId);
        };
        window.addEventListener(TIETIE_OPEN_EVENT, handler);
        return () => window.removeEventListener(TIETIE_OPEN_EVENT, handler);
    }, [char.id]);
    useEffect(() => { setRecordId(null); }, [char.id]);
    useEffect(() => {
        if (!recordId) return;
        return registerBackHandler(() => { setRecordId(null); return true; });
    }, [recordId, registerBackHandler]);
    if (!recordId) return null;
    return <TietieDiary charId={char.id} charName={char.name} recordId={recordId} onClose={() => setRecordId(null)} />;
};
