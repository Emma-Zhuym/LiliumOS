// [EM-START: moments]
/**
 * 朋友圈：把所有人的动态汇到一处。
 *
 * - 角色的动态不另存一份，直接读查手机里各自的 `type: 'social'` 记录（心跳发的、查手机刷新的都算），
 *   帖子 id = `rec:<charId>:<recordId>`。删掉查手机里那条，朋友圈里也跟着没了。
 * - 角色动态下 TA 通讯录里亲友（npc）的 3–5 条评论、虚拟点赞数、屏蔽的分组，
 *   和动态本身在同一次生成里写出来，存在记录的 `moment` 字段上。用户可以回复 npc，npc 不再接话，角色能看到。
 * - 用户自己的动态、用户和角色之间的点赞评论存在 momentsDb（本文件只放纯逻辑，方便测试）。
 * - 可见性：用户的动态可以指定「谁可以看」，不选就是公开；角色的动态对所有角色公开。
 * - 角色之间怎么称呼：对方在自己通讯录里（关联了这个真角色）就按通讯录里的关系，否则当网友。
 */

import type { CharacterProfile, PhoneEvidence } from '../types';
import { resolveContactGroup } from './contactGroups';

export type MomentActor =
    | { kind: 'user' }
    | { kind: 'char'; charId: string }
    /** 角色通讯录里的亲友：只在 TA 的动态下评论，不会接着回 */
    | { kind: 'npc'; name: string; relation?: string };

export interface MomentComment {
    id: string;
    author: MomentActor;
    text: string;
    createdAt: number;
    /** 回复谁（楼中楼）：不填就是直接评论动态 */
    replyTo?: MomentActor;
}

export interface MomentInteractions {
    postId: string;
    likes: MomentActor[];
    comments: MomentComment[];
}

export interface UserMomentPost {
    id: string;
    text: string;
    /** 压缩过的 data URL：角色要识图，只能直接带图片内容 */
    images: string[];
    createdAt: number;
    /** 谁可以看：不填 = 公开 */
    visibleTo?: string[];
}

export interface MomentPost {
    id: string;
    author: MomentActor;
    text: string;
    images: string[];
    createdAt: number;
    visibleTo?: string[];
    /** 角色动态：随动态一起生成的亲友评论 */
    npcComments: MomentComment[];
    /** 角色动态：亲友那边的点赞数（虚拟），显示时加在真实点赞人数上 */
    virtualLikes: number;
    /** 角色动态：TA 选择不给看的通讯录分组 */
    hiddenGroups: string[];
}

export const USER: MomentActor = { kind: 'user' };
export const charActor = (charId: string): MomentActor => ({ kind: 'char', charId });

export const sameActor = (a: MomentActor, b: MomentActor): boolean => {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'char') return a.charId === (b as { charId: string }).charId;
    if (a.kind === 'npc') return a.name === (b as { name: string }).name;
    return true;
};

export const recordPostId = (charId: string, recordId: string) => `rec:${charId}:${recordId}`;

const MOMENT_GROUPS = new Set(['family', 'friend', 'work', 'school', 'service', 'online', 'other']);

/**
 * 模型写的 moment 附带信息（查手机刷新和心跳共用）：
 * { comments: [{ who, relation, text }], likes, hide: ['family'] }。坏掉的字段直接丢。
 */
export const normalizeMomentExtras = (raw: unknown): NonNullable<PhoneEvidence['moment']> | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const comments = (Array.isArray(r.comments) ? r.comments : [])
        .map(c => c as Record<string, unknown>)
        .map(c => ({
            who: String(c?.who ?? c?.name ?? '').trim().slice(0, 24),
            relation: String(c?.relation ?? '').trim().slice(0, 12),
            text: String(c?.text ?? c?.content ?? '').trim().slice(0, 200),
        }))
        .filter(c => c.who && c.text)
        .slice(0, 5)
        .map(c => ({ who: c.who, text: c.text, ...(c.relation ? { relation: c.relation } : {}) }));
    const likes = Number(r.likes);
    const hide = [...new Set((Array.isArray(r.hide) ? r.hide : []).map(String).filter(g => MOMENT_GROUPS.has(g)))];
    const out = {
        ...(comments.length ? { comments } : {}),
        ...(r.likes !== undefined && Number.isFinite(likes) && likes >= 0 ? { likes: Math.min(999, Math.round(likes)) } : {}),
        ...(hide.length ? { hide } : {}),
    };
    return Object.keys(out).length ? out : undefined;
};

/**
 * 生成朋友圈时附带的要求（查手机刷新用；心跳那边有同样意思的一份）：
 * 3–5 条通讯录亲友的评论、虚拟点赞数、可选屏蔽的分组。
 */
export const buildMomentExtrasPrompt = (char: Pick<CharacterProfile, 'phoneState'>) => {
    const circle = (char.phoneState?.contacts ?? [])
        .filter(c => c.kind === 'npc' && c.status === 'friend')
        .slice(0, 20)
        .map(c => `${c.name}${c.identity ? `（${c.identity}）` : ''}[${resolveContactGroup(c)}]`);
    return '每条动态再附上你通讯录里亲友的反应：'
        + 'comments 写 3–5 条评论（who 用下面通讯录里的名字，relation 写 TA 是你的谁，语气贴着各自身份；同事、家人、朋友都可以有）；'
        + 'likes 写一个点赞数（按你的人缘，一般 5–60）；'
        + 'hide 写这条你不想给哪些分组看（family / friend / work / school / online / other，比如不想让家里人看到），被屏蔽分组的人不能出现在评论里，不屏蔽就省略。'
        + (circle.length ? `\n你的通讯录：${circle.join('、')}` : '\n你的通讯录里还没有人：comments 可以留空，只写 likes。');
};

const npcCommentsOf = (char: Pick<CharacterProfile, 'id' | 'phoneState'>, record: PhoneEvidence): MomentComment[] => {
    // 模型偶尔会忘：被屏蔽分组的人不该出现在评论里
    const hidden = new Set(record.moment?.hide ?? []);
    const groupOf = (name: string) => {
        const contact = (char.phoneState?.contacts ?? []).find(c => c.name === name);
        return contact ? resolveContactGroup(contact) : undefined;
    };
    const charId = char.id;
    return (record.moment?.comments ?? []).filter(c => { const g = groupOf(c.who); return !g || !hidden.has(g); }).map((c, i) => ({
        id: `npc-${charId}-${record.id}-${i}`,
        author: { kind: 'npc', name: c.who, ...(c.relation ? { relation: c.relation } : {}) },
        text: c.text,
        // 亲友们陆续来评论：比动态晚几分钟到十几分钟
        createdAt: record.timestamp + (i + 1) * 4 * 60_000,
    }));
};

/** 汇总：用户自己的动态 + 每个角色查手机里的朋友圈，最新的在前。 */
export const buildFeed = (
    userPosts: UserMomentPost[],
    characters: Pick<CharacterProfile, 'id' | 'phoneState'>[],
): MomentPost[] => {
    const fromChars: MomentPost[] = characters.flatMap(char =>
        (char.phoneState?.records ?? [])
            .filter(record => record.type === 'social' && record.detail?.trim())
            .map(record => ({
                id: recordPostId(char.id, record.id),
                author: charActor(char.id),
                text: record.detail.trim(),
                images: record.moment?.images ?? [],
                createdAt: record.timestamp,
                npcComments: npcCommentsOf(char, record),
                virtualLikes: record.moment?.likes ?? 0,
                hiddenGroups: record.moment?.hide ?? [],
            })));
    const mine: MomentPost[] = userPosts.map(post => ({ ...post, author: USER, npcComments: [], virtualLikes: 0, hiddenGroups: [] }));
    return [...mine, ...fromChars].sort((a, b) => b.createdAt - a.createdAt);
};

/** 一条动态下显示的全部评论：随动态生成的亲友评论 + 之后大家的评论，按时间排。 */
export const allComments = (post: MomentPost, inter: MomentInteractions): MomentComment[] =>
    [...post.npcComments, ...inter.comments].sort((a, b) => a.createdAt - b.createdAt);

/** 点赞总数：真实点赞的人 + 亲友那边的虚拟数。 */
export const likeCount = (post: MomentPost, inter: MomentInteractions) => inter.likes.length + post.virtualLikes;

/** 这个角色能不能看到这条动态。 */
export const canSee = (post: MomentPost, charId: string) =>
    post.author.kind === 'char' || !post.visibleTo?.length || post.visibleTo.includes(charId);

export const emptyInteractions = (postId: string): MomentInteractions => ({ postId, likes: [], comments: [] });

export const toggleLike = (current: MomentInteractions, actor: MomentActor): MomentInteractions => ({
    ...current,
    likes: current.likes.some(like => sameActor(like, actor))
        ? current.likes.filter(like => !sameActor(like, actor))
        : [...current.likes, actor],
});

export const addLike = (current: MomentInteractions, actor: MomentActor): MomentInteractions =>
    current.likes.some(like => sameActor(like, actor)) ? current : { ...current, likes: [...current.likes, actor] };

export const addComment = (current: MomentInteractions, comment: MomentComment): MomentInteractions =>
    current.comments.some(c => c.id === comment.id) ? current : { ...current, comments: [...current.comments, comment] };

/** 朋友圈 / 查手机里的时间：今天 14:30、昨天 14:30、9月24日 14:30，跨年带年份。 */
export const formatMomentTime = (ts: number, now = Date.now()) => {
    const d = new Date(ts);
    const today = new Date(now);
    const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
    if (days === 0) return `今天 ${hm}`;
    if (days === 1) return `昨天 ${hm}`;
    if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
};

/** viewer 眼里的 author 是谁：通讯录里关联了这个真角色就按关系叫，否则是网友。 */
export const relationOf = (
    viewer: Pick<CharacterProfile, 'id' | 'phoneState'>,
    author: MomentActor,
    characters: Pick<CharacterProfile, 'id' | 'name'>[],
): string => {
    if (author.kind === 'user') return '';
    if (author.kind === 'npc') return author.relation ?? '';
    if (author.charId === viewer.id) return '你自己';
    const target = characters.find(c => c.id === author.charId);
    const contact = (viewer.phoneState?.contacts ?? []).find(c =>
        c.status !== 'deleted' && c.status !== 'blocked'
        && (c.linkedCharId === author.charId || (!!target && c.kind === 'real' && c.name === target.name)));
    return contact ? (contact.identity?.trim() || '通讯录里的朋友') : '网友';
};

// ── 「让大家看看」：角色刷一遍朋友圈里的新东西 ──

export interface LookItem {
    /** 提示词里的编号，模型按这个回 */
    ref: string;
    post: MomentPost;
    /** 为什么把它给这个角色看：新动态 / 自己动态下有人评论了 / 自己在别人动态下的评论被人回了 */
    why: 'new_post' | 'comment_on_mine' | 'reply_to_me';
    /** comment_on_mine / reply_to_me 时：需要回的那几条评论 */
    comments: MomentComment[];
}

/** 这个角色这次该看的：上次看过之后的新动态（不含自己的）、自己动态下的新评论、别人回复自己的评论。 */
export const collectLookItems = (
    charId: string,
    feed: MomentPost[],
    interactionsOf: (postId: string) => MomentInteractions,
    since: number,
    limit = 8,
): LookItem[] => {
    const me = charActor(charId);
    const items: Omit<LookItem, 'ref'>[] = [];
    for (const post of feed) {
        if (!canSee(post, charId)) continue;
        const inter = interactionsOf(post.id);
        if (post.author.kind === 'char' && post.author.charId === charId) {
            // 亲友的评论随动态生成、不在这里；要回的是用户（包括用户回复亲友的那几句）和其他角色
            const incoming = inter.comments.filter(c => c.createdAt > since && !sameActor(c.author, me));
            if (incoming.length) items.push({ post, why: 'comment_on_mine', comments: incoming });
            continue;
        }
        const touched = inter.likes.some(l => sameActor(l, me)) || inter.comments.some(c => sameActor(c.author, me));
        if (post.createdAt > since && !touched) { items.push({ post, why: 'new_post', comments: [] }); continue; }
        const replies = inter.comments.filter(c => c.createdAt > since && c.replyTo && sameActor(c.replyTo, me) && !sameActor(c.author, me));
        if (replies.length) items.push({ post, why: 'reply_to_me', comments: replies });
    }
    // 用户的在前：TA 最在意的是对方发了什么
    items.sort((a, b) => Number(b.post.author.kind === 'user') - Number(a.post.author.kind === 'user') || b.post.createdAt - a.post.createdAt);
    return items.slice(0, limit).map((item, i) => ({ ...item, ref: `#${i + 1}` }));
};

export interface LookReaction {
    ref: string;
    like?: boolean;
    comment?: string;
}

/** 模型回的 JSON：{ reactions: [{ ref, like, comment }] }；坏掉的条目直接丢。 */
export const parseLookReactions = (raw: unknown, refs: string[]): LookReaction[] => {
    const list = Array.isArray(raw) ? raw : Array.isArray((raw as { reactions?: unknown })?.reactions) ? (raw as { reactions: unknown[] }).reactions : [];
    const allowed = new Set(refs);
    const seen = new Set<string>();
    return list.flatMap(item => {
        const r = item as Record<string, unknown>;
        const ref = String(r?.ref ?? r?.id ?? '').trim();
        const normalized = ref.startsWith('#') ? ref : `#${ref}`;
        if (!allowed.has(normalized) || seen.has(normalized)) return [];
        seen.add(normalized);
        const comment = typeof r.comment === 'string' ? r.comment.trim().slice(0, 200) : '';
        const like = r.like === true;
        if (!like && !comment) return [];
        return [{ ref: normalized, ...(like ? { like } : {}), ...(comment ? { comment } : {}) }];
    });
};

/** 把一个角色的反应落进互动数据；返回改过的帖子。 */
export const applyLookReactions = (
    charId: string,
    items: LookItem[],
    reactions: LookReaction[],
    interactionsOf: (postId: string) => MomentInteractions,
    now = Date.now(),
): MomentInteractions[] => {
    const me = charActor(charId);
    return reactions.flatMap((reaction, index) => {
        const item = items.find(i => i.ref === reaction.ref);
        if (!item) return [];
        let next = interactionsOf(item.post.id);
        if (reaction.like && item.why === 'new_post') next = addLike(next, me);
        if (reaction.comment) {
            // 在自己动态下说话 = 回最后一个来评论的人；被人回复了 = 回那个人；新动态 = 直接评论
            const replyTo = item.why !== 'new_post' ? item.comments[item.comments.length - 1]?.author : undefined;
            next = addComment(next, {
                id: `c-${charId}-${now}-${index}`,
                author: me,
                text: reaction.comment,
                createdAt: now + index,
                ...(replyTo ? { replyTo } : {}),
            });
        }
        return [next];
    });
};
// [EM-END: moments]
