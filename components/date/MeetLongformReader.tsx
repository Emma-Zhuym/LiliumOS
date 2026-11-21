// [EM-START: meet-longform]
/**
 * 见面「陪伴」长文模式的阅读页（2026-11-14 阿萌选样稿 B：人铺满，字在纸上）。
 *
 * 立绘铺满整屏、只淡一点点；字落在一张半透明的纸上，往上滑纸盖过人。
 * 看得清字靠的是字底下那层纸，跟立绘深浅无关，所以深色西装也不怕。
 * 纸和墨借烛下那套（白天 F.appBg + indigo，夜里 CANDLE_NIGHT），昼夜开关也共用。
 * 整段摊开读，没有一句一句点。
 */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, CaretLeft, DotsThree } from '@phosphor-icons/react';
import type { CharacterProfile, Message, UserProfile } from '../../types';
import { F, FONT, R, STATUS } from '../../utils/clayTokens';
import { extractObservation, hasObservation } from '../../utils/datePrompts';
import { paperVeil, splitInnerThoughts, splitLongformParagraphs } from '../../utils/emMeetLongform';
import { MEETING_CONTINUE_DISPLAY_TEXT } from '../../utils/meetingContinue';
import ClayDialog from '../os/ClayDialog';
import TokenImg from '../os/TokenImg';
import ObserveHUD from './ObserveHUD';
import { usePrivateMoment } from '../chat/PrivateMomentButton';
import { ThemeGlyph, useDeepTalkTheme } from '../deepTalk/DeepTalkInk';
import { resolveCharTimeZone } from '../../utils/timezone';

const Row: React.FC<{ onClick: () => void; danger?: boolean; disabled?: boolean; children: React.ReactNode }> = ({ onClick, danger, disabled, children }) => (
    <button type="button" onClick={onClick} disabled={disabled} className="w-full clay-press disabled:opacity-40"
        style={{ height: 46, borderRadius: R.button, background: F.surfaceSunken, border: 'none', color: danger ? STATUS.danger.main : F.textPrimary, fontSize: 15, fontWeight: 600 }}>
        {children}
    </button>
);

const EDGE_MASK = 'linear-gradient(transparent 0, transparent calc(var(--chrome-top) + 50px), #000 calc(var(--chrome-top) + 86px), #000 calc(100% - 92px - var(--safe-bottom)), transparent calc(100% - 66px - var(--safe-bottom)))';
const EDGE_FADE: React.CSSProperties = { maskImage: EDGE_MASK, WebkitMaskImage: EDGE_MASK };

interface Props {
    char: CharacterProfile;
    userProfile: UserProfile;
    messages: Message[];
    hiddenCount: number;
    canLoadMore: boolean;
    onLoadMore: () => void;
    spriteSrc: string;
    input: string;
    setInput: (text: string) => void;
    isTyping: boolean;
    retryText: string;
    errorText: string;
    canReroll: boolean;
    onSend: () => void;
    onContinue: () => void;
    onReroll: () => void;
    onOpenSettings: () => void;
    /** 换成立绘模式（一行一念逐条点）[EM: meet-redesign] */
    onSpriteMode: () => void;
    onExit: () => void;
    onEditMessage: (msg: Message) => void;
    onDeleteMessage: (msg: Message) => void;
    /** 多选删除 [EM: meet-longform-multiselect] */
    onDeleteMessages: (ids: number[]) => Promise<void>;
    onToast: (text: string, type: 'success' | 'error') => void;
}

const MeetLongformReader: React.FC<Props> = (props) => {
    const { char, userProfile, messages, spriteSrc, input, setInput, isTyping, retryText, errorText } = props;
    const { theme, palette, toggle } = useDeepTalkTheme(char.id, resolveCharTimeZone(char));
    // 贴贴开着：提示词换成亲密写法（datePrompts 读本机记的那一次）；在这里结束的，回到聊天时写事后记录
    const tietie = usePrivateMoment(char.id, { away: true });
    const night = theme === 'night';
    const scrollRef = useRef<HTMLDivElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [exitOpen, setExitOpen] = useState(false);
    const [picked, setPicked] = useState<Message | null>(null);
    // [EM-START: meet-longform-multiselect] 多选：长按菜单里进，点一段选 / 不选，底栏删除
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<Set<number>>(() => new Set());
    const [confirmBulk, setConfirmBulk] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);
    const toggleSelected = (id: number) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const exitSelecting = () => { setSelecting(false); setSelected(new Set()); };
    const deleteSelected = async () => {
        if (bulkBusy || selected.size === 0) return;
        setBulkBusy(true);
        try {
            await props.onDeleteMessages([...selected]);
            setConfirmBulk(false);
            exitSelecting();
        } catch {
            props.onToast('删除失败，请再试一次', 'error');
        } finally {
            setBulkBusy(false);
        }
    };
    // [EM-END: meet-longform-multiselect]
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pressStart = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length, isTyping, errorText]);

    const startPress = (event: React.PointerEvent, msg: Message) => {
        if (selecting) return; // [EM: meet-longform-multiselect]
        pressStart.current = { x: event.clientX, y: event.clientY };
        pressTimer.current = setTimeout(() => setPicked(msg), 550);
    };
    const movePress = (event: React.PointerEvent) => {
        if (!pressTimer.current || !pressStart.current) return;
        if (Math.abs(event.clientX - pressStart.current.x) > 10 || Math.abs(event.clientY - pressStart.current.y) > 10) endPress();
    };
    const endPress = () => {
        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = null;
    };

    const canRetry = !input.trim() && !isTyping && !!retryText;
    const veil = paperVeil(palette.paper, 0.86);
    const textStyle: React.CSSProperties = { margin: 0, fontFamily: FONT.heading, fontWeight: 400, fontSize: 15, lineHeight: 1.95, textAlign: 'justify' };
    const iconBtn: React.CSSProperties = { width: 44, height: 44, background: 'transparent', border: 'none', color: palette.ink };

    return (
        <div className="h-full w-full relative overflow-hidden select-none" style={{ background: palette.paper, isolation: 'isolate' }}>
            {spriteSrc && (
                <TokenImg key={spriteSrc} value={spriteSrc} alt="" draggable={false}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none clay-fade-in"
                    style={{ objectPosition: '50% 12%', opacity: night ? 0.6 : 0.78, zIndex: 0 }} />
            )}

            {/* 字滑到顶栏和输入框底下时淡出去，不跟按钮叠在一起 */}
            <div ref={scrollRef} className="absolute inset-0 overflow-y-auto no-scrollbar overscroll-contain" style={{ zIndex: 1, ...EDGE_FADE }}>
                <div className="flex flex-col" style={{
                    marginTop: '46vh', minHeight: '54vh', gap: 18,
                    padding: '30px 22px calc(96px + var(--safe-bottom))',
                    background: `linear-gradient(${paperVeil(palette.paper, 0)}, ${veil} 34px)`,
                }}>
                    {(props.hiddenCount > 0 || props.canLoadMore) && (
                        <button type="button" onClick={props.onLoadMore} className="self-center active:opacity-40 transition-opacity"
                            style={{ minHeight: 44, padding: '0 8px', background: 'transparent', border: 'none', fontFamily: FONT.hand, fontSize: 17, color: palette.inkSoft }}>
                            更早的{props.hiddenCount > 0 ? `（${props.hiddenCount}）` : ''}
                        </button>
                    )}
                    {messages.map((msg, index) => {
                        const isUser = msg.role === 'user';
                        const raw = isUser ? (msg.content || '') : extractObservation(msg.content || '', { lenient: !!char.dateObserve?.enabled, custom: char.dateObserve?.custom });
                        const body = typeof raw === 'string' ? raw : raw.rest;
                        const obs = typeof raw === 'string' ? null : raw.observation;
                        const paragraphs = isUser ? [{ text: body.trim() }] : splitLongformParagraphs(body);
                        if (paragraphs.length === 0) return null;
                        const isContinue = isUser && body.trim() === MEETING_CONTINUE_DISPLAY_TEXT;
                        const isSelected = selecting && selected.has(msg.id);
                        return (
                            <section key={msg.id} className="flex flex-col"
                                style={{
                                    gap: 8, paddingTop: index === 0 ? 0 : 16, borderTop: index === 0 ? 'none' : `1px solid ${palette.rule}`,
                                    // [EM: meet-longform-multiselect] 选中的那段左边一道墨线，没选中的淡一点
                                    ...(selecting ? { paddingLeft: 12, borderLeft: `2px solid ${isSelected ? palette.ink : 'transparent'}`, opacity: isSelected ? 1 : 0.55, cursor: 'pointer' } : null),
                                }}
                                aria-pressed={selecting ? isSelected : undefined}
                                onClick={selecting ? () => toggleSelected(msg.id) : undefined}
                                onPointerDown={event => startPress(event, msg)} onPointerMove={movePress} onPointerUp={endPress} onPointerCancel={endPress} onPointerLeave={endPress}
                                onContextMenu={event => { event.preventDefault(); if (!selecting) setPicked(msg); }}>
                                <div style={{ fontFamily: FONT.hand, fontSize: 21, lineHeight: 1, color: isUser ? palette.inkMe : palette.inkMid }}>
                                    {isUser ? (userProfile.name || '我') : char.name}
                                </div>
                                {!isUser && char.dateObserve?.enabled && obs && hasObservation(obs) && (
                                    <ObserveHUD observation={obs} variant="card" charName={char.name} config={char.dateObserve} />
                                )}
                                {isContinue
                                    ? <p style={{ ...textStyle, fontFamily: FONT.hand, fontSize: 16, color: palette.inkSoft }}>（陪着，没说话）</p>
                                    : paragraphs.map((para, i) => (
                                        <p key={i} className="whitespace-pre-wrap" style={{ ...textStyle, color: isUser ? palette.inkMe : palette.ink }}>
                                            {splitInnerThoughts(para.text).map((part, j) => part.thought
                                                ? <em key={j} style={{ fontStyle: 'italic', color: isUser ? palette.inkMe : palette.inkMid }}>{part.text}</em>
                                                : <React.Fragment key={j}>{part.text}</React.Fragment>)}
                                        </p>
                                    ))}
                            </section>
                        );
                    })}
                    {isTyping && (
                        <div style={{ fontFamily: FONT.hand, fontSize: 17, color: palette.inkSoft }}>{char.name}在写……</div>
                    )}
                    {!isTyping && errorText && (
                        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: STATUS.danger.main }}>{errorText}</p>
                    )}
                </div>
            </div>

            <header className="absolute inset-x-0 top-0 flex items-center justify-between"
                style={{ zIndex: 2, padding: 'var(--chrome-top) 4px 18px', background: `linear-gradient(${paperVeil(palette.paper, 0.72)}, ${paperVeil(palette.paper, 0)})` }}>
                <button type="button" aria-label="离开" onClick={() => setExitOpen(true)} className="grid place-items-center active:opacity-40 transition-opacity" style={iconBtn}>
                    <CaretLeft size={22} weight="bold" />
                </button>
                <div className="flex flex-col items-center">
                    <span style={{ ...FONT.navTitle, fontFamily: FONT.heading, color: palette.ink }}>{char.name}</span>
                    {tietie.active && <span style={{ fontFamily: FONT.hand, fontSize: 14, lineHeight: 1.2, color: palette.inkMid }}>两个人的时间</span>}
                </div>
                <div className="flex items-center">
                    <button type="button" aria-label={night ? '换成白天' : '换成夜里'} onClick={toggle} className="grid place-items-center active:opacity-40 transition-opacity" style={iconBtn}>
                        <ThemeGlyph theme={theme} color={palette.ink} />
                    </button>
                    <button type="button" aria-label="更多" onClick={() => setMenuOpen(true)} className="grid place-items-center active:opacity-40 transition-opacity" style={iconBtn}>
                        <DotsThree size={24} weight="bold" />
                    </button>
                </div>
            </header>

            {/* [EM-START: meet-longform-multiselect] 多选时底栏换成「取消 / 删除 n 段」 */}
            {selecting ? (
            <div className="absolute flex items-center justify-between" style={{ zIndex: 3, left: 12, right: 12, bottom: 'calc(12px + var(--safe-bottom))', padding: '0 6px', minHeight: 56, borderRadius: R.input, background: palette.paper, border: `1px solid ${palette.line}` }}>
                <button type="button" onClick={exitSelecting} className="active:opacity-40 transition-opacity"
                    style={{ height: 44, padding: '0 10px', background: 'transparent', border: 'none', fontSize: 15, fontWeight: 600, color: palette.inkMid }}>
                    取消
                </button>
                <span style={{ fontSize: 13, color: palette.inkSoft }}>选了 {selected.size} 段</span>
                <button type="button" onClick={() => setConfirmBulk(true)} disabled={selected.size === 0} className="active:opacity-40 transition-opacity disabled:opacity-40"
                    style={{ height: 44, padding: '0 10px', background: 'transparent', border: 'none', fontSize: 15, fontWeight: 600, color: STATUS.danger.main }}>
                    删除
                </button>
            </div>
            ) : (
            <div className="absolute flex items-end" style={{ zIndex: 3, left: 12, right: 12, bottom: 'calc(12px + var(--safe-bottom))', gap: 4, padding: '6px 6px 6px 14px', borderRadius: R.input, background: palette.paper, border: `1px solid ${palette.line}` }}>
                <textarea value={input} onChange={event => setInput(event.target.value)} rows={1} aria-label="写点什么"
                    placeholder={isTyping ? `${char.name}在写……` : '写点什么…'} disabled={isTyping}
                    className="flex-1 min-w-0 outline-none resize-none no-scrollbar bg-transparent"
                    style={{ maxHeight: 120, padding: '11px 0', border: 'none', color: palette.ink, fontFamily: FONT.heading, fontSize: 15, lineHeight: '22px' }} />
                {!input.trim() && !canRetry ? (
                    <button type="button" onClick={props.onContinue} disabled={isTyping} className="active:opacity-40 transition-opacity disabled:opacity-40"
                        style={{ height: 44, padding: '0 8px', background: 'transparent', border: 'none', fontFamily: FONT.hand, fontSize: 17, color: palette.inkMid }}>
                        你继续
                    </button>
                ) : (
                    <button type="button" onClick={props.onSend} disabled={isTyping} aria-label={canRetry ? '重试' : '发送'}
                        className="grid place-items-center active:opacity-40 transition-opacity disabled:opacity-40"
                        style={{ height: 44, minWidth: 44, padding: canRetry ? '0 8px' : 0, background: 'transparent', border: 'none', color: palette.inkMid, fontFamily: FONT.hand, fontSize: 17 }}>
                        {canRetry ? '重试' : <ArrowUp size={22} weight="bold" />}
                    </button>
                )}
            </div>
            )}
            {/* [EM-END: meet-longform-multiselect] */}

            <ClayDialog isOpen={menuOpen} title="见面" onClose={() => setMenuOpen(false)}>
                <div className="flex flex-col" style={{ gap: 8 }}>
                    {tietie.paired && (
                        <Row disabled={tietie.busy} onClick={() => { setMenuOpen(false); void tietie.toggle(); }}>{tietie.active ? '结束贴贴' : '开始贴贴'}</Row>
                    )}
                    <Row disabled={!props.canReroll || isTyping} onClick={() => { setMenuOpen(false); props.onReroll(); }}>重写 TA 这一段</Row>
                    <Row onClick={() => { setMenuOpen(false); props.onSpriteMode(); }}>切到立绘模式</Row>
                    <Row onClick={() => { setMenuOpen(false); props.onOpenSettings(); }}>见面设置</Row>
                    <Row onClick={() => { setMenuOpen(false); setExitOpen(true); }}>保存并离开</Row>
                </div>
            </ClayDialog>

            <ClayDialog isOpen={exitOpen} title="先离开一下？" onClose={() => setExitOpen(false)}
                footer={<Row onClick={() => { setExitOpen(false); props.onExit(); }}>保存并离开</Row>}>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>这次见面会留着，下次进来可以接着聊。</p>
            </ClayDialog>

            <ClayDialog isOpen={!!picked} title={picked?.role === 'user' ? '我说的这段' : '这一段'} onClose={() => setPicked(null)}>
                <div className="flex flex-col" style={{ gap: 8 }}>
                    <Row onClick={() => {
                        const text = (picked?.content || '').replace(/\[\[.*?\]\]/g, '').replace(/\[.*?\]/g, '').replace(/[*＊]/g, '').trim();
                        navigator.clipboard.writeText(text).then(() => props.onToast('已复制', 'success')).catch(() => props.onToast('复制失败，请再试一次', 'error'));
                        setPicked(null);
                    }}>复制</Row>
                    <Row onClick={() => { if (picked) props.onEditMessage(picked); setPicked(null); }}>编辑</Row>
                    <Row onClick={() => { if (picked) { setSelected(new Set([picked.id])); setSelecting(true); } setPicked(null); }}>多选</Row>{/* [EM: meet-longform-multiselect] */}
                    <Row danger onClick={() => { if (picked) props.onDeleteMessage(picked); setPicked(null); }}>删除</Row>
                </div>
            </ClayDialog>
            {/* [EM: meet-longform-multiselect] */}
            <ClayDialog isOpen={confirmBulk} title={`删除这 ${selected.size} 段？`} onClose={() => { if (!bulkBusy) setConfirmBulk(false); }}
                footer={<Row danger disabled={bulkBusy} onClick={() => void deleteSelected()}>删除</Row>}>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>删了就找不回来了，TA 之后也看不到这几段。</p>
            </ClayDialog>
            {tietie.dialog}
        </div>
    );
};

export default MeetLongformReader;
// [EM-END: meet-longform]
