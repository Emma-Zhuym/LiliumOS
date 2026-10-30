// [EM-START: ooc]
/**
 * 出戏的话（她的 // 和模型的出戏回应）：灰色小气泡，跟剧情明显分开。
 * 她发的那条右上角一个图钉：钉住后每一轮都提醒（utils/emOoc.ts）。长按照常弹消息菜单（删除等）。
 */
import React, { useEffect, useState } from 'react';
import { PushPin } from '@phosphor-icons/react';
import type { Message } from '../../types';
import { F, R } from '../../utils/clayTokens';
import { isOocPinned, OOC_PINS_CHANGED_EVENT, pinOoc, unpinOoc } from '../../utils/emOoc';

interface Props {
    msg: Message;
    /** MessageItem 的长按 / 选择那一套，原样挂在气泡上 */
    interactionProps: React.HTMLAttributes<HTMLDivElement>;
}

const OocChatItem: React.FC<Props> = ({ msg, interactionProps }) => {
    const mine = msg.role === 'user';
    const [pinned, setPinned] = useState(() => mine && isOocPinned(msg.charId, msg.id));
    useEffect(() => {
        if (!mine) return;
        const handler = (event: Event) => {
            if ((event as CustomEvent<{ charId?: string }>).detail?.charId === msg.charId) setPinned(isOocPinned(msg.charId, msg.id));
        };
        window.addEventListener(OOC_PINS_CHANGED_EVENT, handler);
        return () => window.removeEventListener(OOC_PINS_CHANGED_EVENT, handler);
    }, [mine, msg.charId, msg.id]);

    return (
        <div className={`flex w-full px-4 my-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
            <div {...interactionProps} className="flex flex-col select-none"
                style={{ maxWidth: '82%', gap: 4, background: F.surfaceSunken, border: `1px solid ${F.borderSoft}`, borderRadius: R.medium, padding: mine ? '6px 4px 10px 12px' : '10px 12px' }}>
                <div className="flex items-center justify-between" style={{ gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: F.textTertiary }}>
                        {mine ? 'OOC' : 'OOC · 模型'}{pinned ? ' · 已钉住' : ''}
                    </span>
                    {mine && (
                        <button type="button" aria-label={pinned ? '取消钉住' : '钉住：每一轮都提醒'}
                            onPointerDown={event => event.stopPropagation()}
                            onClick={event => { event.stopPropagation(); if (pinned) unpinOoc(msg.charId, msg.id); else pinOoc(msg.charId, msg); }}
                            className="grid place-items-center active:opacity-40 transition-opacity"
                            style={{ width: 44, height: 44, margin: '-12px -4px -14px 0', background: 'transparent', border: 'none' }}>
                            <PushPin size={16} weight={pinned ? 'fill' : 'bold'} color={pinned ? F.textPrimary : F.textTertiary} />
                        </button>
                    )}
                </div>
                <div style={{ fontSize: 14, lineHeight: '21px', color: F.textSecondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
            </div>
        </div>
    );
};

export default OocChatItem;
// [EM-END: ooc]
