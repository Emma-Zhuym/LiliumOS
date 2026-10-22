// [EM-START: deep-talk]
/**
 * 聊的时候：整个聊天区变成纸（样稿 docs/design/deep-talk-v2.html 第一屏）。
 * 没有气泡，名字 + 整段话压在横格上；顶栏是点着的小蜡烛和昼夜开关，输入框旁边是「结束」。
 * 盖在聊天上面（聊天本身还挂着），返回键照常离开聊天，回来还是这张纸。
 */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, CaretLeft } from '@phosphor-icons/react';
import type { CharacterProfile } from '../../types';
import { F, FONT, R } from '../../utils/clayTokens';
import { deepTalkEventText, type DeepTalkNight } from '../../utils/deepTalk';
import { resolveCharTimeZone } from '../../utils/timezone';
import ClayDialog from '../os/ClayDialog';
import { Candle, ruledBackground, ThemeGlyph, useDeepTalkTheme, WobbleDefs } from './DeepTalkInk';
import { DeepTalkEdge, DeepTalkSegments, LINE, talkTextStyle } from './DeepTalkTalk';
import { useNightSegments } from './useDeepTalk';

export default function DeepTalkPaper({ char, userName, night, isTyping, ending, onBack, onSend, onEnd }: {
    char: CharacterProfile;
    userName: string;
    night: DeepTalkNight;
    isTyping: boolean;
    ending: boolean;
    onBack: () => void;
    onSend: (text: string) => Promise<void>;
    onEnd: () => void;
}) {
    const { theme, palette, toggle } = useDeepTalkTheme(char.id, resolveCharTimeZone(char));
    const segments = useNightSegments(char.id, night.id);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [confirmEnd, setConfirmEnd] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const fieldRef = useRef<HTMLTextAreaElement>(null);
    const names = { userName, charName: char.name };

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [segments.length, isTyping]);

    // 输入框跟着内容长高，最多五行
    useEffect(() => {
        const el = fieldRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, LINE * 5 + 16)}px`;
    }, [draft]);

    const busy = isTyping || sending || ending;
    const send = async () => {
        const text = draft.trim();
        if (!text || busy) return;
        setSending(true);
        try {
            await onSend(text);
            setDraft('');
        } finally {
            setSending(false);
        }
    };

    const opening = night.relit ? deepTalkEventText('relight', names) : '蜡烛点上了';

    return (
        <section className="absolute inset-0 z-[44] flex flex-col overflow-hidden" aria-label={`和${char.name}深谈`}
            style={{ background: palette.paper, color: palette.ink }}>
            <WobbleDefs />
            <header className="shrink-0" style={{ paddingTop: 'var(--chrome-top)', background: palette.paper }}>
                <div className="relative flex items-center justify-between px-1.5 py-1.5">
                    <button type="button" aria-label="离开聊天" onClick={onBack}
                        className="grid place-items-center active:opacity-40 transition-opacity" style={{ width: 44, height: 44, background: 'transparent', border: 'none' }}>
                        <CaretLeft size={22} weight="bold" color={palette.ink} />
                    </button>
                    <div className="pointer-events-none absolute inset-x-16 flex flex-col items-center" style={{ gap: 1 }}>
                        <span style={{ ...FONT.navTitle, fontFamily: FONT.heading, color: palette.ink }}>{char.name}</span>
                        <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11, color: palette.inkSoft }}>
                            <Candle lit palette={palette} width={10} height={13} />烛下
                        </span>
                    </div>
                    <button type="button" aria-label={theme === 'night' ? '换成白天的纸' : '换成夜里的纸'} onClick={toggle}
                        className="grid place-items-center active:opacity-40 transition-opacity" style={{ width: 44, height: 44, background: 'transparent', border: 'none' }}>
                        <ThemeGlyph theme={theme} color={palette.ink} />
                    </button>
                </div>
            </header>

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" style={ruledBackground(palette, LINE)}>
                <div style={{ ...talkTextStyle(palette), padding: `${LINE}px 16px ${LINE}px 22px`, marginLeft: 18, borderLeft: `1px solid ${palette.line}`, minHeight: '100%' }}>
                    <DeepTalkEdge palette={palette} candle={<Candle lit palette={palette} />}>{opening}</DeepTalkEdge>
                    <DeepTalkSegments segments={segments} palette={palette} names={names} />
                    {isTyping && (
                        <div style={{ height: LINE, fontFamily: FONT.hand, fontSize: 17, color: palette.inkSoft }}>{char.name}在写……</div>
                    )}
                    {ending && (
                        <DeepTalkEdge palette={palette} candle={<Candle lit={false} palette={palette} />}>烛花在落……</DeepTalkEdge>
                    )}
                </div>
            </div>

            <div className="shrink-0 flex items-end" style={{ gap: 4, padding: '10px 8px calc(12px + var(--safe-bottom)) 12px', borderTop: `1px solid ${palette.line}`, background: palette.paper }}>
                <textarea ref={fieldRef} value={draft} rows={1} placeholder={isTyping ? `${char.name}在写……` : '慢慢说……'}
                    aria-label="写下你想说的"
                    onChange={event => setDraft(event.target.value)}
                    className="flex-1 min-w-0 resize-none outline-none"
                    style={{
                        minHeight: 44, padding: '10px 12px', borderRadius: R.input, border: `1px solid ${palette.line}`,
                        background: palette.paper, color: palette.ink, fontFamily: FONT.heading, fontWeight: 400, fontSize: 15, lineHeight: '22px',
                    }} />
                <button type="button" aria-label="说给 TA 听" onClick={send} disabled={!draft.trim() || busy}
                    className="grid place-items-center active:opacity-40 transition-opacity disabled:opacity-40" style={{ width: 44, height: 44, background: 'transparent', border: 'none' }}>
                    <ArrowUp size={21} weight="bold" color={palette.ink} />
                </button>
                <button type="button" aria-label="结束深谈" onClick={() => setConfirmEnd(true)} disabled={ending}
                    className="inline-flex items-center active:opacity-40 transition-opacity disabled:opacity-40"
                    style={{ height: 44, padding: '0 8px', gap: 4, background: 'transparent', border: 'none', fontFamily: FONT.hand, fontSize: 17, color: palette.ink }}>
                    <Candle lit={false} palette={palette} />结束
                </button>
            </div>

            <ClayDialog isOpen={confirmEnd} title="让蜡烛灭了吗" onClose={() => setConfirmEnd(false)} footer={
                <div className="flex" style={{ gap: 10 }}>
                    <button type="button" onClick={() => setConfirmEnd(false)} className="flex-1 clay-press"
                        style={{ height: 44, borderRadius: R.button, background: F.surface, border: `1px solid ${F.borderSoft}`, color: F.textPrimary, fontSize: 15, fontWeight: 600 }}>
                        再聊会儿
                    </button>
                    <button type="button" onClick={() => { setConfirmEnd(false); onEnd(); }} className="flex-1 clay-press"
                        style={{ height: 46, borderRadius: R.button, background: F.textPrimary, border: 'none', color: F.surface, fontSize: 15, fontWeight: 600 }}>
                        灭了吧
                    </button>
                </div>
            }>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>
                    灭了以后，这一夜会收成一张卡，{char.name}会给它起个名字。{segments.length ? '' : '还一句话都没说，这次就不算一夜。'}
                </p>
            </ClayDialog>
        </section>
    );
}
// [EM-END: deep-talk]
