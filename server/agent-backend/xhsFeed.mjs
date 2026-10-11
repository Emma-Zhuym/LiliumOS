/**
 * 心跳里「逛小红书」：先由程序去刷一次首页，拿到真实的笔记，再交给模型挑着看、写感想。
 *
 * 跟这个文件夹里的其他东西一个道理——让模型自己决定「要不要刷、刷什么」，它会选最省事的；
 * 让它凭空写「刷到了什么」，它会编。所以刷不刷由抽签定，刷到什么由真实首页定，
 * 模型只负责「这个人看到这些会怎么想」。
 *
 * 只刷首页（list_feeds），不搜索：纯逛。多看了两眼的第一条由程序替 TA 点开（get_feed_detail），
 * 看完正文和评论区再写感想；刷到喜欢的可以点赞、收藏，也可以发给阿萌；
 * 不评论、不发帖——输出类的工具在这里（XHS_BACKEND_TOOLS）和网关（home-assistant-proxy）两头都禁了。
 * 服务是 mini 上常驻的 xiaohongshu-mcp（server/xhs-mcp），本机直连，不绕 Funnel。
 */

/**
 * 心跳只准调这几个。别的工具（发帖、评论、回复、删登录）在本机直连这条路上也叫不动，
 * 不指望提示词拦——提示词拦不住的事就别让它有机会发生。
 */
export const XHS_BACKEND_TOOLS = new Set(['list_feeds', 'get_feed_detail', 'like_feed', 'favorite_feed']);

/** 点开一条时给模型看多少：正文截一段，评论只看前几条（真人也就扫一眼热评）。 */
export const XHS_DETAIL_DESC_CHARS = 600;
export const XHS_DETAIL_COMMENTS = 8;

/** 一跳里点赞 + 收藏最多几次：每次都要打开笔记页，慢，而且点多了像机器人。 */
export const XHS_MAX_ACTIONS = 2;

/** 包一层：只放行白名单里的工具。 */
export const guardXhs = xhs => (xhs
    ? {
        callTool: (name, args, options) => {
            if (!XHS_BACKEND_TOOLS.has(name)) return Promise.reject(new Error(`心跳不允许调用小红书工具 ${name}`));
            return xhs.callTool(name, args, options);
        },
    }
    : null);

/** 首页一次最多给模型看几条：再多模型会敷衍着扫一眼，提示词也白白变长。 */
export const XHS_FEED_LIMIT = 10;
/** 模型最多挑几条「多看了两眼」的。 */
export const XHS_MAX_PICKS = 3;
/**
 * 刷首页要让 mini 上的浏览器真的打开小红书，在国外一次几十秒是常事。
 * 比心跳整体的模型超时短：刷不到就退回别的事，不能把整跳拖死。
 */
export const XHS_FEED_TIMEOUT_MS = 90_000;

const str = (value, limit) => String(value ?? '').trim().slice(0, limit);

/** 「1.2万」「3456」「10万+」→ 数字；认不出就 0。 */
export const parseCount = raw => {
    const text = String(raw ?? '').replace(/[,+\s]/g, '');
    const match = text.match(/^(\d+(?:\.\d+)?)(万|w|k|千)?$/i);
    if (!match) return 0;
    const unit = { 万: 10_000, w: 10_000, W: 10_000, k: 1_000, K: 1_000, 千: 1_000 }[match[2]] ?? 1;
    return Math.round(Number(match[1]) * unit);
};

/** 在结果里找那一串笔记：上游版本不同，包的层数不一样。 */
const findFeedArray = data => {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['feeds', 'items', 'notes', 'data', 'list']) {
        const value = data[key];
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
            const nested = findFeedArray(value);
            if (nested.length) return nested;
        }
    }
    if (Array.isArray(data._value)) return data._value;
    return [];
};

/**
 * 把 list_feeds 的结果整理成干净的笔记列表。
 * 直播卡片、搜索热词这类没有标题或没有 id 的条目一律丢掉；同一篇只留一次。
 */
export const parseFeed = result => {
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const text = blocks.filter(block => block?.type === 'text').map(block => block.text).join('\n').trim();
    if (!text || result?.isError) return [];
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return [];
    }
    const seen = new Set();
    const notes = [];
    for (const item of findFeedArray(data)) {
        if (!item || typeof item !== 'object') continue;
        if (item.modelType && item.modelType !== 'note') continue;
        const card = item.noteCard || item.note_card || item;
        const noteId = str(item.id || item.noteId || item.note_id || card.noteId, 64);
        const title = str(card.displayTitle || card.display_title || card.title, 80);
        if (!noteId || !title || seen.has(noteId)) continue;
        seen.add(noteId);
        const user = card.user || {};
        const cover = card.cover || {};
        const coverUrl = str(cover.urlDefault || cover.url || cover.urlPre, 500);
        notes.push({
            noteId,
            title,
            author: str(user.nickname || user.nickName || user.nick_name || card.author, 40),
            likes: parseCount(card.interactInfo?.likedCount ?? card.interact_info?.liked_count ?? card.likes),
            video: card.type === 'video',
            ...(coverUrl ? { coverUrl } : {}),
            ...(item.xsecToken || item.xsec_token ? { xsecToken: str(item.xsecToken || item.xsec_token, 200) } : {}),
        });
    }
    return notes;
};

/** 刷一次首页。服务没配、没起来、没登录、超时，都返回空数组并带上原因，由调用方退回别的事。 */
export const fetchFeed = async (xhs, { limit = XHS_FEED_LIMIT, timeoutMs = XHS_FEED_TIMEOUT_MS } = {}) => {
    if (!xhs) return { notes: [], error: 'xhs_not_configured' };
    try {
        const result = await guardXhs(xhs).callTool('list_feeds', {}, { timeoutMs });
        const notes = parseFeed(result).slice(0, limit);
        return notes.length ? { notes } : { notes: [], error: 'xhs_empty_feed' };
    } catch (error) {
        return { notes: [], error: String(error?.message || error).slice(0, 200) };
    }
};

/** 在详情结果里找 { note, comments }：上游有时直接给，有时包在 data 里。 */
const findDetail = data => {
    if (!data || typeof data !== 'object') return null;
    if (data.note && typeof data.note === 'object') return data;
    for (const key of ['data', 'detail', 'result']) {
        const nested = findDetail(data[key]);
        if (nested) return nested;
    }
    return null;
};

/** get_feed_detail → 正文 + 前几条评论。读不出正文就当没点开。 */
export const parseDetail = result => {
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const text = blocks.filter(block => block?.type === 'text').map(block => block.text).join('\n').trim();
    if (!text || result?.isError) return null;
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    const found = findDetail(data);
    if (!found) return null;
    const note = found.note;
    const desc = str(note.desc || note.content, XHS_DETAIL_DESC_CHARS);
    const title = str(note.title, 80);
    if (!desc && !title) return null;
    const list = Array.isArray(found.comments?.list) ? found.comments.list : Array.isArray(found.comments) ? found.comments : [];
    const comments = list
        .map(comment => ({
            author: str(comment?.userInfo?.nickname || comment?.userInfo?.nickName || comment?.user?.nickname, 40) || '匿名',
            text: str(comment?.content, 120),
            likes: parseCount(comment?.likeCount ?? comment?.like_count),
        }))
        .filter(comment => comment.text)
        .slice(0, XHS_DETAIL_COMMENTS);
    return {
        ...(title ? { fullTitle: title } : {}),
        desc,
        ...(note.ipLocation ? { location: str(note.ipLocation, 20) } : {}),
        comments,
    };
};

/** 点开一条。没有 xsecToken 打不开笔记页；失败返回原因，调用方就当这一跳没点开。 */
export const fetchDetail = async (xhs, note, { timeoutMs = XHS_FEED_TIMEOUT_MS } = {}) => {
    if (!xhs) return { error: 'xhs_not_configured' };
    if (!note?.xsecToken) return { error: 'xhs_no_token' };
    try {
        const result = await guardXhs(xhs).callTool('get_feed_detail', { feed_id: note.noteId, xsec_token: note.xsecToken }, { timeoutMs });
        const detail = parseDetail(result);
        return detail ? { detail } : { error: 'xhs_detail_unreadable' };
    } catch (error) {
        return { error: String(error?.message || error).slice(0, 200) };
    }
};

/** 点开之后给模型看的那一段。 */
export const formatDetailForPrompt = (index, note, detail) => [
    `你点开了第 ${index} 条「${detail.fullTitle || note.title}」（${note.author || '匿名'}${detail.location ? `，${detail.location}` : ''}）：`,
    detail.desc ? `正文：${detail.desc}` : '正文：（只有图 / 视频，没什么字）',
    detail.comments.length
        ? `评论区：\n${detail.comments.map(comment => `- ${comment.author}：${comment.text}${comment.likes ? `（${comment.likes} 赞）` : ''}`).join('\n')}`
        : '评论区：还没人评论。',
].join('\n');

/** 给模型看的首页：编号 + 标题 + 作者 + 赞数。id 不给模型抄，挑的时候写编号。 */
export const formatFeedForPrompt = notes => notes
    .map((note, index) => `${index + 1}. 「${note.title}」${note.video ? '（视频）' : ''} — ${note.author || '匿名'}，${note.likes} 赞`)
    .join('\n');

/**
 * 模型挑的编号 → 真实笔记。编号越界、重复的丢掉；标题、作者、赞数一律用首页的真值，
 * 模型只留下它自己写的那句「为什么多看了两眼」，以及想不想点赞 / 收藏。
 */
export const resolvePicks = (picks, notes) => {
    const out = [];
    const used = new Set();
    for (const pick of Array.isArray(picks) ? picks : []) {
        const index = Number(pick?.index) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= notes.length || used.has(index)) continue;
        used.add(index);
        const note = str(pick?.note, 120);
        out.push({
            ...notes[index],
            ...(note ? { note } : {}),
            ...(pick?.like === true ? { wantLike: true } : {}),
            ...(pick?.fav === true ? { wantFav: true } : {}),
        });
        if (out.length >= XHS_MAX_PICKS) break;
    }
    return out;
};

/** 想发给阿萌的那一条：编号换回真实笔记，配的那一两句话必须有。 */
export const resolveShare = (share, notes) => {
    const index = Number(share?.index) - 1;
    const text = str(share?.text, 200);
    if (!Number.isInteger(index) || index < 0 || index >= notes.length || !text) return null;
    return { note: notes[index], text };
};

/**
 * 真的去点赞 / 收藏。只点有 xsecToken 的（没有它打不开笔记页），一跳最多 XHS_MAX_ACTIONS 次，
 * 按顺序做、不并发（同时开几个笔记页容易被风控）。失败只记下来，不影响这一跳别的事。
 * 返回新的 picks：做成了的标 liked / faved，想做没做成的标 error。
 */
export const applyXhsActions = async (xhs, picks, { maxActions = XHS_MAX_ACTIONS } = {}) => {
    const guarded = guardXhs(xhs);
    let budget = maxActions;
    const out = [];
    for (const pick of picks) {
        const { wantLike, wantFav, ...rest } = pick;
        const done = { ...rest };
        for (const [want, tool, flag] of [[wantLike, 'like_feed', 'liked'], [wantFav, 'favorite_feed', 'faved']]) {
            if (!want) continue;
            if (!guarded || !pick.xsecToken || budget <= 0) continue;
            budget -= 1;
            try {
                const result = await guarded.callTool(tool, { feed_id: pick.noteId, xsec_token: pick.xsecToken }, { timeoutMs: XHS_FEED_TIMEOUT_MS });
                if (result?.isError) throw new Error('工具返回失败');
                done[flag] = true;
            } catch (error) {
                done.error = String(error?.message || error).slice(0, 120);
            }
        }
        out.push(done);
    }
    return out;
};
