// [EM-START: deep-talk-actions]
/**
 * 纸面上看和改钉住的 OOC 要求。纸面盖着聊天，工具栏里的 OOC 够不着，退出又只退到通讯录，
 * 不开这个口子，开着的一夜里钉住的话就改不了（阿萌 2026-10-31 卡在这里）。
 */
import React, { useEffect, useState } from 'react';
import { F, R } from '../../utils/clayTokens';
import { loadOocPins, OOC_PINS_CHANGED_EVENT, unpinOoc, updateOocPin, type OocPin } from '../../utils/emOoc';
import ClayDialog from '../os/ClayDialog';

/** 这个角色钉住的要求，改了立刻刷新 */
export const useOocPins = (charId: string): OocPin[] => {
    const [pins, setPins] = useState<OocPin[]>(() => loadOocPins(charId));
    useEffect(() => {
        setPins(loadOocPins(charId));
        const handler = (event: Event) => {
            if ((event as CustomEvent<{ charId?: string }>).detail?.charId === charId) setPins(loadOocPins(charId));
        };
        window.addEventListener(OOC_PINS_CHANGED_EVENT, handler);
        return () => window.removeEventListener(OOC_PINS_CHANGED_EVENT, handler);
    }, [charId]);
    return pins;
};

const smallBtn: React.CSSProperties = { height: 44, padding: '0 14px', borderRadius: R.button, background: F.surfaceSunken, border: 'none', color: F.textPrimary, fontSize: 14, fontWeight: 600 };

export default function DeepTalkPinsSheet({ charId, pins, open, onClose }: { charId: string; pins: OocPin[]; open: boolean; onClose: () => void }) {
    const [editing, setEditing] = useState<number | null>(null);
    const [text, setText] = useState('');
    useEffect(() => { if (!open) setEditing(null); }, [open]);

    return (
        <ClayDialog isOpen={open} title="钉住的要求" onClose={onClose}>
            <div className="flex flex-col" style={{ gap: 12 }}>
                <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: F.textTertiary }}>每一轮都会提醒模型，写得太绝对它会不敢说话。</p>
                {pins.length === 0 && <p style={{ margin: 0, fontSize: 15, color: F.textSecondary }}>现在没有钉住的要求了。</p>}
                {pins.map(pin => editing === pin.id ? (
                    <div key={pin.id} className="flex flex-col" style={{ gap: 8 }}>
                        <textarea value={text} rows={5} aria-label="改这条要求" onChange={event => setText(event.target.value)} className="w-full outline-none resize-none"
                            style={{ padding: '10px 12px', borderRadius: R.input, border: `1px solid ${F.borderSoft}`, background: F.surface, color: F.textPrimary, fontSize: 15, lineHeight: '23px' }} />
                        <div className="flex justify-end" style={{ gap: 8 }}>
                            <button type="button" style={smallBtn} className="clay-press" onClick={() => setEditing(null)}>算了</button>
                            <button type="button" style={smallBtn} className="clay-press" disabled={!text.trim()}
                                onClick={() => { updateOocPin(charId, pin.id, text); setEditing(null); }}>存好</button>
                        </div>
                    </div>
                ) : (
                    <div key={pin.id} className="flex flex-col" style={{ gap: 8, paddingBottom: 12, borderBottom: `1px solid ${F.divider}` }}>
                        <span style={{ fontSize: 15, lineHeight: '23px', color: F.textPrimary, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{pin.text}</span>
                        <div className="flex justify-end" style={{ gap: 8 }}>
                            <button type="button" style={smallBtn} className="clay-press" onClick={() => { setEditing(pin.id); setText(pin.text); }}>改</button>
                            <button type="button" style={smallBtn} className="clay-press" onClick={() => unpinOoc(charId, pin.id)}>取消钉住</button>
                        </div>
                    </div>
                ))}
            </div>
        </ClayDialog>
    );
}
// [EM-END: deep-talk-actions]
