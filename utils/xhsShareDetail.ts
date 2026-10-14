import { XhsMcpClient, type McpToolResult } from './xhsMcpClient';
import {
    detectXhsShortUrl,
    expandShortUrl,
    extractXhsNoteLink,
} from './webpageExtractor';

export interface XhsShareTarget {
    noteId: string;
    xsecToken?: string;
}

type ShortLinkExpander = (url: string) => Promise<string>;

// [EM-START: xhs-detail-prefetch]
// 粘贴短链后，预读和真正发送可能同时进来；短链展开也共用一趟，避免先后向
// sfworker 发两个完全相同的请求。
const shortLinkTargets = new Map<string, XhsShareTarget>();
const shortLinkInFlight = new Map<string, Promise<XhsShareTarget | null>>();
const SHORT_LINK_TARGET_CACHE_MAX_ENTRIES = 64;

const resolveShortLinkTarget = (
    shortUrl: string,
    expand: ShortLinkExpander,
): Promise<XhsShareTarget | null> => {
    const cached = shortLinkTargets.get(shortUrl);
    if (cached) return Promise.resolve(cached);
    const pending = shortLinkInFlight.get(shortUrl);
    if (pending) return pending;

    let request!: Promise<XhsShareTarget | null>;
    request = (async () => {
        try {
            const finalUrl = await expand(shortUrl);
            const target = extractXhsNoteLink(finalUrl);
            if (target) {
                shortLinkTargets.delete(shortUrl);
                shortLinkTargets.set(shortUrl, target);
                while (shortLinkTargets.size > SHORT_LINK_TARGET_CACHE_MAX_ENTRIES) {
                    const oldestKey = shortLinkTargets.keys().next().value;
                    if (oldestKey === undefined) break;
                    shortLinkTargets.delete(oldestKey);
                }
            }
            return target;
        } finally {
            if (shortLinkInFlight.get(shortUrl) === request) shortLinkInFlight.delete(shortUrl);
        }
    })();
    shortLinkInFlight.set(shortUrl, request);
    return request;
};

/** 从完整链接或手机短链分享文案中取得详情读取所需的笔记 id/token。 */
export const resolveXhsShareTarget = async (
    text: string,
    expand: ShortLinkExpander = expandShortUrl,
): Promise<XhsShareTarget | null> => {
    const direct = extractXhsNoteLink(text);
    if (direct) return direct;
    const shortUrl = detectXhsShortUrl(text);
    if (!shortUrl) return null;
    return resolveShortLinkTarget(shortUrl, expand);
};

/**
 * 用户粘贴分享文案后提前启动详情读取。它与发送路径及角色工具共用
 * XhsMcpClient 的在途请求/短时缓存，因此这里失败时保持静默，发送时仍会正常提示。
 */
export const prefetchXhsShareDetail = async (
    serverUrl: string,
    text: string,
): Promise<McpToolResult | null> => {
    const target = await resolveXhsShareTarget(text);
    if (!target) return null;
    const noteUrl = `https://www.xiaohongshu.com/explore/${target.noteId}${target.xsecToken ? `?xsec_token=${encodeURIComponent(target.xsecToken)}&xsec_source=pc_share` : ''}`;
    return XhsMcpClient.getNoteDetail(serverUrl, noteUrl, target.xsecToken, {
        loadAllComments: false,
        xsecSource: 'pc_share',
    });
};

export const resetXhsShareDetailStateForTests = (): void => {
    shortLinkTargets.clear();
    shortLinkInFlight.clear();
};
// [EM-END: xhs-detail-prefetch]
