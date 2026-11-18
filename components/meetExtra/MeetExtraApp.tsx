// [EM-START: meet-extra]
/**
 * 见面 · 番外：书架 → 写一篇 → 读。契约 docs/spec-meet-extra.md。
 * 见面选人页顶上「陪伴 / 番外」进来；聊天里的番外卡点开直接落到阅读页（dateLaunch.extraId）。
 * 剧情剧场和异格从书架最底下一行小字进（不删，只收起来）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { F, FONT, R, STATUS, iconButtonBare } from '../../utils/clayTokens';
import { MEET_EXTRA_LENGTHS, MEET_EXTRA_MEMORY, countExtraChars, type MeetExtra } from '../../utils/meetExtra';
import { isMeetExtraWriting } from '../../utils/meetExtraActions';
import TokenImg from '../os/TokenImg';
import { ExtraHeader } from './ExtraHeader';
import { useMeetExtras } from './useMeetExtra';
import MeetExtraComposer from './MeetExtraComposer';
import MeetExtraReader from './MeetExtraReader';
import PresetLibraryPage from './PresetLibraryPage'; // [EM: preset-library]

const dateLabel = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const statusText = (row: MeetExtra): { text: string; tone: 'plain' | 'bad' } | null => {
    if (row.status === 'writing') return isMeetExtraWriting(row.id) ? { text: '在写…', tone: 'plain' } : { text: '没写完', tone: 'bad' };
    if (row.status === 'failed') return { text: '没写出来', tone: 'bad' };
    return null;
};

type View = { kind: 'shelf' } | { kind: 'compose'; charId?: string } | { kind: 'read'; id: string } | { kind: 'library'; back: View };

const MeetExtraApp: React.FC<{
    initialExtraId?: string;
    onBack: () => void;
    onOpenStory: () => void;
}> = ({ initialExtraId, onBack, onOpenStory }) => {
    const { characters, registerBackHandler } = useOS();
    const rows = useMeetExtras();
    const [view, setView] = useState<View>(initialExtraId ? { kind: 'read', id: initialExtraId } : { kind: 'shelf' });
    const [filter, setFilter] = useState<string | null>(null);
    const fromCard = !!initialExtraId;

    const back = () => {
        if (view.kind === 'shelf' || (fromCard && view.kind === 'read' && view.id === initialExtraId)) onBack();
        else setView({ kind: 'shelf' });
    };
    useEffect(() => registerBackHandler(() => { back(); return true; }), [view, registerBackHandler]); // eslint-disable-line react-hooks/exhaustive-deps

    const charById = useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);
    const shown = (rows || []).filter(r => !filter || r.charId === filter);
    const authors = useMemo(() => characters.filter(c => (rows || []).some(r => r.charId === c.id)), [characters, rows]);

    if (view.kind === 'library') {
        return <PresetLibraryPage onBack={() => setView(view.back)} />;
    }
    if (view.kind === 'compose') {
        return <MeetExtraComposer initialCharId={view.charId || filter || undefined} onBack={() => setView({ kind: 'shelf' })} onStarted={id => setView({ kind: 'read', id })}
            onOpenLibrary={() => setView({ kind: 'library', back: view })} />;
    }
    if (view.kind === 'read') {
        return <MeetExtraReader id={view.id} onBack={back} onDeleted={() => (fromCard && view.id === initialExtraId ? onBack() : setView({ kind: 'shelf' }))} />;
    }

    return (
        <div className="h-full w-full flex flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
            <ExtraHeader title="番外" onBack={back} right={
                <button type="button" aria-label="写一篇" onClick={() => setView({ kind: 'compose' })} className="grid place-items-center active:opacity-40 transition-opacity" style={{ ...iconButtonBare, color: F.textPrimary }}>
                    <Plus size={21} weight="bold" />
                </button>
            } />
            <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ padding: '4px 16px calc(28px + var(--safe-bottom))' }}>
                {authors.length > 1 && (
                    <div className="flex overflow-x-auto no-scrollbar" style={{ gap: 4, padding: 2, marginBottom: 14, background: F.surfaceSunken, borderRadius: R.medium }}>
                        {[{ id: null as string | null, name: '全部' }, ...authors.map(c => ({ id: c.id as string | null, name: c.name }))].map(item => (
                            <button key={item.id || 'all'} type="button" onClick={() => setFilter(item.id)} className="shrink-0"
                                style={{ height: 32, padding: '0 14px', borderRadius: R.small, border: 'none', fontSize: 14, background: filter === item.id ? F.surface : 'transparent', color: filter === item.id ? F.textPrimary : F.textSecondary, fontWeight: filter === item.id ? 600 : 400 }}>
                                {item.name}
                            </button>
                        ))}
                    </div>
                )}

                {rows && shown.length === 0 && (
                    <div className="flex flex-col items-center text-center" style={{ gap: 14, padding: '72px 12px' }}>
                        <p style={{ margin: 0, fontFamily: FONT.heading, fontSize: 17, color: F.textPrimary }}>还没有番外</p>
                        <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: F.textSecondary }}>刷到喜欢的梗概，贴进来，TA 写一篇你们俩的故事。</p>
                        <button type="button" onClick={() => setView({ kind: 'compose' })} className="active:opacity-80"
                            style={{ height: 46, padding: '0 24px', borderRadius: R.button, border: 'none', background: F.textPrimary, color: F.surface, fontSize: 15, fontWeight: 600 }}>写一篇</button>
                    </div>
                )}

                {shown.length > 0 && (
                    <div className="overflow-hidden" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard }}>
                        {shown.map((row, i) => {
                            const char = charById.get(row.charId);
                            const status = statusText(row);
                            return (
                                <button key={row.id} type="button" onClick={() => setView({ kind: 'read', id: row.id })}
                                    className="w-full flex items-center text-left active:opacity-60 transition-opacity relative"
                                    style={{ gap: 12, padding: '12px 14px', minHeight: 72, background: 'transparent', border: 'none' }}>
                                    {i > 0 && <span aria-hidden className="absolute top-0 right-0" style={{ left: 14, height: 1, background: F.divider }} />}
                                    <span className="shrink-0 overflow-hidden" style={{ width: 40, height: 40, borderRadius: R.pill, background: F.surfaceSunken }}>
                                        {char?.avatar && <TokenImg value={char.avatar} className="w-full h-full object-cover" alt="" />}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block truncate" style={{ fontFamily: FONT.heading, fontSize: 16, fontWeight: 600, color: F.textPrimary }}>{row.title}</span>
                                        <span className="block truncate" style={{ fontSize: 12, lineHeight: '18px', color: F.textTertiary, marginTop: 2 }}>
                                            {[char?.name || '已删除的角色', MEET_EXTRA_MEMORY[row.memory].label, row.body ? `${countExtraChars(row.body)} 字` : MEET_EXTRA_LENGTHS[row.length].label, dateLabel(row.createdAt)].join(' · ')}
                                        </span>
                                    </span>
                                    {status && <span className="shrink-0" style={{ fontSize: 13, color: status.tone === 'bad' ? STATUS.danger.ink : F.textTertiary }}>{status.text}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="flex flex-col items-center" style={{ marginTop: 28 }}>
                    <button type="button" onClick={() => setView({ kind: 'library', back: { kind: 'shelf' } })} className="active:opacity-40 transition-opacity"
                        style={{ minHeight: 44, padding: '0 8px', background: 'transparent', border: 'none', fontSize: 13, color: F.textSecondary }}>
                        文风和基调
                    </button>
                    <button type="button" onClick={onOpenStory} className="active:opacity-40 transition-opacity"
                        style={{ minHeight: 44, padding: '0 8px', background: 'transparent', border: 'none', fontSize: 13, color: F.textTertiary }}>
                        更多玩法：剧情剧场 · 异格
                    </button>
                </div>
            </main>
        </div>
    );
};

export default MeetExtraApp;
// [EM-END: meet-extra]
