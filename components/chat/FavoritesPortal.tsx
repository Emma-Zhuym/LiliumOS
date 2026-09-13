import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft, CaretRight, MagnifyingGlass, Star, Trash, X } from '@phosphor-icons/react';
import { CONTENT_FAVORITES_CHANGED_EVENT, listContentFavorites, resolveContentFavorite } from '../../utils/contentFavorites';
import { VOICE_FAVORITES_CHANGED_EVENT, listVoiceFavorites, voiceFavoriteSourceLabel } from '../../utils/voiceFavorites';
import { mergeMessageFavorites, removeMessageFavoriteEntry, type MessageFavoriteEntry } from '../../utils/messageFavorites';
import TokenImg from '../os/TokenImg';
import FavoriteMessageBody from './FavoriteMessageBody';
import { normalizeChatSearchText, searchableChatMessageText } from '../../utils/chatMessageSearch';
import { F, HUE, R, S, STATUS } from '../../utils/clayTokens';

type FavoriteTab = 'all' | MessageFavoriteEntry['kind'];
interface FavoritesPortalProps { onClose: () => void; onJumpToMessage?: (charId: string, messageId: number) => void; }
const tabs = [{ value: 'all', label: '全部' }, { value: 'text', label: '文字' }, { value: 'image', label: '图片' }, { value: 'voice', label: '语音' }, { value: 'html', label: '卡片' }] as const;
const timeFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const roundButton = { width: 44, height: 44, borderRadius: R.pill, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, color: F.textSecondary };
const PAGE_SIZE = 20;

const FavoritesPortal: React.FC<FavoritesPortalProps> = ({ onClose, onJumpToMessage }) => {
    const [tab, setTab] = useState<FavoriteTab>('all');
    const [items, setItems] = useState<MessageFavoriteEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const revision = useRef(0);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [source, setSource] = useState('all');
    const [page, setPage] = useState(0);
    const refresh = useCallback(async () => {
        const version = ++revision.current;
        try {
            const [contents, voices] = await Promise.all([listContentFavorites(), listVoiceFavorites()]);
            const resolved = await Promise.all(contents.map(resolveContentFavorite));
            if (version !== revision.current) return;
            setItems(mergeMessageFavorites(contents, voices, Object.fromEntries(resolved.map(item => [item.favorite.id, item]))));
            setError('');
        } catch (cause) { if (version === revision.current) setError(cause instanceof Error ? cause.message : '收藏读取失败，请重试'); }
        finally { if (version === revision.current) setLoading(false); }
    }, []);
    useEffect(() => {
        void refresh();
        window.addEventListener(CONTENT_FAVORITES_CHANGED_EVENT, refresh);
        window.addEventListener(VOICE_FAVORITES_CHANGED_EVENT, refresh);
        return () => { revision.current++; window.removeEventListener(CONTENT_FAVORITES_CHANGED_EVENT, refresh); window.removeEventListener(VOICE_FAVORITES_CHANGED_EVENT, refresh); };
    }, [refresh]);
    const normalizedQuery = normalizeChatSearchText(searchQuery);
    const visible = useMemo(() => items.filter(item => {
        if (tab !== 'all' && item.kind !== tab) return false;
        if (tab === 'voice' && source !== 'all' && (item.voice?.source || 'chat') !== source) return false;
        return !normalizedQuery || normalizeChatSearchText([item.charName, item.voice?.speakerName, searchableChatMessageText(item.message), item.voice?.originalText, item.voice?.spokenText, item.voice?.translation].join('\n')).includes(normalizedQuery);
    }), [items, tab, source, normalizedQuery]);
    const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    useEffect(() => setPage(0), [tab, source, normalizedQuery]);
    useEffect(() => setPage(current => Math.min(current, pageCount - 1)), [pageCount]);
    const remove = async (entry: MessageFavoriteEntry) => {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(true);
        try { await removeMessageFavoriteEntry(entry); await refresh(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '取消收藏失败，请重试'); }
        finally { busyRef.current = false; setBusy(false); }
    };
    return createPortal(<div className="fixed inset-0 z-[1000] flex flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
        <header className="shrink-0 px-4 pb-3" style={{ paddingTop: 'var(--chrome-top)' }}>
            <div className="relative flex items-center justify-between pb-3">
                <button type="button" onClick={onClose} className="grid place-items-center" style={roundButton} aria-label="返回"><CaretLeft size={20} weight="bold" /></button>
                <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-base font-semibold">收藏夹</h1>
                <button type="button" onClick={() => { setSearchOpen(value => !value); setSearchQuery(''); }} className="grid place-items-center" style={roundButton} aria-label={searchOpen ? '关闭收藏搜索' : '搜索收藏'} aria-pressed={searchOpen}><MagnifyingGlass size={20} weight="bold" /></button>
            </div>
            <div className="grid grid-cols-5 gap-1 p-1" style={{ background: F.surfaceSunken, borderRadius: R.large, boxShadow: S.sunken }}>
                {tabs.map(option => <button key={option.value} type="button" onClick={() => setTab(option.value)} aria-pressed={tab === option.value} className="min-h-11 text-xs font-semibold" style={{ borderRadius: R.button, background: tab === option.value ? F.surface : 'transparent', color: tab === option.value ? F.textPrimary : F.textTertiary, boxShadow: tab === option.value ? S.raisedSoft : undefined }}>{option.label}</button>)}
            </div>
            {tab === 'voice' && <div className="mt-3 grid grid-cols-4 gap-1 p-1" style={{ background: F.surfaceSunken, borderRadius: R.large, boxShadow: S.sunken }}>{[{ id: 'all', name: '全部来源' }, { id: 'chat', name: '聊天' }, { id: 'call', name: '通话' }, { id: 'date', name: '见面' }].map(option => <button key={option.id} onClick={() => setSource(option.id)} aria-pressed={source === option.id} className="min-h-11 text-xs" style={{ borderRadius: R.button, background: source === option.id ? F.surface : 'transparent', boxShadow: source === option.id ? S.raisedSoft : undefined }}>{option.name}</button>)}</div>}
            {searchOpen && <input autoFocus type="search" aria-label="搜索收藏中的关键词" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="搜索角色、消息或语音文字" className="mt-3 min-h-11 w-full px-3 text-sm outline-none" style={{ background: F.surfaceSunken, color: F.textPrimary, borderRadius: R.input, boxShadow: S.sunken }} />}
            <p className="pt-3 text-center text-xs" style={{ color: F.textTertiary }}>{normalizedQuery ? '找到' : '共'} {visible.length} 条 · 收藏保留消息原样</p>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(2rem,var(--safe-bottom))]">
            {error && <div role="alert" className="mb-3 p-4 text-sm" style={{ background: STATUS.warning.tint, color: STATUS.warning.ink, borderRadius: R.smallCard }}>{error}<button onClick={() => void refresh()} className="ml-2 min-h-11 underline">重新读取</button></div>}
            {loading ? <p role="status" className="py-10 text-center text-sm">正在整理收藏…</p> : !visible.length ? <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-5" style={{ background: F.surfaceSunken, color: F.textTertiary, borderRadius: R.bigCard, boxShadow: S.sunken }}><Star size={18} /><p className="text-sm">{normalizedQuery ? '没有找到匹配的收藏' : '这里还没有收藏'}</p></div> : <div className="px-3" style={{ background: F.surface, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
                {visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((entry, index) => {
                    const userOwned = !!entry.voice || entry.content?.owners.some(owner => owner.kind === 'user');
                    return <article key={entry.id} className="min-w-0 py-4" style={{ borderTop: index ? `1px solid ${F.divider}` : undefined }}>
                        <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{entry.voice?.speakerName || entry.charName}{entry.voice?.speakerRole === 'user' ? ' · 你' : ''}</p><p className="mt-1 text-xs" style={{ color: F.textTertiary }}>{timeFormatter.format(entry.timestamp)} · {entry.voice ? voiceFavoriteSourceLabel(entry.voice.source) : tabs.find(item => item.value === entry.kind)?.label}</p></div>
                            {userOwned && <button type="button" disabled={busy} onClick={() => void remove(entry)} className="grid shrink-0 place-items-center disabled:opacity-40" style={roundButton} aria-label="取消收藏"><Trash size={18} /></button>}
                        </div>
                        {entry.kind === 'image' ? entry.imageUrl ? <button type="button" onClick={() => setPreviewImage(entry.imageUrl!)} className="mt-3 block w-full" aria-label="查看收藏图片"><TokenImg value={entry.imageUrl} alt="收藏图片" className="mx-auto max-h-96 max-w-full object-contain" /></button> : <p className="py-5 text-sm" style={{ color: F.textTertiary }}>原图片未随备份恢复</p> : <FavoriteMessageBody entry={entry} />}
                        {entry.content?.owners.filter(owner => owner.kind === 'character').map(owner => owner.kind === 'character' && <span key={owner.charId} className="mr-2 text-xs" style={{ color: HUE.violet.ink }}>{owner.charName} 收藏</span>)}
                        {entry.sourceAvailable && entry.message && onJumpToMessage && <button type="button" onClick={() => onJumpToMessage(entry.charId, entry.message!.id)} className="min-h-11 text-xs" style={{ color: F.textSecondary }}>定位原消息</button>}
                        {entry.content?.kind === 'chat' && !entry.sourceAvailable && entry.message && <p className="text-xs" style={{ color: F.textTertiary }}>原消息已删除 · 收藏副本仍保留</p>}
                    </article>;
                })}
            </div>}
            {pageCount > 1 && <div className="flex items-center justify-center gap-4 pt-4"><button aria-label="上一页收藏" disabled={!page} onClick={() => setPage(page - 1)} className="grid place-items-center disabled:opacity-40" style={roundButton}><CaretLeft size={20} /></button><span className="text-xs">{page + 1}/{pageCount}</span><button aria-label="下一页收藏" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} className="grid place-items-center disabled:opacity-40" style={roundButton}><CaretRight size={20} /></button></div>}
        </main>
        {previewImage && <div className="fixed inset-0 z-[1010] grid place-items-center p-4" style={{ background: F.appBg }} onClick={() => setPreviewImage(null)}><button type="button" onClick={() => setPreviewImage(null)} className="absolute right-4 grid place-items-center" style={{ ...roundButton, top: 'var(--chrome-top)' }} aria-label="关闭预览"><X size={20} /></button><TokenImg value={previewImage} alt="收藏图片预览" className="max-h-full max-w-full object-contain" /></div>}
    </div>, document.body);
};
export default FavoritesPortal;
