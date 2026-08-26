import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft, ChatCircleDots, Image, Star, Trash, X } from '@phosphor-icons/react';
import {
    CONTENT_FAVORITES_CHANGED_EVENT,
    listContentFavorites,
    removeUserContentFavoriteById,
    resolveContentFavorite,
    type ContentFavorite,
    type ResolvedContentFavorite,
} from '../../utils/contentFavorites';
import TokenImg from '../os/TokenImg';

type FavoriteTab = 'chat' | 'image';

interface FavoritesPortalProps {
    onClose: () => void;
    onJumpToMessage?: (charId: string, messageId: number) => void;
}

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

const messageTypeLabel = (type?: string): string => ({
    text: '文字',
    emoji: '表情',
    transfer: '转账',
    social_card: '动态',
    xhs_card: '小红书',
    music_card: '音乐',
    webpage_card: '网页',
    life_card: '生活记录',
}[type || ''] || '消息');

const FavoritesPortal: React.FC<FavoritesPortalProps> = ({ onClose, onJumpToMessage }) => {
    const [tab, setTab] = useState<FavoriteTab>('chat');
    const [items, setItems] = useState<ContentFavorite[]>([]);
    const [resolved, setResolved] = useState<Record<string, ResolvedContentFavorite>>({});
    const [loading, setLoading] = useState(true);
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            setItems(await listContentFavorites());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        window.addEventListener(CONTENT_FAVORITES_CHANGED_EVENT, refresh);
        return () => window.removeEventListener(CONTENT_FAVORITES_CHANGED_EVENT, refresh);
    }, [refresh]);

    const chatItems = useMemo(() => items.filter(item => item.kind === 'chat'), [items]);
    const imageItems = useMemo(() => items.filter(item => item.kind === 'image'), [items]);
    const visibleItems = tab === 'chat' ? chatItems : imageItems;
    const visibleKey = visibleItems.map(item => item.id).join('|');

    useEffect(() => {
        let cancelled = false;
        Promise.all(visibleItems.map(resolveContentFavorite)).then(results => {
            if (cancelled) return;
            setResolved(previous => {
                const next = { ...previous };
                results.forEach(result => { next[result.favorite.id] = result; });
                return next;
            });
        });
        return () => { cancelled = true; };
    }, [tab, visibleKey]);

    const removeUserFavorite = async (item: ContentFavorite) => {
        await removeUserContentFavoriteById(item.id);
        await refresh();
    };

    const ownerBadges = (item: ContentFavorite) => {
        const userOwned = item.owners.some(owner => owner.kind === 'user');
        const characterOwners = item.owners.filter(owner => owner.kind === 'character');
        return (
            <div className="mt-2 flex flex-wrap gap-1">
                {userOwned && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold text-violet-700">你收藏</span>}
                {characterOwners.map(owner => owner.kind === 'character' && (
                    <span key={owner.charId} className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700">{owner.charName} 收藏</span>
                ))}
            </div>
        );
    };

    const content = (
        <div className="fixed inset-0 z-[1000] flex flex-col bg-[#f7f7fa] text-slate-800">
            <header className="shrink-0 border-b border-slate-900/10 bg-white/90 backdrop-blur-xl" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="flex h-16 items-center gap-3 px-4">
                    <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-slate-100" aria-label="返回">
                        <CaretLeft size={22} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-lg font-bold"><Star size={19} weight="fill" className="text-amber-400" />收藏夹</div>
                        <p className="text-[10px] text-slate-400">图片只保存引用，同一张不会重复占空间</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 px-4">
                    {([
                        { value: 'chat' as const, label: '聊天', count: chatItems.length, icon: <ChatCircleDots size={16} weight="fill" /> },
                        { value: 'image' as const, label: '图片', count: imageItems.length, icon: <Image size={16} weight="fill" /> },
                    ]).map(item => (
                        <button
                            key={item.value}
                            type="button"
                            onClick={() => setTab(item.value)}
                            className={`flex items-center justify-center gap-1.5 border-b-2 py-3 text-xs font-bold transition-colors ${tab === item.value ? 'border-violet-500 text-violet-600' : 'border-transparent text-slate-400'}`}
                        >
                            {item.icon}{item.label}<span className="text-[9px] opacity-60">{item.count}</span>
                        </button>
                    ))}
                </div>
            </header>

            <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(2rem,var(--safe-bottom))]">
                {loading ? (
                    <div className="grid h-48 place-items-center text-xs text-slate-400">正在整理收藏…</div>
                ) : visibleItems.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-300">
                        <Star size={40} weight="light" />
                        <p className="text-sm">这里还没有{tab === 'chat' ? '聊天' : '图片'}收藏</p>
                    </div>
                ) : tab === 'chat' ? (
                    <div>
                        {chatItems.map(item => {
                            const result = resolved[item.id];
                            const message = result && 'message' in result ? result.message : null;
                            const sourceAvailable = !!(result && 'sourceAvailable' in result && result.sourceAvailable);
                            const userOwned = item.owners.some(owner => owner.kind === 'user');
                            return (
                                <article key={item.id} className="flex gap-3 border-b border-slate-900/10 py-4">
                                    <button
                                        type="button"
                                        disabled={!sourceAvailable || !onJumpToMessage}
                                        onClick={() => sourceAvailable && onJumpToMessage?.(item.charId, item.messageId)}
                                        className="min-w-0 flex-1 text-left disabled:cursor-default"
                                    >
                                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                            <span className="font-bold text-slate-700">{item.charName}</span>
                                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-700">{messageTypeLabel(message?.type)}</span>
                                            <time>{timeFormatter.format(new Date(item.sourceTimestamp))}</time>
                                        </div>
                                        <p className="mt-2 line-clamp-5 whitespace-pre-wrap break-words text-[14px] leading-6 text-slate-800">
                                            {message?.content || (result ? '旧版收藏没有可恢复的内容' : '正在读取…')}
                                        </p>
                                        {message && !sourceAvailable && <p className="mt-2 text-[10px] font-bold text-amber-700">原消息已删除 · 收藏副本仍保留</p>}
                                        {ownerBadges(item)}
                                    </button>
                                    {userOwned && (
                                        <button type="button" onClick={() => void removeUserFavorite(item)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 active:bg-rose-50 active:text-rose-500" aria-label="取消我的收藏">
                                            <Trash size={16} />
                                        </button>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-3">
                        {imageItems.map(item => {
                            const result = resolved[item.id];
                            const imageUrl = result && 'imageUrl' in result ? result.imageUrl : null;
                            const reference = result && 'reference' in result ? result.reference : null;
                            const userOwned = item.owners.some(owner => owner.kind === 'user');
                            return (
                                <article key={item.id} className="relative overflow-hidden rounded-2xl border border-slate-900/10 bg-white shadow-sm">
                                    <button type="button" disabled={!imageUrl} onClick={() => imageUrl && setPreviewImage(imageUrl)} className="block aspect-square w-full bg-slate-100 disabled:cursor-default">
                                        {imageUrl ? <TokenImg value={imageUrl} alt="收藏图片" className="h-full w-full object-cover" loading="lazy" /> : <span className="grid h-full place-items-center px-4 text-center text-[11px] leading-5 text-slate-400">{result ? '原图片未随备份恢复' : '正在读取…'}</span>}
                                    </button>
                                    <div className="p-2.5">
                                        <div className="truncate text-[11px] font-bold text-slate-700">{item.charName}</div>
                                        <div className="mt-0.5 text-[9px] text-slate-400">{timeFormatter.format(new Date(item.sourceTimestamp))} · {reference?.source === 'gallery' ? '相册' : reference?.source === 'chat' ? '聊天' : '收藏保留'}</div>
                                        {ownerBadges(item)}
                                    </div>
                                    {userOwned && (
                                        <button type="button" onClick={() => void removeUserFavorite(item)} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur active:bg-rose-500" aria-label="取消我的收藏">
                                            <Trash size={14} />
                                        </button>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                )}
            </main>

            {previewImage && (
                <div className="fixed inset-0 z-[1010] grid place-items-center bg-black/95 p-4" onClick={() => setPreviewImage(null)}>
                    <button type="button" onClick={() => setPreviewImage(null)} className="absolute right-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white" style={{ top: 'max(1rem,var(--safe-top))' }} aria-label="关闭预览"><X size={20} /></button>
                    <TokenImg value={previewImage} alt="收藏图片预览" className="max-h-full max-w-full object-contain" />
                </div>
            )}
        </div>
    );

    return createPortal(content, document.body);
};

export default FavoritesPortal;
