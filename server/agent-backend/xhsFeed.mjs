/**
 * 心跳里「逛小红书」：先由程序去刷一次首页，拿到真实的笔记，再交给模型挑着看、写感想。
 *
 * 跟这个文件夹里的其他东西一个道理——让模型自己决定「要不要刷、刷什么」，它会选最省事的；
 * 让它凭空写「刷到了什么」，它会编。所以刷不刷由抽签定，刷到什么由真实首页定，
 * 模型只负责「这个人看到这些会怎么想」。
 *
 * 只刷首页（list_feeds），不搜索、不点赞、不评论：纯逛，也不去打扰真实用户。
 * 服务是 mini 上常驻的 xiaohongshu-mcp（server/xhs-mcp），本机直连，不绕 Funnel。
 */

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
        notes.push({
            noteId,
            title,
            author: str(user.nickname || user.nickName || user.nick_name || card.author, 40),
            likes: parseCount(card.interactInfo?.likedCount ?? card.interact_info?.liked_count ?? card.likes),
            video: card.type === 'video',
            ...(item.xsecToken || item.xsec_token ? { xsecToken: str(item.xsecToken || item.xsec_token, 200) } : {}),
        });
    }
    return notes;
};

/** 刷一次首页。服务没配、没起来、没登录、超时，都返回空数组并带上原因，由调用方退回别的事。 */
export const fetchFeed = async (xhs, { limit = XHS_FEED_LIMIT, timeoutMs = XHS_FEED_TIMEOUT_MS } = {}) => {
    if (!xhs) return { notes: [], error: 'xhs_not_configured' };
    try {
        const result = await xhs.callTool('list_feeds', {}, { timeoutMs });
        const notes = parseFeed(result).slice(0, limit);
        return notes.length ? { notes } : { notes: [], error: 'xhs_empty_feed' };
    } catch (error) {
        return { notes: [], error: String(error?.message || error).slice(0, 200) };
    }
};

/** 给模型看的首页：编号 + 标题 + 作者 + 赞数。id 不给模型抄，挑的时候写编号。 */
export const formatFeedForPrompt = notes => notes
    .map((note, index) => `${index + 1}. 「${note.title}」${note.video ? '（视频）' : ''} — ${note.author || '匿名'}，${note.likes} 赞`)
    .join('\n');

/**
 * 模型挑的编号 → 真实笔记。编号越界、重复的丢掉；标题、作者、赞数一律用首页的真值，
 * 模型只留下它自己写的那句「为什么多看了两眼」。
 */
export const resolvePicks = (picks, notes) => {
    const out = [];
    const used = new Set();
    for (const pick of Array.isArray(picks) ? picks : []) {
        const index = Number(pick?.index) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= notes.length || used.has(index)) continue;
        used.add(index);
        const note = str(pick?.note, 120);
        out.push({ ...notes[index], ...(note ? { note } : {}) });
        if (out.length >= XHS_MAX_PICKS) break;
    }
    return out;
};
