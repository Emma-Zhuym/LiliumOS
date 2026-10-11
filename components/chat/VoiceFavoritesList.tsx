// [EM-START: text-voice-favorites]
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Pause, Play, Trash, Waveform } from '@phosphor-icons/react';
import { F, HUE, R, S, STATUS } from '../../utils/clayTokens';
import { normalizeChatSearchText } from '../../utils/chatMessageSearch';
import { VOICE_FAVORITES_CHANGED_EVENT, getVoiceFavoriteBlob, listVoiceFavorites, removeVoiceFavoriteById, voiceFavoriteSourceLabel, type VoiceFavorite, type VoiceFavoriteSource } from '../../utils/voiceFavorites';

const PAGE_SIZE = 10;
const filters = [{ value: 'all', label: '全部' }, { value: 'chat', label: '聊天' }, { value: 'call', label: '通话' }, { value: 'date', label: '见面' }] as const;
const time = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const roundButton: React.CSSProperties = { width: 44, height: 44, borderRadius: R.pill, background: 'transparent', border: 'none', boxShadow: 'none', color: F.textPrimary };

/** This reader only plays saved attachments. Text-only entries never synthesize audio. */
export default function VoiceFavoritesList({ query }: { query: string }) {
    const [items, setItems] = useState<VoiceFavorite[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | VoiceFavoriteSource>('all');
    const [page, setPage] = useState(0);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const audio = useRef<HTMLAudioElement | null>(null);
    const audioUrl = useRef<string | null>(null);
    const playbackVersion = useRef(0);
    const removeLock = useRef(false);
    const mounted = useRef(true);

    const stop = useCallback(() => {
        playbackVersion.current++;
        audio.current?.pause();
        audio.current = null;
        if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
        audioUrl.current = null;
        if (mounted.current) setPlayingId(null);
    }, []);
    const refresh = useCallback(async () => {
        try {
            const next = await listVoiceFavorites();
            if (mounted.current) { setItems(next); setError(''); }
        } catch (cause) {
            if (mounted.current) setError(cause instanceof Error ? cause.message : '语音收藏读取失败，请重试');
        } finally { if (mounted.current) setLoading(false); }
    }, []);
    useEffect(() => {
        mounted.current = true;
        void refresh();
        window.addEventListener(VOICE_FAVORITES_CHANGED_EVENT, refresh);
        return () => { mounted.current = false; stop(); window.removeEventListener(VOICE_FAVORITES_CHANGED_EVENT, refresh); };
    }, [refresh, stop]);
    const normalizedQuery = normalizeChatSearchText(query);
    const filtered = useMemo(() => items.filter(item => (filter === 'all' || item.source === filter)
        && (!normalizedQuery || normalizeChatSearchText([item.charName, item.speakerName, item.originalText, item.spokenText, item.translation].join('\n')).includes(normalizedQuery))), [items, filter, normalizedQuery]);
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    useEffect(() => { setPage(0); stop(); }, [filter, normalizedQuery, stop]);
    useEffect(() => { setPage(current => Math.min(current, pageCount - 1)); }, [pageCount]);
    useEffect(() => { stop(); }, [page, stop]);

    const play = async (item: VoiceFavorite) => {
        if (item.audioState !== 'stored') return;
        const wasPlaying = playingId === item.id;
        stop();
        if (wasPlaying) return;
        const version = playbackVersion.current;
        const blob = await getVoiceFavoriteBlob(item.id);
        if (!mounted.current || version !== playbackVersion.current) return;
        if (!blob?.size) { setError('音频不可用，收藏的文字仍已保存。'); return; }
        setError('');
        const url = URL.createObjectURL(blob);
        audioUrl.current = url;
        const player = new Audio(url);
        audio.current = player;
        setPlayingId(item.id);
        player.onended = () => { if (audio.current === player) stop(); };
        player.onerror = () => { if (audio.current === player) { stop(); setError('这份音频无法播放，文字仍可阅读。'); } };
        try { await player.play(); }
        catch { if (mounted.current && audio.current === player) { stop(); setError('音频播放失败，文字仍可阅读。'); } }
    };
    const remove = async (item: VoiceFavorite) => {
        if (removeLock.current) return;
        removeLock.current = true; setBusyId(item.id);
        stop(); // Also invalidates an attachment read which has not started playback yet.
        try { await removeVoiceFavoriteById(item.id); await refresh(); }
        catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '取消收藏失败，请重试'); }
        finally { removeLock.current = false; if (mounted.current) setBusyId(null); }
    };
    return <div className="py-4" style={{ color: F.textPrimary }}>
        <div className="grid grid-cols-4 gap-1 p-1" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken }}>
            {filters.map(option => <button key={option.value} type="button" onClick={() => setFilter(option.value)} aria-pressed={filter === option.value}
                className="min-h-11 text-xs font-medium" style={{ borderRadius: R.input, color: filter === option.value ? HUE.violet.ink : F.textTertiary, background: filter === option.value ? F.surfaceRaised : 'transparent', boxShadow: filter === option.value ? S.raisedSoft : 'none' }}>{option.label}</button>)}
        </div>
        <p className="my-3 text-xs" style={{ color: F.textTertiary }}>共 {filtered.length} 条 · 文字语音不需要语音 API</p>
        {error && <div role="alert" className="mb-3 p-3 text-xs" style={{ background: STATUS.warning.tint, color: STATUS.warning.ink, borderRadius: R.input }}>{error}<button type="button" className="ml-2 underline" onClick={() => void refresh()}>重新读取</button></div>}
        {loading ? <p role="status" className="p-6 text-center text-sm">正在读取语音收藏…</p> : !filtered.length ? <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6" style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, color: F.textTertiary }}>
            <Waveform size={18} weight="bold" /><p className="text-sm">{query.trim() ? '没有找到匹配的语音收藏' : '还没有语音收藏'}</p><p className="text-xs">在聊天语音条的消息菜单中选择“收藏语音”</p>
        </div> : <div className="overflow-hidden px-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
            {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item, index) => <article key={item.id} className="py-4" style={{ borderTop: index ? `1px solid ${F.divider}` : undefined }}>
                <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.speakerName || item.charName}{item.speakerRole === 'user' ? ' · 你' : ''}</p><p className="mt-1 text-xs" style={{ color: F.textTertiary }}>{voiceFavoriteSourceLabel(item.source)} · {item.charName}</p><time className="text-xs" style={{ color: F.textTertiary }}>{time.format(item.sourceTimestamp)}</time></div>
                    <button type="button" aria-label={`取消语音收藏：${item.speakerName || item.charName}`} disabled={!!busyId} onClick={() => void remove(item)} className="grid shrink-0 place-items-center disabled:opacity-50" style={roundButton}><Trash size={18} weight="bold" /></button>
                </div>
                <div className="mt-3 p-3" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken }}>
                    {item.spokenText && item.spokenText !== item.originalText && <p className="mb-2 whitespace-pre-wrap break-words text-sm leading-6">{item.spokenText}</p>}
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">{item.originalText || item.translation || '仅音频收藏'}</p>
                    {item.translation && item.translation !== item.originalText && item.translation !== item.spokenText && <p className="mt-2 whitespace-pre-wrap text-sm leading-6" style={{ color: F.textSecondary }}>{item.translation}</p>}
                </div>
                <div className="mt-3 flex min-h-11 items-center gap-3">
                    {item.audioState === 'stored' && <button type="button" aria-label={`${playingId === item.id ? '暂停' : '播放'}收藏音频`} onClick={() => void play(item)} className="grid shrink-0 place-items-center" style={roundButton}>{playingId === item.id ? <Pause size={18} weight="bold" /> : <Play size={18} weight="bold" />}</button>}
                    <span className="text-xs" style={{ color: F.textTertiary }}>{item.audioState === 'none' ? '文字语音' : item.audioState === 'omitted' ? '文字已保留 · 文字备份未包含音频' : '已保存音频附件'}</span>
                </div>
            </article>)}
        </div>}
        {pageCount > 1 && <div className="mt-4 flex items-center justify-center gap-4"><button type="button" aria-label="上一页语音收藏" disabled={!page} onClick={() => setPage(page - 1)} className="grid place-items-center disabled:opacity-40" style={roundButton}><CaretLeft size={20} weight="bold" /></button><span className="text-xs">{page + 1} / {pageCount}</span><button type="button" aria-label="下一页语音收藏" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} className="grid place-items-center disabled:opacity-40" style={roundButton}><CaretRight size={20} weight="bold" /></button></div>}
    </div>;
}
// [EM-END: text-voice-favorites]
