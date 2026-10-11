/**
 * 心跳刷朋友圈：阿萌发了新动态，TA 醒来时看到，按自己的性子点赞 / 评论。
 *
 * 朋友圈存在手机的 IndexedDB 里，后端看不到库：快照带上阿萌最近发的、TA 还没回应过的
 * 那几条（userMoments，只有文字和配图张数），这里负责「这条看没看过」和「TA 回了什么」。
 * 结果以 job_result（type: moment_reaction）静默送回手机，由前端写进朋友圈的互动数据。
 */

import { getSetting, setSetting } from './db.mjs';

/** 一跳最多看几条：再多就像在补作业了。 */
export const MOMENTS_MAX_PER_BEAT = 3;
/** 每个角色记住最近看过的多少条动态。快照只带 48 小时内的，这个量绰绰有余。 */
const SEEN_MAX = 60;

const seenKey = charId => `moments_seen:${charId}`;

const readSeen = (db, charId) => {
    try {
        const parsed = JSON.parse(getSetting(db, seenKey(charId)) || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
};

/** 快照里 TA 还没看过的阿萌动态（旧的在前），最多 MOMENTS_MAX_PER_BEAT 条。 */
export const unseenMoments = (db, charId, snapshot) => {
    const posts = snapshot?.payload?.userMoments;
    if (!Array.isArray(posts) || posts.length === 0) return [];
    const seen = new Set(readSeen(db, charId));
    return posts
        .filter(post => post && typeof post.id === 'string' && !seen.has(post.id))
        .sort((a, b) => Date.parse(a.at ?? 0) - Date.parse(b.at ?? 0))
        .slice(-MOMENTS_MAX_PER_BEAT);
};

/** 看过了就记下：不管回没回应，下一跳都不再拿出来。 */
export const markMomentsSeen = (db, charId, ids, now = new Date()) => {
    if (!ids.length) return;
    const merged = [...readSeen(db, charId).filter(id => !ids.includes(id)), ...ids].slice(-SEEN_MAX);
    setSetting(db, seenKey(charId), JSON.stringify(merged), now.toISOString());
};

/** 给模型看的那一段。编号从 1 开始，模型只回编号，由程序换回动态 id。 */
export const formatMomentsForPrompt = (posts, { userName = '对方', formatTime = at => at } = {}) =>
    posts.map((post, index) => {
        const pics = post.images ? `（配了 ${post.images} 张图，你看不到图的内容，别编）` : '';
        const comments = Array.isArray(post.comments) && post.comments.length
            ? `\n   已有评论：${post.comments.map(c => `${c.who}：${c.text}`).join('；')}`
            : '';
        return `${index + 1}. ${post.at ? `${formatTime(post.at)} ` : ''}${userName}发了：「${post.text}」${pics}${comments}`;
    }).join('\n');

/** 模型回的 moments：[{ index, like, comment }]。越界、重复、什么都没做的条目丢掉。 */
export const parseMomentReactions = raw => {
    if (!Array.isArray(raw)) return null;
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const index = Number(item?.index);
        if (!Number.isInteger(index) || index < 1 || index > 20 || seen.has(index)) continue;
        seen.add(index);
        const like = item.like === true;
        const comment = typeof item.comment === 'string' ? item.comment.trim().slice(0, 200) : '';
        if (!like && !comment) continue;
        out.push({ index, ...(like ? { like } : {}), ...(comment ? { comment } : {}) });
    }
    return out.length ? out : null;
};

/** 编号换回动态 id；编到列表外的丢掉。 */
export const resolveMomentReactions = (reactions, posts) =>
    (reactions ?? []).flatMap(reaction => {
        const post = posts[reaction.index - 1];
        return post ? [{ postId: post.id, ...(reaction.like ? { like: true } : {}), ...(reaction.comment ? { comment: reaction.comment } : {}) }] : [];
    });
