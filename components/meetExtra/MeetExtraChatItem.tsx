// [EM-START: meet-extra]
/** 聊天里那张番外卡：她分享的，靠右；标题 + 梗概两行，点开回见面 App 读全文。 */
import React from 'react';
import type { Message } from '../../types';
import { AppID } from '../../types';
import { useOS } from '../../context/OSContext';
import { F, FONT, R } from '../../utils/clayTokens';
import { dateLaunch } from '../../utils/dateLaunch';
import type { MeetExtraCardMeta } from '../../utils/meetExtra';

export default function MeetExtraChatItem({ msg }: { msg: Message }) {
    const { openApp } = useOS();
    const card = msg.metadata?.meetExtra as MeetExtraCardMeta | undefined;
    if (!card) return null;
    const mine = msg.role === 'user';
    const open = () => {
        dateLaunch.request({ surface: 'extra', extraId: card.id, returnTo: 'chat' });
        openApp(AppID.Date);
    };
    return (
        <div className={`flex w-full my-2 px-4 ${mine ? 'justify-end' : 'justify-start'}`}>
            <button type="button" onClick={open} className="clay-press-card text-left flex flex-col" aria-label={`番外《${card.title}》，点开读全文`}
                style={{ width: '100%', maxWidth: 280, gap: 6, padding: '12px 14px', background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, color: F.textPrimary }}>
                <span style={{ fontSize: 11, letterSpacing: '.08em', color: F.textTertiary }}>番外</span>
                <span style={{ fontFamily: FONT.heading, fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>{card.title}</span>
                <span style={{ fontSize: 13, lineHeight: '19px', color: F.textSecondary, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{card.synopsis}</span>
                <span style={{ alignSelf: 'flex-end', fontSize: 13, color: F.textTertiary }}>点开读 ›</span>
            </button>
        </div>
    );
}
// [EM-END: meet-extra]
