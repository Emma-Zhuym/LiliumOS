// [EM-START: deep-talk-schedule]
/**
 * 点蜡烛时先问一句：现在聊，还是约个时间（阿萌 2026-10-22：想起来「晚上八点找他聊」）。
 * 约了时间，TA 答应以后 mini 到点来叫她；TA 也可以改个时间或者说不行。
 * 雾面底部 sheet，样子照日历「记一件事」；烛下是 indigo 一支墨，这里也只用它。
 */

import React, { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';

import { F, FONT, HUE, OVERLAY, R } from '../../utils/clayTokens';

const C = HUE.indigo;

/** 默认约在下一个整点；晚上七点以前默认八点（深谈多在晚上）。 */
export const defaultInviteClock = (now = new Date()): string => {
    const hour = now.getHours() < 19 ? 20 : (now.getHours() + 1) % 24;
    return `${String(hour).padStart(2, '0')}:00`;
};

interface Props {
    open: boolean;
    charName: string;
    onClose: () => void;
    onNow: () => void;
    onSchedule: (hhmm: string) => void;
}

const DeepTalkInviteSheet: React.FC<Props> = ({ open, charName, onClose, onNow, onSchedule }) => {
    const [clock, setClock] = useState(() => defaultInviteClock());
    useEffect(() => { if (open) setClock(defaultInviteClock()); }, [open]);
    if (!open) return null;

    return (
        <div className="absolute inset-0 flex flex-col justify-end" style={{ background: OVERLAY.scrim, zIndex: 60 }} onClick={onClose}>
            <div onClick={event => event.stopPropagation()} className="flex flex-col clay-sheet-in"
                style={{
                    background: OVERLAY.bg, backdropFilter: OVERLAY.blur, WebkitBackdropFilter: OVERLAY.blur,
                    borderTop: OVERLAY.edge, boxShadow: OVERLAY.hairline,
                    borderTopLeftRadius: R.sheet, borderTopRightRadius: R.sheet, padding: '10px 20px calc(20px + var(--safe-bottom))', gap: 14,
                }}>
                <span style={{ width: 36, height: 4, borderRadius: R.pill, background: OVERLAY.grab, alignSelf: 'center' }} />
                <div className="flex items-center justify-between">
                    <span style={{ ...FONT.navTitle, fontFamily: FONT.heading, color: F.textPrimary }}>点一支蜡烛</span>
                    <button onClick={onClose} aria-label="关闭" className="flex items-center justify-center active:opacity-40 transition-opacity"
                        style={{ width: 44, height: 44, marginRight: -10, borderRadius: R.pill, background: 'transparent' }}>
                        <X size={21} weight="bold" color={F.textPrimary} />
                    </button>
                </div>

                <button onClick={onNow} className="flex items-center justify-center active:translate-y-[1px] transition-transform"
                    style={{ height: 52, borderRadius: R.button, background: C.main, color: F.surfaceRaised, fontSize: 16, fontWeight: 600 }}>
                    现在就想聊
                </button>

                <div className="flex items-center" style={{ gap: 10 }}>
                    <span style={{ fontSize: 14, color: F.textSecondary, flexShrink: 0 }}>约在</span>
                    <input type="time" value={clock} aria-label="约的时间" onChange={event => setClock(event.target.value)}
                        style={{ flex: 1, minWidth: 0, background: OVERLAY.well, border: 'none', borderRadius: R.input, padding: '12px 12px', fontSize: 15, color: F.textPrimary, outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
                    <button onClick={() => clock && onSchedule(clock)} disabled={!clock}
                        className="flex items-center justify-center active:translate-y-[1px] transition-transform disabled:opacity-50"
                        style={{ height: 46, padding: '0 16px', borderRadius: R.button, background: C.tint, color: C.ink, fontSize: 15, fontWeight: 600, flexShrink: 0 }}>
                        约这个时间
                    </button>
                </div>
                <p style={{ fontSize: 12, color: F.textTertiary, lineHeight: 1.6 }}>
                    {charName}答应了的话，到点会来找你（要接着 Mac mini）；已经过了的时间算明天。
                </p>
            </div>
        </div>
    );
};

export default DeepTalkInviteSheet;
// [EM-END: deep-talk-schedule]
