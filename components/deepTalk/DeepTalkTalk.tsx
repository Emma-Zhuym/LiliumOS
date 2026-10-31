// [EM-START: deep-talk]
/** 纸面和信笺共用的排版：名字（手写）+ 整段话（衬线、首行缩进），压在 30px 横格上 */
import React, { useRef, useState } from 'react';
import type { Message } from '../../types';
import { CaretDown, CaretRight, Copy } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { copyDeepTalkText } from './DeepTalkSegmentMenu';
import { FONT } from '../../utils/clayTokens';
import { toParagraphs } from '../../utils/deepTalk';
import type { DeepTalkPalette } from './DeepTalkInk';

export const LINE = 30;

/** TA 这段话的思考：名字旁一个淡淡的小标签，点开才展开（不用心象卡片那套样式） */
const ThinkingTag: React.FC<{ palette: DeepTalkPalette; open: boolean; onToggle: () => void }> = ({ palette, open, onToggle }) => (
    <button type="button" onClick={onToggle} aria-expanded={open}
        className="inline-flex items-center active:opacity-40 transition-opacity"
        style={{
            marginLeft: 10, height: 30, padding: '0 2px', gap: 3, background: 'transparent', border: 'none',
            fontFamily: FONT.hand, fontSize: 15, color: palette.inkSoft, verticalAlign: 'top',
        }}>
        {'<Thinking>'}
        {open ? <CaretDown size={10} weight="bold" /> : <CaretRight size={10} weight="bold" />}
    </button>
);

const LONG_PRESS_MS = 500;

/** 长按出菜单：手指挪动就当是在滚动 */
const useSegmentPress = (onLongPress?: () => void) => {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const start = useRef({ x: 0, y: 0 });
    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    if (!onLongPress) return {};
    return {
        onPointerDown: (event: React.PointerEvent) => {
            start.current = { x: event.clientX, y: event.clientY };
            clear();
            timer.current = setTimeout(onLongPress, LONG_PRESS_MS);
        },
        onPointerMove: (event: React.PointerEvent) => {
            if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) clear();
        },
        onPointerUp: clear,
        onPointerCancel: clear,
        onPointerLeave: clear,
        onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); clear(); onLongPress(); },
    };
};

const Segment: React.FC<{ m: Message; palette: DeepTalkPalette; names: { userName: string; charName: string }; onLongPress?: (m: Message) => void }> = ({ m, palette, names, onLongPress }) => {
    const [open, setOpen] = useState(false);
    const { addToast } = useOS();
    const press = useSegmentPress(onLongPress ? () => onLongPress(m) : undefined);
    const quoted = m.replyTo ? `回 ${m.replyTo.name === '我' ? names.userName : m.replyTo.name}：${m.replyTo.content}` : '';
    const mine = m.role === 'user';
    const thinking = !mine && typeof m.metadata?.deepTalkThinking === 'string' ? m.metadata.deepTalkThinking : '';
    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ height: LINE, lineHeight: `${LINE}px`, whiteSpace: 'nowrap' }}>
                <span style={{ fontFamily: FONT.hand, fontSize: 19, color: mine ? palette.inkMid : palette.ink }}>{mine ? names.userName : names.charName}</span>
                {thinking && <ThinkingTag palette={palette} open={open} onToggle={() => setOpen(v => !v)} />}
            </span>
            {open && thinking && (
                <div style={{
                    margin: '2px 0 8px', padding: '6px 0 6px 10px', borderLeft: `1px solid ${palette.line}`,
                    fontFamily: FONT.hand, fontSize: 16, lineHeight: '24px', color: palette.inkSoft, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                    {thinking}
                    <button type="button" onClick={() => void copyDeepTalkText(thinking, addToast)} aria-label="复制思维链"
                        className="flex items-center active:opacity-40 transition-opacity"
                        style={{ minHeight: 44, padding: 0, gap: 6, background: 'transparent', border: 'none', fontFamily: FONT.hand, fontSize: 15, color: palette.inkSoft }}>
                        <Copy size={14} weight="bold" />复制
                    </button>
                </div>
            )}
            {/* 长按出菜单：不让系统的选字和气泡菜单抢这一下 */}
            <div {...press} style={onLongPress ? { WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } : undefined}>
                {quoted && (
                    <div className="truncate" style={{ height: LINE, lineHeight: `${LINE}px`, fontSize: 13, color: palette.inkSoft }}>{quoted}</div>
                )}
                {toParagraphs(m.content).map((p, i) => (
                    <p key={i} style={{ margin: 0, textIndent: '2em', color: mine ? palette.inkMe : palette.ink, wordBreak: 'break-word' }}>{p}</p>
                ))}
            </div>
        </div>
    );
};

export const DeepTalkSegments: React.FC<{
    segments: Message[];
    palette: DeepTalkPalette;
    names: { userName: string; charName: string };
    onLongPress?: (m: Message) => void;
}> = ({ segments, palette, names, onLongPress }) => (
    <>
        {segments.map(m => <Segment key={m.id} m={m} palette={palette} names={names} onLongPress={onLongPress} />)}
    </>
);

/** 纸面 / 信笺开头结尾那一行手写小字（蜡烛 + 一句话） */
export const DeepTalkEdge: React.FC<{ palette: DeepTalkPalette; children: React.ReactNode; candle: React.ReactNode }> = ({ palette, children, candle }) => (
    <div style={{ height: LINE, display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT.hand, fontSize: 17, color: palette.inkSoft }}>
        {candle}{children}
    </div>
);

export const talkTextStyle = (palette: DeepTalkPalette): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', gap: LINE,
    fontFamily: FONT.heading, fontWeight: 400, fontSize: 15, lineHeight: `${LINE}px`, color: palette.ink,
});
// [EM-END: deep-talk]
