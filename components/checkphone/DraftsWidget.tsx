// [EM-START: char-drives-pocket]
/**
 * 查手机首页的草稿箱：TA 攒着、还没发给阿萌的话（心跳的话兜，docs/spec-character-drives.md 第 6 节）。
 *
 * 是「翻别人手机」才看得到的东西，所以只放在查手机，不进聊天页。
 * 没有攒着的话就不占位置；mini 不在线时显示上次拉到的那份。
 * 别扭时「打了又删」的那种（kind=grievance）要等心思系统才有，这里先按划掉的样子留好。
 */

import React, { useEffect, useState } from 'react';
import { NotePencil } from '@phosphor-icons/react';

import { loadPocketCache, pocketItemsFor, refreshPocketCache } from '../../utils/emAgentPocket';

/** 跟查手机首页其他小组件用同一套颜色（CheckPhone 里的 CF），不另取值。 */
export interface DraftsWidgetPalette {
    text: string;
    sub: string;
    cardBg: string;
    border: string;
    font: string;
    mono: string;
}

const MAX_SHOWN = 3;

export const draftAgo = (iso: string, now = Date.now()): string => {
    const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
    if (!Number.isFinite(minutes) || minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return '昨天';
};

const DraftsWidget: React.FC<{ charId: string; palette: DraftsWidgetPalette }> = ({ charId, palette }) => {
    const [items, setItems] = useState(() => loadPocketCache().items);

    useEffect(() => {
        let alive = true;
        refreshPocketCache().then(cache => { if (alive) setItems(cache.items); });
        return () => { alive = false; };
    }, [charId]);

    const mine = pocketItemsFor(items, charId).slice(0, MAX_SHOWN);
    if (!mine.length) return null;

    return (
        <div className="rounded-[20px] p-4 mb-4" style={{ background: palette.cardBg, border: `1px solid ${palette.border}` }}>
            <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ fontFamily: palette.mono, color: palette.text }}>Drafts</span>
                <span className="flex items-center gap-1 text-[10px]" style={{ color: palette.sub }}>
                    <NotePencil size={12} weight="light" />
                    还没发出去的
                </span>
            </div>
            <div className="space-y-2.5">
                {mine.map(item => (
                    <div key={`${item.createdAt}:${item.text}`} className="flex items-baseline gap-2.5">
                        <span className="text-[12px] leading-relaxed flex-1 min-w-0"
                            style={{
                                fontFamily: palette.font,
                                color: item.kind === 'grievance' ? palette.sub : palette.text,
                                textDecoration: item.kind === 'grievance' ? 'line-through' : undefined,
                            }}>
                            {item.text}
                        </span>
                        <span className="text-[10px] tabular-nums shrink-0" style={{ fontFamily: palette.mono, color: palette.sub }}>{draftAgo(item.createdAt)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DraftsWidget;
// [EM-END: char-drives-pocket]
