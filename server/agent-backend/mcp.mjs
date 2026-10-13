/**
 * 极简 MCP 客户端（Streamable HTTP），只够本服务自己调本机工具用。
 *
 * 只实现 initialize → notifications/initialized → tools/list / tools/call 这条主干。
 * 前端那套完整实现在 utils/mcpClient.ts，那份跑在浏览器里、要处理代理和 CORS，
 * 这里全是本机直连（127.0.0.1），不绕 Funnel，也就不需要那些。
 */

const PROTOCOL_VERSION = '2025-06-18';

/** 响应可能是 JSON，也可能是 SSE 流；两种都要能读出同一个 JSON-RPC 结果。 */
const readRpcResult = async response => {
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    if (contentType.includes('text/event-stream')) {
        for (const line of text.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
                const parsed = JSON.parse(payload);
                if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
            } catch { /* 不是完整 JSON 的 data 行直接跳过 */ }
        }
        throw new Error('SSE 响应里没有 JSON-RPC 结果');
    }
    if (!text.trim()) return { result: null };
    return JSON.parse(text);
};

export const createMcpClient = ({ url, token, fetchImpl = fetch, timeoutMs = 25_000 }) => {
    let sessionId = null;
    let nextId = 1;

    const call = async (method, params, { notification = false, timeoutMs: callTimeoutMs = timeoutMs } = {}) => {
        const body = notification
            ? { jsonrpc: '2.0', method, params }
            : { jsonrpc: '2.0', id: nextId++, method, params };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), callTimeoutMs);
        try {
            let response;
            try {
                response = await fetchImpl(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'MCP-Protocol-Version': PROTOCOL_VERSION,
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
            } catch (error) {
                // 裸 fetch 的错误只有一句 "fetch failed"，隔着日志根本看不出是哪个服务没起来。
                const reason = controller.signal.aborted ? `超过 ${callTimeoutMs}ms 没响应` : String(error?.message || error);
                throw new Error(`连不上 MCP 服务（${url}，${method}）：${reason}`);
            }
            const newSession = response.headers.get('mcp-session-id');
            if (newSession) sessionId = newSession;
            if (!response.ok) {
                const error = new Error(`MCP HTTP ${response.status}`);
                // 桥接会回收闲置会话，之后拿旧 Mcp-Session-Id 来调就是 400 / 404。
                error.sessionGone = Boolean(sessionId) && method !== 'initialize'
                    && (response.status === 400 || response.status === 404);
                throw error;
            }
            if (notification) return null;
            const parsed = await readRpcResult(response);
            if (parsed.error) {
                const error = new Error(parsed.error.message || 'MCP 调用失败');
                error.rpcCode = parsed.error.code;
                throw error;
            }
            return parsed.result;
        } finally {
            clearTimeout(timer);
        }
    };

    let ready = null;
    const ensureReady = () => {
        ready ??= (async () => {
            await call('initialize', {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: 'liliumos-agent-backend', version: '0.1.0' },
            });
            await call('notifications/initialized', {}, { notification: true });
        })().catch(error => {
            ready = null;           // 握手失败不缓存，下次调用重来
            throw error;
        });
        return ready;
    };

    // 会话被服务端收走（闲置回收 / 服务重启）后，只握手一次就永远拿旧号去调，
    // 2026-10-10 起日历同步整整两天全是 400。丢掉旧会话重新握手，再试一次。
    const withSession = async run => {
        await ensureReady();
        try {
            return await run();
        } catch (error) {
            if (!error?.sessionGone) throw error;
            sessionId = null;
            ready = null;
            await ensureReady();
            return run();
        }
    };

    return {
        async listTools() {
            const result = await withSession(() => call('tools/list', {}));
            return result?.tools ?? [];
        },
        /** `timeoutMs` 单独放宽某一次调用：列日历（calendar_calendars）要二十多秒，默认那档等不到。 */
        async callTool(name, args, { timeoutMs: callTimeoutMs } = {}) {
            return withSession(() => call('tools/call', { name, arguments: args ?? {} }, callTimeoutMs ? { timeoutMs: callTimeoutMs } : {}));
        },
        get sessionId() { return sessionId; },
    };
};

/** 把 MCP 的内容块压成一段纯文本，日志和结果摘要用。 */
export const flattenContent = (result, limit = 2000) => {
    const blocks = Array.isArray(result?.content) ? result.content : [];
    return blocks
        .map(block => (block?.type === 'text' ? block.text : `[${block?.type || 'unknown'}]`))
        .join('\n')
        .slice(0, limit);
};
