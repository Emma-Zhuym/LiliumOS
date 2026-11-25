// 小红书分享短链展开（手机转发 xhslink 时的备用路）。
//
// 手机默认经公共代理 Worker 展开短链，但 xhslink.cn 从美国连时快时慢，Worker 8 秒超时后
// 用户只看到「小红书链接解析失败」。mini 这里只走第一跳：xhslink 的 302 里就有笔记地址，
// 不必再跟着跳到 xiaohongshu.com / rednote.com 的拦截页。
//
// 只认 xhslink.com / xhslink.cn，所以不会被拿来访问内网或别的站。

const SHORT_HOSTS = ['xhslink.com', 'xhslink.cn'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const isShortHost = hostname => {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    return SHORT_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
};

const badRequest = message => Object.assign(new Error(message), { status: 400, code: 'BAD_XHS_LINK' });

export const parseShortLink = raw => {
    let url;
    try { url = new URL(String(raw || '').trim()); } catch { throw badRequest('不是小红书短链'); }
    if (!/^https?:$/.test(url.protocol) || !isShortHost(url.hostname)) throw badRequest('只展开 xhslink 短链');
    return url;
};

/**
 * 只跟 xhslink 自己的跳转，第一次跳出 xhslink 就把那个地址交回去。
 * 每次尝试 timeoutMs，失败最多试 attempts 次（xhslink 偶尔一次卡十几秒，下一次又秒回）。
 */
export const expandXhsShortLink = async (raw, { fetchImpl = fetch, timeoutMs = 6_000, attempts = 3 } = {}) => {
    const start = parseShortLink(raw);
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            let current = start;
            for (let hop = 0; hop < 4; hop++) {
                const response = await fetchImpl(current.toString(), {
                    method: 'GET',
                    redirect: 'manual',
                    headers: { 'User-Agent': UA },
                    signal: AbortSignal.timeout(timeoutMs),
                });
                const location = response.headers.get('location');
                try { await response.body?.cancel?.(); } catch { /* 不读正文 */ }
                if (!location || response.status < 300 || response.status >= 400) {
                    throw new Error(`短链没有跳转（HTTP ${response.status}）`);
                }
                const next = new URL(location, current);
                if (!isShortHost(next.hostname)) return { finalUrl: next.toString() };
                current = next;
            }
            throw new Error('短链跳转太多次');
        } catch (error) {
            lastError = error;
        }
    }
    throw Object.assign(new Error(`短链展开失败：${lastError?.message || '没响应'}`), { status: 502, code: 'XHS_EXPAND_FAILED' });
};
