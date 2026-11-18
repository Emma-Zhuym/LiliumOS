// [EM-START: meet-extra]
/**
 * 读一篇番外。纸和墨跟见面长文页一套（烛下那套纸，昼夜同一个开关），字是衬线、整段读。
 * 写的时候字一段段流出来；底下「…」里有分享给 TA、接着写、重写、看梗概、删掉。
 */
import React, { useEffect, useRef, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { F, FONT, R, STATUS } from '../../utils/clayTokens';
import { resolveCharacterApiConfig } from '../../utils/characterApi';
import { resolveCharTimeZone } from '../../utils/timezone';
import { MEET_EXTRA_LENGTHS, MEET_EXTRA_MEMORY, MEET_EXTRA_POV, countExtraChars } from '../../utils/meetExtra';
import { shareMeetExtra, stopMeetExtra, writeMeetExtra } from '../../utils/meetExtraActions';
import { MeetExtraDB } from '../../utils/meetExtraDb';
import ClayDialog from '../os/ClayDialog';
import { ThemeGlyph, useDeepTalkTheme } from '../deepTalk/DeepTalkInk';
import { ExtraHeader } from './ExtraHeader';
import { useMeetExtra } from './useMeetExtra';

const Row: React.FC<{ onClick: () => void; danger?: boolean; disabled?: boolean; children: React.ReactNode }> = ({ onClick, danger, disabled, children }) => (
    <button type="button" onClick={onClick} disabled={disabled} className="w-full clay-press disabled:opacity-40"
        style={{ height: 46, borderRadius: R.button, background: F.surfaceSunken, border: 'none', color: danger ? STATUS.danger.main : F.textPrimary, fontSize: 15, fontWeight: 600 }}>
        {children}
    </button>
);

const MeetExtraReader: React.FC<{ id: string; onBack: () => void; onDeleted: () => void }> = ({ id, onBack, onDeleted }) => {
    const { characters, userProfile, apiConfig, addToast } = useOS();
    const { row, liveBody, running } = useMeetExtra(id);
    const char = row ? characters.find(c => c.id === row.charId) : undefined;
    const { theme, palette, toggle } = useDeepTalkTheme(row?.charId || 'meet-extra', char ? resolveCharTimeZone(char) : undefined);
    const [menu, setMenu] = useState(false);
    const [dialog, setDialog] = useState<'continue' | 'rewrite' | 'delete' | 'synopsis' | null>(null);
    const [hint, setHint] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const stick = useRef(true);

    const body = liveBody ?? row?.body ?? '';
    useEffect(() => {
        const el = scrollRef.current;
        if (el && running && stick.current) el.scrollTop = el.scrollHeight;
    }, [body, running]);

    const api = () => {
        if (!char) return null;
        const { apiConfig: resolved } = resolveCharacterApiConfig(char, apiConfig);
        if (!resolved?.baseUrl) { addToast(`${char.name}还没接 API`, 'error'); return null; }
        return resolved;
    };
    const write = (mode: 'fresh' | 'continue', extraHint?: string) => {
        const resolved = api();
        if (!resolved || !char) return;
        stick.current = true;
        void writeMeetExtra({ char, user: userProfile, api: resolved, id, mode, hint: extraHint });
    };
    const share = async () => {
        const resolved = api();
        if (!resolved || !char) return;
        const messageId = await shareMeetExtra({ char, user: userProfile, api: resolved, id });
        addToast(messageId ? `已经分享给${char.name}，去聊天里说说吧` : '还没写完，写完再分享', messageId ? 'success' : 'error');
    };

    if (row === undefined) return <div className="h-full w-full" style={{ background: palette.paper }} />;
    if (row === null) {
        return (
            <div className="h-full w-full flex flex-col" style={{ background: F.appBg }}>
                <ExtraHeader title="番外" onBack={onBack} />
                <p style={{ margin: '80px 24px', textAlign: 'center', fontSize: 15, color: F.textSecondary }}>这篇番外已经删掉了。</p>
            </div>
        );
    }

    const paragraphs = body.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const stale = row.status === 'writing' && !running;
    const words = countExtraChars(body);

    return (
        <div className="h-full w-full flex flex-col" style={{ background: palette.paper, color: palette.ink }}>
            <ExtraHeader title={char?.name ? `${char.name} · 番外` : '番外'} onBack={onBack} color={palette.ink} right={<>
                <button type="button" aria-label={theme === 'night' ? '换成白天' : '换成夜里'} onClick={toggle} className="grid place-items-center active:opacity-40 transition-opacity"
                    style={{ width: 44, height: 44, background: 'transparent', border: 'none' }}>
                    <ThemeGlyph theme={theme} color={palette.ink} />
                </button>
                <button type="button" aria-label="更多" onClick={() => setMenu(true)} className="grid place-items-center active:opacity-40 transition-opacity"
                    style={{ width: 44, height: 44, background: 'transparent', border: 'none', color: palette.ink }}>
                    <DotsThree size={24} weight="bold" />
                </button>
            </>} />

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
                onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
                <article className="mx-auto flex flex-col" style={{ maxWidth: 620, gap: 14, padding: '12px 24px calc(48px + var(--safe-bottom))' }}>
                    <h2 style={{ margin: '8px 0 0', fontFamily: FONT.heading, fontSize: 22, fontWeight: 700, lineHeight: 1.4, color: palette.ink }}>{row.title}</h2>
                    <div style={{ fontSize: 12, color: palette.inkSoft, fontVariantNumeric: 'tabular-nums' }}>
                        {[MEET_EXTRA_MEMORY[row.memory].label, MEET_EXTRA_POV[row.pov], words ? `${words} 字` : MEET_EXTRA_LENGTHS[row.length].label].join(' · ')}
                    </div>
                    <div style={{ height: 1, background: palette.rule, margin: '4px 0 6px' }} />
                    {paragraphs.map((p, i) => (
                        <p key={i} className="whitespace-pre-wrap" style={{ margin: 0, fontFamily: FONT.heading, fontWeight: 400, fontSize: 16, lineHeight: 1.95, textAlign: 'justify', color: palette.ink }}>{p}</p>
                    ))}

                    {running && (
                        <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
                            <span style={{ fontFamily: FONT.hand, fontSize: 18, color: palette.inkSoft }}>{char?.name || 'TA'}在写……</span>
                            <button type="button" onClick={() => stopMeetExtra(id)} className="active:opacity-40"
                                style={{ minHeight: 44, padding: '0 8px', background: 'transparent', border: 'none', fontSize: 14, color: palette.inkMid }}>停下</button>
                        </div>
                    )}
                    {!running && (row.status === 'failed' || stale || row.short || row.error) && (
                        <div className="flex flex-col" style={{ gap: 10, marginTop: 12 }}>
                            <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: row.status === 'failed' ? STATUS.danger.main : palette.inkSoft }}>
                                {row.status === 'failed' ? `没写出来（${row.error || '请求失败'}）。`
                                    : stale ? '写到一半页面关了。'
                                        : row.error ? `停在这里了（${row.error}）。` : '比预期短一些。'}
                            </p>
                            <div className="flex" style={{ gap: 8 }}>
                                {row.body.trim() && <button type="button" onClick={() => write('continue')} className="flex-1 active:opacity-60"
                                    style={{ height: 44, borderRadius: R.button, border: `1px solid ${palette.line}`, background: 'transparent', color: palette.ink, fontSize: 14, fontWeight: 600 }}>接着写</button>}
                                <button type="button" onClick={() => write('fresh')} className="flex-1 active:opacity-60"
                                    style={{ height: 44, borderRadius: R.button, border: `1px solid ${palette.line}`, background: 'transparent', color: palette.ink, fontSize: 14, fontWeight: 600 }}>重写</button>
                            </div>
                        </div>
                    )}
                    {!running && row.status === 'done' && (
                        <button type="button" onClick={() => void share()} className="self-center active:opacity-40"
                            style={{ marginTop: 20, minHeight: 44, padding: '0 12px', background: 'transparent', border: 'none', fontFamily: FONT.hand, fontSize: 20, color: palette.inkMid }}>
                            {row.sharedAt ? '再分享一次给 TA' : `拿给${char?.name || 'TA'}看看 ›`}
                        </button>
                    )}
                </article>
            </div>

            <ClayDialog isOpen={menu} title="这篇番外" onClose={() => setMenu(false)}>
                <div className="flex flex-col" style={{ gap: 8 }}>
                    <Row disabled={running || row.status !== 'done'} onClick={() => { setMenu(false); void share(); }}>分享给{char?.name || 'TA'}</Row>
                    <Row disabled={running || !row.body.trim()} onClick={() => { setMenu(false); setHint(''); setDialog('continue'); }}>接着写</Row>
                    <Row disabled={running} onClick={() => { setMenu(false); setDialog('rewrite'); }}>重写</Row>
                    <Row onClick={() => { setMenu(false); setDialog('synopsis'); }}>看梗概</Row>
                    <Row danger onClick={() => { setMenu(false); setDialog('delete'); }}>删掉</Row>
                </div>
            </ClayDialog>

            <ClayDialog isOpen={dialog === 'continue'} title="接着写" onClose={() => setDialog(null)}
                footer={<Row onClick={() => { setDialog(null); write('continue', hint); }}>接着写</Row>}>
                <textarea value={hint} onChange={e => setHint(e.target.value)} rows={3} aria-label="接下来往哪写"
                    placeholder="可以留空；也可以说一句接下来往哪写，比如「往虐里写」"
                    style={{ width: '100%', borderRadius: R.input, border: 'none', background: F.surfaceSunken, color: F.textPrimary, fontSize: 15, lineHeight: '22px', padding: '10px 12px', outline: 'none', resize: 'none' }} />
            </ClayDialog>

            <ClayDialog isOpen={dialog === 'rewrite'} title="整篇重写？" onClose={() => setDialog(null)}
                footer={<Row onClick={() => { setDialog(null); write('fresh'); }}>重写</Row>}>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>现在这篇会被换掉，梗概和设置不变。</p>
            </ClayDialog>

            <ClayDialog isOpen={dialog === 'delete'} title="删掉这篇？" onClose={() => setDialog(null)}
                footer={<Row danger onClick={async () => { setDialog(null); stopMeetExtra(id); await MeetExtraDB.remove(id); onDeleted(); }}>删掉</Row>}>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>删了就找不回来了。已经分享到聊天里的那张卡还在，TA 照样记得聊过。</p>
            </ClayDialog>

            <ClayDialog isOpen={dialog === 'synopsis'} title="梗概" onClose={() => setDialog(null)}>
                <div className="flex flex-col" style={{ gap: 10 }}>
                    <p className="whitespace-pre-wrap" style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textPrimary }}>{row.synopsis}</p>
                    {row.extra && <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: F.textSecondary }}>补充：{row.extra}</p>}
                    <p style={{ margin: 0, fontSize: 12, color: F.textTertiary }}>{MEET_EXTRA_MEMORY[row.memory].hint}</p>
                </div>
            </ClayDialog>
        </div>
    );
};

export default MeetExtraReader;
// [EM-END: meet-extra]
