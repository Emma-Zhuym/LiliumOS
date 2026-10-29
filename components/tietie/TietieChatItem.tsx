/**
 * 聊天里那张事后记录卡：名字、第几次、TA 的一句话、在哪 · 多久，点了翻开日记。
 * 没写出来时卡上只有一个「再写一次」。样稿第一屏。
 */
import React from 'react';
import type { Message } from '../../types';
import { F, FONT, HUE, R } from '../../utils/clayTokens';
import { formatTietieDuration, tietieMinutes, tietieNoLabel } from '../../utils/tietie';
import { openTietieDiary, requestTietieRetry, useTietieRecord } from './useTietie';

const clock = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const cardStyle: React.CSSProperties = {
    width: '100%', maxWidth: 320, background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard,
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, color: F.textPrimary, textAlign: 'left',
};

export default function TietieChatItem({ msg, charName }: { msg: Message; charName: string }) {
    const record = useTietieRecord(msg.charId, msg.metadata?.tietieId);
    if (!record) return null;
    const span = `两个人的时间 · ${clock(record.startedAt)}${record.endedBy === 'manual' ? ` – ${clock(record.endedAt)}` : ''}`;

    return (
        <div className="flex w-full flex-col items-start gap-2 my-2 px-4">
            <span style={{ alignSelf: 'center', fontSize: 12, color: F.textTertiary, fontVariantNumeric: 'tabular-nums' }}>{span}</span>
            {record.status === 'done' ? (
                <button type="button" onClick={() => openTietieDiary(record.charId, record.id)} aria-haspopup="dialog"
                    aria-label={`${record.title || '这一次'}，翻开${charName}写的记录`} className="clay-press-card" style={cardStyle}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                        <span style={{ fontFamily: FONT.heading, fontSize: 16, fontWeight: 700, color: HUE.rose.ink }}>{record.title || '这一次'}</span>
                        <span style={{ fontSize: 11, color: F.textTertiary, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{tietieNoLabel(record.no)}</span>
                    </span>
                    {record.oneLine && <span style={{ fontSize: 14, lineHeight: 1.6, color: F.textSecondary }}>{record.oneLine}</span>}
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${F.divider}`, paddingTop: 8 }}>
                        <span style={{ fontSize: 12, color: F.textTertiary }}>
                            {[record.place, formatTietieDuration(tietieMinutes(record))].filter(Boolean).join(' · ')}
                        </span>
                        <span style={{ fontFamily: FONT.hand, fontSize: 18, color: HUE.rose.main }}>翻开 ›</span>
                    </span>
                </button>
            ) : (
                <div style={cardStyle}>
                    <span style={{ fontSize: 14, lineHeight: 1.6, color: F.textSecondary }}>{charName}这一次没写出来（API 没接，或者拒绝了）。</span>
                    <button type="button" onClick={() => requestTietieRetry(record.charId, record.id)} className="active:opacity-60 transition-opacity"
                        style={{ height: 44, borderRadius: R.button, border: `1px solid ${HUE.rose.soft}`, background: HUE.rose.tint, color: HUE.rose.ink, fontSize: 14, fontWeight: 600 }}>
                        再写一次
                    </button>
                </div>
            )}
        </div>
    );
}
