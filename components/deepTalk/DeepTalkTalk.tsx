// [EM-START: deep-talk]
/** 纸面和信笺共用的排版：名字（手写）+ 整段话（衬线、首行缩进），压在 30px 横格上 */
import React from 'react';
import type { Message } from '../../types';
import { FONT } from '../../utils/clayTokens';
import { toParagraphs } from '../../utils/deepTalk';
import type { DeepTalkPalette } from './DeepTalkInk';

export const LINE = 30;

export const DeepTalkSegments: React.FC<{
    segments: Message[];
    palette: DeepTalkPalette;
    names: { userName: string; charName: string };
}> = ({ segments, palette, names }) => (
    <>
        {segments.map(m => {
            const mine = m.role === 'user';
            return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ height: LINE, lineHeight: `${LINE}px`, fontFamily: FONT.hand, fontSize: 19, color: mine ? palette.inkMid : palette.ink }}>
                        {mine ? names.userName : names.charName}
                    </span>
                    {toParagraphs(m.content).map((p, i) => (
                        <p key={i} style={{ margin: 0, textIndent: '2em', color: mine ? palette.inkMe : palette.ink, wordBreak: 'break-word' }}>{p}</p>
                    ))}
                </div>
            );
        })}
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
