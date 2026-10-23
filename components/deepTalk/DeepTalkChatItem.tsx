// [EM-START: deep-talk]
/**
 * 聊天里的两样：蜡烛系统小气泡（邀请 / 蜡烛先留着 / 烛花落了…）和聊完收成的折叠卡。
 * 聊天里保持 F 的克制，一律白天配色；点卡才翻开信笺。
 */
import React from 'react';
import type { Message } from '../../types';
import { FONT } from '../../utils/clayTokens';
import { DEEP_TALK_CARD_KIND, padNight, type DeepTalkEvent } from '../../utils/deepTalk';
import { Candle, DAY_PALETTE, WobbleBorder, WobbleDefs } from './DeepTalkInk';
import { openDeepTalkLetter, requestDeepTalkRelight, useActiveDeepTalk, useNight } from './useDeepTalk';

const palette = DAY_PALETTE;

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

const LIT_EVENTS: DeepTalkEvent[] = ['invite', 'later', 'relight', 'due'];

const EventPill: React.FC<{ msg: Message }> = ({ msg }) => {
    const event = msg.metadata?.deepTalkEvent as DeepTalkEvent;
    const waiting = event === 'later' || event === 'due'; // [EM: deep-talk-schedule] 到点 mini 来叫的那个气泡也能点
    const active = useActiveDeepTalk(waiting ? msg.charId : undefined);
    // 「蜡烛先留着」那一夜还留着的话，点它就重新点上
    const canRelight = waiting && active?.status === 'later' && active.id === msg.metadata?.deepTalkId;
    const text = String(msg.content || '').replace(/^\[|\]$/g, '');
    const body = (
        <>
            <WobbleBorder color={palette.ink} radius="999px" width={1.2} />
            <Candle lit={LIT_EVENTS.includes(event)} palette={palette} />
            <span>{text}</span>
            {msg.metadata?.laterClock && (
                <span style={{ fontFamily: FONT.body, fontSize: 12, color: palette.inkSoft, fontVariantNumeric: 'tabular-nums' }}>约在 {msg.metadata.laterClock}</span>
            )}
        </>
    );
    const style: React.CSSProperties = {
        position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px 5px 10px',
        fontFamily: FONT.hand, fontSize: 17, color: palette.ink, background: 'transparent', border: 'none',
    };
    return (
        <div className="flex w-full justify-center my-2">
            <WobbleDefs />
            {canRelight
                ? <button type="button" onClick={() => requestDeepTalkRelight(msg.charId)} aria-label="重新点上蜡烛" className="active:opacity-40 transition-opacity" style={style}>{body}</button>
                : <div style={style}>{body}</div>}
        </div>
    );
};

const FoldedCard: React.FC<{ msg: Message; charName: string }> = ({ msg, charName }) => {
    const night = useNight(msg.charId, msg.metadata?.deepTalkId);
    if (!night) return null;
    const label: React.CSSProperties = { fontSize: 11, letterSpacing: '.14em', color: palette.inkSoft, fontVariantNumeric: 'tabular-nums' };
    return (
        <div className="flex w-full justify-center my-3 px-4">
            <WobbleDefs />
            <button type="button" onClick={() => openDeepTalkLetter(msg.charId, night.id)} aria-haspopup="dialog"
                aria-label={`第 ${padNight(night.nightNo)} 夜《${night.title || ''}》，翻开信笺`}
                className="clay-press-card text-left"
                style={{
                    position: 'relative', width: '100%', maxWidth: 340, display: 'grid', gridTemplateColumns: 'max-content 1fr',
                    columnGap: 16, rowGap: 12, padding: '16px 16px 14px', background: palette.paper, color: palette.ink, border: 'none',
                }}>
                <WobbleBorder color={palette.ink} />
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, paddingRight: 16, borderRight: `1px solid ${palette.line}` }}>
                    <Candle lit={false} palette={palette} width={22} height={32} />
                    <span style={{ ...label, marginTop: 6 }}>第 {padNight(night.nightNo)} 夜</span>
                    <span style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 19, lineHeight: 1.3, maxWidth: '6em' }}>{night.title}</span>
                    <span style={label}>{clock(night.startedAt)}–{clock(night.endedAt)}</span>
                </span>
                <span style={{ alignSelf: 'center', fontFamily: FONT.heading, fontWeight: 400, fontSize: 14, lineHeight: 1.75 }}>
                    {night.oneLine || `${monthDay(night.startedAt)} 这一夜`}
                </span>
                <span style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: palette.inkSoft }}>
                    <span>{night.segmentCount || 0} 段 · 翻开</span>
                    <span style={{ fontFamily: FONT.hand, fontSize: 17, color: palette.ink }}>{charName}</span>
                </span>
            </button>
        </div>
    );
};

export default function DeepTalkChatItem({ msg, charName }: { msg: Message; charName: string }) {
    return msg.metadata?.kind === DEEP_TALK_CARD_KIND ? <FoldedCard msg={msg} charName={charName} /> : <EventPill msg={msg} />;
}
// [EM-END: deep-talk]
