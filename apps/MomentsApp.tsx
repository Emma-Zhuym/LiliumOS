// [EM-START: moments]
/**
 * MomentsApp.tsx — 朋友圈
 *
 * 所有人的动态汇在一起：角色的来自查手机里各自的朋友圈，用户可以发文字 + 配图、选谁可以看。
 * 点赞显示人名和数量，评论可以楼中楼回复。角色平时在心跳醒来时刷；「让大家看看」是立刻叫大家来看。
 * 主色 = rose（每屏只用这一个主色，其余全是中性色）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, ChatCircle, Heart, ImageSquare, PaperPlaneRight, Plus, Trash, Users, X, Eye } from '@phosphor-icons/react';
import TokenImg from '../components/os/TokenImg';
import { useOS } from '../context/OSContext';
import { F, FONT, S, R, HUE } from '../utils/clayTokens';
import { processImage } from '../utils/file';
import { resolveCharacterApiConfig } from '../utils/characterApi';
import {
    type MomentActor, type MomentComment, type MomentInteractions, type MomentPost, type UserMomentPost,
    USER, addComment, allComments, applyLookReactions, buildFeed, collectLookItems, emptyInteractions, formatMomentTime, likeCount, sameActor, toggleLike,
} from '../utils/moments';
import { MomentsDB } from '../utils/momentsDb';
import { runCharacterLook } from '../utils/momentsLook';

type Screen = 'feed' | 'compose';

const C = HUE.rose;
const MAX_IMAGES = 9;
const LOOK_KEY = 'lastLookAt';

const IconBtn: React.FC<{ onClick: () => void; children: React.ReactNode; label: string }> = ({ onClick, children, label }) => (
    <button onClick={onClick} aria-label={label} className="flex items-center justify-center active:opacity-40 transition-opacity"
        style={{ width: 44, height: 44, borderRadius: R.pill, background: 'transparent', border: 'none', boxShadow: 'none' }}>
        {children}
    </button>
);

const Avatar: React.FC<{ name: string; src?: string; size: number }> = ({ name, src, size }) => src
    ? <TokenImg value={src} alt={name} style={{ width: size, height: size, borderRadius: R.small, objectFit: 'cover', flexShrink: 0 }} />
    : (
        <div className="flex items-center justify-center shrink-0"
            style={{ width: size, height: size, borderRadius: R.small, background: C.tint, color: C.ink, fontSize: size * 0.4, fontWeight: 700 }}>
            {name.trim()[0] || '?'}
        </div>
    );

const MomentsApp: React.FC = () => {
    const { closeApp, characters, userProfile, apiConfig, apiPresets, addToast } = useOS();
    const [screen, setScreen] = useState<Screen>('feed');
    const [userPosts, setUserPosts] = useState<UserMomentPost[]>([]);
    const [interactions, setInteractions] = useState<Record<string, MomentInteractions>>({});
    const [loading, setLoading] = useState(true);
    const [looking, setLooking] = useState('');

    // 评论输入：对哪条动态、回复谁
    const [commentTarget, setCommentTarget] = useState<{ postId: string; replyTo?: MomentActor } | null>(null);
    const [commentText, setCommentText] = useState('');

    // 发动态
    const [draftText, setDraftText] = useState('');
    const [draftImages, setDraftImages] = useState<string[]>([]);
    const [draftVisible, setDraftVisible] = useState<string[]>([]);
    const fileRef = useRef<HTMLInputElement>(null);

    const userName = userProfile?.name || '我';

    const refresh = useCallback(async () => {
        const [posts, inter] = await Promise.all([MomentsDB.getPosts(), MomentsDB.getInteractions()]);
        setUserPosts(posts);
        setInteractions(Object.fromEntries(inter.map(i => [i.postId, i])));
    }, []);

    useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);

    const feed = useMemo(() => buildFeed(userPosts, characters), [userPosts, characters]);
    const interOf = useCallback((postId: string) => interactions[postId] ?? emptyInteractions(postId), [interactions]);

    const nameOf = (actor: MomentActor) => actor.kind === 'user' ? userName
        : actor.kind === 'npc' ? actor.name
            : characters.find(c => c.id === actor.charId)?.name ?? '已删除的角色';
    const avatarOf = (actor: MomentActor) => actor.kind === 'user' ? userProfile?.avatar
        : actor.kind === 'char' ? characters.find(c => c.id === actor.charId)?.avatar : undefined;

    const saveInter = async (items: MomentInteractions[]) => {
        if (items.length === 0) return;
        await MomentsDB.saveInteractions(items);
        setInteractions(prev => ({ ...prev, ...Object.fromEntries(items.map(i => [i.postId, i])) }));
    };

    const onLike = (postId: string) => saveInter([toggleLike(interOf(postId), USER)]);

    const sendComment = async () => {
        const text = commentText.trim();
        if (!commentTarget || !text) return;
        const now = Date.now();
        const comment: MomentComment = {
            id: `c-user-${now}`, author: USER, text, createdAt: now,
            ...(commentTarget.replyTo ? { replyTo: commentTarget.replyTo } : {}),
        };
        await saveInter([addComment(interOf(commentTarget.postId), comment)]);
        setCommentText('');
        setCommentTarget(null);
    };

    const deletePost = async (postId: string) => {
        await MomentsDB.deletePost(postId);
        await refresh();
    };

    // ── 让大家看看：每个角色刷一遍自己该看的新东西 ──
    const lookNow = async () => {
        if (looking) return;
        const lastLook = (await MomentsDB.getSetting<Record<string, number>>(LOOK_KEY)) ?? {};
        let working = { ...interactions };
        const readInter = (postId: string) => working[postId] ?? emptyInteractions(postId);
        let reacted = 0;
        const nextLook = { ...lastLook };
        for (const char of characters) {
            // 第一次看：只看最近三天的，别把几个月前的旧动态全翻出来
            const since = lastLook[char.id] ?? Date.now() - 3 * 86_400_000;
            const items = collectLookItems(char.id, feed, readInter, since);
            if (items.length === 0) continue;
            setLooking(`${char.name} 在看…`);
            try {
                const api = resolveCharacterApiConfig(char, apiConfig, apiPresets).apiConfig;
                const reactions = await runCharacterLook(char, items, readInter, characters, userName, api);
                const changed = applyLookReactions(char.id, items, reactions, readInter);
                for (const item of changed) working = { ...working, [item.postId]: item };
                await saveInter(changed);
                if (changed.length) reacted += 1;
                nextLook[char.id] = Date.now();
            } catch {
                addToast(`${char.name} 这次没刷成功`, 'error');
            }
        }
        await MomentsDB.saveSetting(LOOK_KEY, nextLook);
        setLooking('');
        addToast(reacted ? `${reacted} 个人来过了` : '暂时没人想回应', reacted ? 'success' : 'info');
    };

    // ── 发动态 ──
    const pickImages = async (files: FileList | null) => {
        if (!files) return;
        const room = MAX_IMAGES - draftImages.length;
        const picked = Array.from(files).slice(0, room);
        try {
            // 压小一点：角色识图时整张图要发给模型
            const urls = await Promise.all(picked.map(f => processImage(f, { maxWidth: 1024, quality: 0.72, forceJpeg: true })));
            setDraftImages(prev => [...prev, ...urls]);
        } catch {
            addToast('图片读取失败', 'error');
        }
    };

    const publish = async () => {
        if (!draftText.trim() && draftImages.length === 0) return;
        const post: UserMomentPost = {
            id: `u-${Date.now()}`,
            text: draftText.trim(),
            images: draftImages,
            createdAt: Date.now(),
            ...(draftVisible.length ? { visibleTo: draftVisible } : {}),
        };
        await MomentsDB.savePost(post);
        setDraftText(''); setDraftImages([]); setDraftVisible([]);
        await refresh();
        setScreen('feed');
    };

    // ── 渲染 ──
    const renderPost = (post: MomentPost) => {
        const inter = interOf(post.id);
        const comments = allComments(post, inter);
        const likes = likeCount(post, inter);
        const liked = inter.likes.some(l => sameActor(l, USER));
        const isMine = post.author.kind === 'user';
        const commenting = commentTarget?.postId === post.id;
        return (
            <div key={post.id} className="flex gap-3" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: 16, boxShadow: S.raisedSoft }}>
                <Avatar name={nameOf(post.author)} src={avatarOf(post.author)} size={40} />
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{nameOf(post.author)}</div>
                    {post.text && <div style={{ fontSize: 15, color: F.textPrimary, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{post.text}</div>}
                    {post.images.length > 0 && (
                        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${post.images.length === 1 ? 1 : post.images.length === 4 ? 2 : 3}, minmax(0, 1fr))`, maxWidth: post.images.length === 1 ? 220 : undefined }}>
                            {post.images.map((src, i) => (
                                <TokenImg key={i} value={src} alt="" style={{ width: '100%', aspectRatio: post.images.length === 1 ? 'auto' : '1 / 1', objectFit: 'cover', borderRadius: R.tiny }} />
                            ))}
                        </div>
                    )}
                    <div className="flex items-center gap-2" style={{ fontSize: 12, color: F.textTertiary }}>
                        <span>{formatMomentTime(post.createdAt)}</span>
                        {isMine && post.visibleTo?.length ? <span className="inline-flex items-center gap-1"><Eye size={12} weight="bold" />部分可见</span> : null}
                        {isMine && (
                            <button onClick={() => deletePost(post.id)} aria-label="删除" className="inline-flex items-center" style={{ color: F.textTertiary }}>
                                <Trash size={14} weight="bold" />
                            </button>
                        )}
                        <span className="flex-1" />
                        <button onClick={() => onLike(post.id)} aria-label="点赞" className="inline-flex items-center gap-1 active:scale-90 transition-transform"
                            style={{ height: 30, padding: '0 10px', borderRadius: R.pill, background: liked ? C.tint : F.surfaceSunken, color: liked ? C.main : F.textSecondary }}>
                            <Heart size={16} weight={liked ? 'fill' : 'bold'} />
                        </button>
                        <button onClick={() => { setCommentTarget({ postId: post.id }); setCommentText(''); }} aria-label="评论"
                            className="inline-flex items-center gap-1 active:scale-90 transition-transform"
                            style={{ height: 30, padding: '0 10px', borderRadius: R.pill, background: F.surfaceSunken, color: F.textSecondary }}>
                            <ChatCircle size={16} weight="bold" />
                        </button>
                    </div>

                    {(likes > 0 || comments.length > 0) && (
                        <div className="flex flex-col gap-1.5" style={{ background: F.surfaceSunken, borderRadius: R.small, padding: '8px 10px' }}>
                            {likes > 0 && (
                                <div className="flex items-start gap-1.5" style={{ fontSize: 13, color: C.ink, lineHeight: 1.5 }}>
                                    <Heart size={14} weight="bold" style={{ marginTop: 3, flexShrink: 0 }} />
                                    {/* 真正点过赞的人列名字，亲友那边的虚拟赞只算进总数 */}
                                    <span>{inter.likes.map(nameOf).join('、')}{inter.likes.length ? (likes > inter.likes.length ? ' 等 ' : ' · ') : ''}<span style={{ color: F.textTertiary }}>{likes} 人</span></span>
                                </div>
                            )}
                            {likes > 0 && comments.length > 0 && <div style={{ height: 1, background: F.divider }} />}
                            {comments.map(c => (
                                <button key={c.id} onClick={() => { if (c.author.kind !== 'user') { setCommentTarget({ postId: post.id, replyTo: c.author }); setCommentText(''); } }}
                                    className="text-left" style={{ fontSize: 13, color: F.textPrimary, lineHeight: 1.5 }}>
                                    <span style={{ fontWeight: 600, color: C.ink }}>{nameOf(c.author)}</span>
                                    {c.replyTo && <><span style={{ color: F.textTertiary }}> 回复 </span><span style={{ fontWeight: 600, color: C.ink }}>{nameOf(c.replyTo)}</span></>}
                                    <span>：{c.text}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {commenting && (
                        <div className="flex items-center gap-2">
                            <input autoFocus value={commentText} onChange={e => setCommentText(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendComment(); }}
                                placeholder={commentTarget?.replyTo ? `回复 ${nameOf(commentTarget.replyTo)}` : '评论'}
                                className="flex-1 min-w-0 outline-none"
                                style={{ height: 40, padding: '0 14px', borderRadius: R.input, background: F.surfaceSunken, boxShadow: S.sunken, border: 'none', fontSize: 14, color: F.textPrimary }} />
                            <button onClick={sendComment} aria-label="发送" className="flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                                style={{ width: 40, height: 40, borderRadius: R.pill, background: C.main, boxShadow: S.raisedSoft, color: F.surfaceRaised }}>
                                <PaperPlaneRight size={18} weight="bold" />
                            </button>
                            <button onClick={() => setCommentTarget(null)} aria-label="取消" className="flex items-center justify-center shrink-0"
                                style={{ width: 32, height: 32, color: F.textTertiary }}>
                                <X size={16} weight="bold" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderFeed = () => (
        <>
            <button onClick={lookNow} disabled={!!looking}
                className="flex items-center gap-3 active:scale-[.99] transition-transform text-left shrink-0"
                style={{ padding: '12px 16px', borderRadius: R.smallCard, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, opacity: looking ? 0.7 : 1 }}>
                <div className="flex items-center justify-center shrink-0" style={{ width: 36, height: 36, borderRadius: R.small, background: C.tint }}>
                    <Users size={20} weight="bold" color={C.ink} />
                </div>
                <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary }}>{looking || '让大家现在就来看看'}</div>
                    <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 1 }}>平时 TA 们醒来时才刷；点这里每个有新东西要看的角色调一次模型</div>
                </div>
            </button>
            {feed.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3" style={{ padding: '60px 0', borderRadius: R.smallCard, background: F.surfaceSunken, boxShadow: S.sunken }}>
                    <ImageSquare size={24} weight="bold" color={F.textTertiary} />
                    <span style={{ fontSize: 14, color: F.textTertiary }}>还没有人发动态</span>
                </div>
            ) : feed.map(renderPost)}
        </>
    );

    const renderCompose = () => (
        <>
            <textarea value={draftText} onChange={e => setDraftText(e.target.value)} placeholder="这一刻的想法…"
                className="w-full outline-none resize-none shrink-0"
                style={{ minHeight: 120, padding: 16, borderRadius: R.input, background: F.surfaceSunken, boxShadow: S.sunken, border: 'none', fontSize: 15, lineHeight: 1.55, color: F.textPrimary, fontFamily: 'inherit' }} />
            <div className="grid grid-cols-3 gap-2 shrink-0">
                {draftImages.map((src, i) => (
                    <div key={i} className="relative" style={{ aspectRatio: '1 / 1' }}>
                        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: R.small }} />
                        <button onClick={() => setDraftImages(prev => prev.filter((_, j) => j !== i))} aria-label="移除图片"
                            className="absolute flex items-center justify-center" style={{ top: 4, right: 4, width: 24, height: 24, borderRadius: R.pill, background: F.surfaceRaised, boxShadow: S.raisedSoft, color: F.textSecondary }}>
                            <X size={12} weight="bold" />
                        </button>
                    </div>
                ))}
                {draftImages.length < MAX_IMAGES && (
                    <button onClick={() => fileRef.current?.click()} className="flex items-center justify-center active:scale-95 transition-transform"
                        style={{ aspectRatio: '1 / 1', borderRadius: R.small, background: F.surfaceSunken, boxShadow: S.sunken, color: F.textTertiary }}>
                        <Plus size={24} weight="bold" />
                    </button>
                )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { void pickImages(e.target.files); e.target.value = ''; }} />

            <div style={{ fontSize: 13, fontWeight: 600, color: F.textSecondary, paddingLeft: 4 }}>谁可以看</div>
            <div style={{ fontSize: 12, color: F.textTertiary, paddingLeft: 4, marginTop: -8 }}>
                {draftVisible.length ? `只有选中的 ${draftVisible.length} 位能看到` : '不选就是所有人可见'}
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
                {characters.map(c => {
                    const on = draftVisible.includes(c.id);
                    return (
                        <button key={c.id} onClick={() => setDraftVisible(prev => on ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                            className="inline-flex items-center gap-1.5 transition-all"
                            style={{ height: 34, padding: '0 12px 0 4px', borderRadius: R.pill, fontSize: 13, fontWeight: 600,
                                background: on ? C.tint : F.surface, color: on ? C.ink : F.textSecondary, border: `1px solid ${on ? C.soft : F.borderSoft}` }}>
                            <Avatar name={c.name} src={c.avatar} size={26} />
                            {c.name}
                        </button>
                    );
                })}
            </div>
        </>
    );

    if (loading) {
        return <div className="h-full flex items-center justify-center" style={{ background: F.appBg, fontSize: 14, color: F.textTertiary }}>加载中...</div>;
    }

    const top = screen === 'feed'
        ? { title: '朋友圈', onBack: closeApp, right: <IconBtn onClick={() => setScreen('compose')} label="发动态"><Plus size={21} weight="bold" color={F.textPrimary} /></IconBtn> }
        : { title: '发动态', onBack: () => setScreen('feed'), right: null };

    return (
        <div className="h-full flex flex-col" style={{ background: F.appBg }}>
            <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
                <div className="relative flex items-center justify-between py-3" style={{ minHeight: 44, padding: '0 20px' }}>
                    <IconBtn onClick={top.onBack} label="返回"><CaretLeft size={22} weight="bold" color={F.textPrimary} /></IconBtn>
                    <span className="absolute left-0 right-0 flex justify-center pointer-events-none" style={{ ...FONT.navTitle, fontFamily: FONT.heading, color: F.textPrimary }}>{top.title}</span>
                    {top.right || <div style={{ width: 44 }} />}
                </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3.5"
                style={{ padding: '8px 20px 16px', WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain', touchAction: 'pan-y' }}>
                {screen === 'feed' ? renderFeed() : renderCompose()}
            </div>
            {screen === 'compose' && (
                <div className="shrink-0" style={{ padding: '0 20px', paddingBottom: 'calc(18px + var(--safe-bottom))' }}>
                    <button onClick={publish} disabled={!draftText.trim() && draftImages.length === 0}
                        className="w-full flex items-center justify-center active:translate-y-[1px] transition-transform"
                        style={{ height: 52, borderRadius: R.button, background: C.main, color: F.surfaceRaised, fontSize: 16, fontWeight: 600, boxShadow: S.raisedMedium, opacity: !draftText.trim() && draftImages.length === 0 ? 0.5 : 1 }}>
                        发表
                    </button>
                </div>
            )}
        </div>
    );
};

export default MomentsApp;
// [EM-END: moments]
