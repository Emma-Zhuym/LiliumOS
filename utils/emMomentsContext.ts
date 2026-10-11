// [EM-START: moments-chat-context]
/**
 * 聊天里的 TA 看得到最近的朋友圈。
 *
 * 朋友圈原来跟聊天完全隔开：阿萌刚发了动态、TA 刚在底下评论过，或者 TA 自己心跳里
 * 发了一条，聊天时一概不知道——「看到我朋友圈了吗」接不上，自己发过什么也说不出。
 * 这里只带跟 TA 有关的两类：阿萌发的（TA 看得到的）和 TA 自己发的，最近 48 小时，最多 5 条。
 */

import type { CharacterProfile } from '../types';
import {
    addComment, addLike, allComments, buildFeed, canSee, charActor, emptyInteractions, formatMomentTime, sameActor,
    type MomentActor, type MomentInteractions, type MomentPost, type UserMomentPost,
} from './moments';
import { MomentsDB } from './momentsDb';

export const MOMENTS_CHAT_WINDOW_MS = 48 * 60 * 60_000;
/** 读朋友圈库最多等多久。聊天提示词在等它：库被挡住（别的标签页在升级）时宁可不带，也不能卡住回复。 */
const READ_TIMEOUT_MS = 1500;

const readMomentsDb = (): Promise<[UserMomentPost[], MomentInteractions[]]> => {
    if (typeof indexedDB === 'undefined') return Promise.resolve([[], []]);
    return Promise.race([
        Promise.all([MomentsDB.getPosts(), MomentsDB.getInteractions()]),
        new Promise<[UserMomentPost[], MomentInteractions[]]>((_, reject) => {
            setTimeout(() => reject(new Error('朋友圈库读取超时')), READ_TIMEOUT_MS);
        }),
    ]);
};
const MAX_POSTS = 5;
const MAX_COMMENTS = 6;

/** 跟这个角色有关、最近的那几条：阿萌发的（TA 能看）+ TA 自己发的。 */
export const relevantMoments = (feed: MomentPost[], charId: string, now = Date.now()): MomentPost[] =>
    feed
        .filter(post => now - post.createdAt <= MOMENTS_CHAT_WINDOW_MS && post.createdAt <= now)
        .filter(post => (post.author.kind === 'user' && canSee(post, charId))
            || (post.author.kind === 'char' && post.author.charId === charId))
        .slice(0, MAX_POSTS);

export const formatMomentsForChat = (
    posts: MomentPost[],
    interactionsOf: (postId: string) => MomentInteractions,
    charId: string,
    userName: string,
    charNameOf: (charId: string) => string,
    now = Date.now(),
): string => {
    if (!posts.length) return '';
    const who = (actor: MomentActor) => actor.kind === 'user' ? userName
        : actor.kind === 'npc' ? actor.name
            : actor.charId === charId ? '你' : charNameOf(actor.charId);
    const blocks = posts.map(post => {
        const inter = interactionsOf(post.id);
        const mine = post.author.kind === 'char';
        const pics = post.images.length ? `［配图 ${post.images.length} 张］` : '';
        const liked = inter.likes.some(l => l.kind === 'char' && l.charId === charId);
        const likes = inter.likes.length + post.virtualLikes;
        const comments = allComments(post, inter).slice(-MAX_COMMENTS)
            .map(c => `    ${who(c.author)}${c.replyTo ? ` 回复 ${who(c.replyTo)}` : ''}：${c.text}`);
        return `- ${formatMomentTime(post.createdAt, now)} ${mine ? '你发了' : `${userName}发了`}：「${post.text.slice(0, 200)}」${pics}`
            + (liked ? '（你点了赞）' : '')
            + (mine && likes ? `（${likes} 个赞）` : '')
            + (comments.length ? `\n${comments.join('\n')}` : '');
    });
    return '\n### 最近的朋友圈\n'
        + `这些是你们俩最近在朋友圈里发的、以及底下的评论，你都看过。聊天里提到时自然接上，不必主动逐条复述；`
        + `你在朋友圈里说过的话要和聊天对得上。\n${blocks.join('\n')}\n`;
};

/**
 * 朋友圈的内存副本。聊天发消息那一刻不去读 IndexedDB（跟起居注同一个理由：不能让回复等它），
 * 由打开 App / 回到前台、朋友圈 App 刷新、心跳反应落库这几处顺手刷新。图片只留张数。
 */
let cache: {
    userPosts: UserMomentPost[];
    byId: Map<string, MomentInteractions>;
    names: Map<string, string>;
} | null = null;

export const refreshMomentsCache = async (characters?: Pick<CharacterProfile, 'id' | 'name'>[]): Promise<void> => {
    try {
        const [userPosts, interactions] = await readMomentsDb();
        cache = {
            userPosts: userPosts.map(post => ({ ...post, images: post.images.map(() => '') })),
            byId: new Map(interactions.map(item => [item.postId, item])),
            names: characters ? new Map(characters.map(c => [c.id, c.name])) : cache?.names ?? new Map(),
        };
    } catch {
        // 读不到就用上次那份
    }
};

/** 测试用 */
export const resetMomentsCacheForTest = () => { cache = null; };

/** 聊天提示词用：读内存副本，拼出上面那段。还没加载过就是空串。 */
export const buildMomentsChatInjection = (
    char: CharacterProfile,
    userName: string,
    now = Date.now(),
): string => {
    const posts = relevantMoments(buildFeed(cache?.userPosts ?? [], [char]), char.id, now);
    if (!posts.length) return '';
    const interOf = (postId: string) => cache?.byId.get(postId) ?? emptyInteractions(postId);
    return formatMomentsForChat(posts, interOf, char.id, userName, id => cache?.names.get(id) ?? '一位朋友', now);
};
// [EM-END: moments-chat-context]

// [EM-START: moments-heartbeat]
/** 快照里带给心跳的阿萌动态：48 小时内、TA 看得到、TA 还没点赞也没评论过的，最多 5 条，只带文字。 */
export interface SnapshotUserMoment {
    id: string;
    text: string;
    at: string;
    images: number;
    comments: { who: string; text: string }[];
}

export const pickUserMomentsForSnapshot = (
    userPosts: UserMomentPost[],
    interactionsOf: (postId: string) => MomentInteractions,
    charId: string,
    userName: string,
    now = Date.now(),
): SnapshotUserMoment[] => {
    const me = charActor(charId);
    return relevantMoments(buildFeed(userPosts, []), charId, now)
        .filter(post => {
            const inter = interactionsOf(post.id);
            return !inter.likes.some(l => sameActor(l, me)) && !inter.comments.some(c => sameActor(c.author, me));
        })
        .map(post => ({
            id: post.id,
            text: post.text.slice(0, 500),
            at: new Date(post.createdAt).toISOString(),
            images: post.images.length,
            // 别的角色的评论只写「一位朋友」：快照不去读角色表
            comments: allComments(post, interactionsOf(post.id)).slice(-5).map(c => ({
                who: c.author.kind === 'user' ? userName : c.author.kind === 'npc' ? c.author.name : '一位朋友',
                text: c.text.slice(0, 200),
            })),
        }));
};

export const loadUserMomentsForSnapshot = async (charId: string, userName: string, now = Date.now()) => {
    const [userPosts, interactions] = await readMomentsDb();
    const byId = new Map(interactions.map(item => [item.postId, item]));
    return pickUserMomentsForSnapshot(userPosts, id => byId.get(id) ?? emptyInteractions(id), charId, userName, now);
};

/**
 * 把心跳送回来的反应写进朋友圈。幂等：评论 id 用信箱 messageId + 动态 id 拼，重取一遍不会多一条；
 * 动态已经被删了就跳过。
 */
export const applyHeartbeatMomentReactions = async (
    charId: string,
    messageId: string,
    raw: unknown,
    at: number,
): Promise<number> => {
    const reactions = (Array.isArray(raw) ? raw : []).flatMap(item => {
        const r = item as { postId?: unknown; like?: unknown; comment?: unknown };
        if (typeof r?.postId !== 'string') return [];
        const comment = typeof r.comment === 'string' ? r.comment.trim().slice(0, 200) : '';
        return r.like === true || comment ? [{ postId: r.postId, like: r.like === true, comment }] : [];
    });
    if (!reactions.length) return 0;
    const [posts, interactions] = await Promise.all([MomentsDB.getPosts(), MomentsDB.getInteractions()]);
    const exists = new Set(posts.map(post => post.id));
    const byId = new Map(interactions.map(item => [item.postId, item]));
    const me = charActor(charId);
    const changed = reactions.filter(r => exists.has(r.postId)).map((r, index) => {
        let next = byId.get(r.postId) ?? emptyInteractions(r.postId);
        if (r.like) next = addLike(next, me);
        if (r.comment) {
            next = addComment(next, { id: `c-${charId}-${messageId}-${r.postId}`, author: me, text: r.comment, createdAt: at + index });
        }
        return next;
    });
    if (changed.length) {
        await MomentsDB.saveInteractions(changed);
        void refreshMomentsCache();
    }
    return changed.length;
};
// [EM-END: moments-heartbeat]
