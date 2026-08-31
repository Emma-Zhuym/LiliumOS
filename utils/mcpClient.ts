/**
 * 通用 MCP 客户端 (Model Context Protocol, Streamable HTTP)
 *
 * 与 mcdMcpClient / luckinMcpClient 的「一家一个客户端」不同，这里是用户
 * 自配的任意远程 MCP 服务器：设置里填 URL（+ 可选 Bearer Token / 自定义头），发现工具后
 * 以 OpenAI function-calling 格式注入聊天请求，工具循环见 useChatAI。
 *
 * 网络路径（用户三选一，见 docs/mcp-client.md）：
 * 1. 直连 —— MCP 服务器 CORS 配置正确时（能读到 Mcp-Session-Id 响应头）
 * 2. 本地代理 —— node scripts/mcp-proxy.mjs，代理 URL 填 http://localhost:18061
 * 3. 用户自己的 Cloudflare Worker —— worker/mcp-proxy/，部署到用户自己的账号
 * 代理约定统一为 <代理URL>?target=<url-encoded 服务器URL>，可选 X-Proxy-Key 头。
 * 刻意不走中心 sfworker：MCP 流量（含用户的 Bearer Token）不该过项目方的服务器。
 *
 * JSON-RPC 收发本体（握手、SSE、tools/call、参数还原）住在环境无关叶子
 * mcpFireCore，浏览器和 amsg worker 共用；这里只补浏览器侧的配置、代理包装和会话表。
 */

import {
    callMcpToolCore,
    createMcpSessionState,
    discoverMcpToolsCore,
    normalizeMcpToolArguments,
    MCP_REQUEST_TIMEOUT_MS,
    type McpFireServer,
    type McpSessionState,
    type McpToolResult,
    type McpTransportTarget,
} from './mcpFireCore';
import { isWorkerReachableUrl } from './amsgToolPack';

export { MCP_REQUEST_TIMEOUT_MS, normalizeMcpToolArguments };
export type { McpToolResult };

export interface McpToolDef {
    name: string;
    description?: string;
    inputSchema?: any;
}

export interface McpCustomHeader {
    name: string;
    value: string;
}

export interface McpServerConfig {
    id: string;
    name: string;
    url: string;
    /** Bearer Token，可选（Authorization: Bearer <token>） */
    token?: string;
    /** 额外请求头，可选（例如 X-API-Key / XBY-APIKEY） */
    customHeaders?: McpCustomHeader[];
    /** 代理 URL，可选。空 = 浏览器直连 */
    proxyUrl?: string;
    /** 自部署 Worker 的防白嫖密钥，可选（X-Proxy-Key 头） */
    proxyKey?: string;
    enabled: boolean;
    /** 「发现工具」后持久化的工具清单（聊天注入直接读这里，不用每次握手） */
    tools?: McpToolDef[];
    /**
     * 绑定聊天：空/缺省 = 通用（所有私聊和群聊可用）；非空 = 只有这些角色/群聊能用。
     * 为兼容已有本地配置沿用 charIds 字段名，数组项也可以是 GroupProfile.id。
     * 老配置没有该字段，天然落在通用语义上。
     */
    charIds?: string[];
    updatedAt: number;
}

const MCP_SERVERS_KEY = 'aetheros.mcp.servers';
const MCP_USE_NATIVE_TOOLS_KEY = 'aetheros.mcp.useNativeTools';

// ========== 服务器配置 (持久化在 localStorage) ==========

export const loadMcpServers = (): McpServerConfig[] => {
    try {
        const raw = localStorage.getItem(MCP_SERVERS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
};

export const saveMcpServers = (servers: McpServerConfig[]): void => {
    try { localStorage.setItem(MCP_SERVERS_KEY, JSON.stringify(servers)); } catch { /* ignore */ }
};

/** 当前聊天模型/中转是否支持 OpenAI function calling；默认支持。 */
export const getMcpUseNativeTools = (): boolean => {
    try { return localStorage.getItem(MCP_USE_NATIVE_TOOLS_KEY) !== '0'; }
    catch { return true; }
};

export const setMcpUseNativeTools = (enabled: boolean): void => {
    try { localStorage.setItem(MCP_USE_NATIVE_TOOLS_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
};

export const createMcpServer = (name: string, url: string): McpServerConfig => ({
    id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    url,
    enabled: false,
    updatedAt: Date.now(),
});

/**
 * 启用且已发现工具、且对当前聊天可见的服务器。
 * charId 可传角色 ID 或群聊 ID；缺省时只返回通用服务器，保证没有聊天上下文
 * 的调用点不会泄漏绑定服务器的工具。
 */
export const getEnabledMcpServers = (charId?: string): McpServerConfig[] =>
    loadMcpServers().filter(s =>
        s.enabled && s.url && (s.tools?.length || 0) > 0 &&
        (!s.charIds?.length || (charId != null && s.charIds.includes(charId))),
    );

/** 有任何一个启用且已发现工具、对该角色可见的服务器 → 聊天进入 MCP 工具模式 */
export const isMcpChatAvailable = (charId?: string): boolean => getEnabledMcpServers(charId).length > 0;

// CF worker 够不够得着的判断搬去了 utils/amsgToolPack.ts —— 小红书配置那边要用同一份。

/**
 * 这个聊天里有没有「本地用得上、但 worker 够不着」的服务器（localhost / 私网 / *.local
 * 这类，判据见 amsgToolPack.isWorkerReachableUrl）。
 *
 * 这是地址能力层的底层诊断；实际聊天路由不要直接拿它做永久 veto。Home Assistant
 * 还要经过 shouldPreferLocalMcpForTurn 的当前轮语义门控，普通闲聊才能继续走 worker。
 *
 * 口径跟 isMcpChatAvailable 同源（都走 getEnabledMcpServers）：本地这一轮真会写进
 * prompt 的是哪几台，就拿哪几台来判，别把别的角色绑定的服务器算进来。
 */
export const hasWorkerUnreachableMcpServer = (charId?: string): boolean =>
    getEnabledMcpServers(charId).some((s) => !isWorkerReachableUrl(s.url));

export interface McpRoutingMessage {
    role?: string;
    content?: unknown;
}

const HOME_ASSISTANT_NAME_RE = /home\s*assistant|homeassistant|智能家居|共栖舱/i;
const HOME_ASSISTANT_PATH_RE = /\/api\/mcp(?:\/|$)/i;
const HOME_ASSISTANT_TOOL_RE = /^(?:Hass[A-Z_]|GetLiveContext$)/i;

/**
 * Home Assistant 的私网地址 CF worker 连不到，但不代表绑定了 HA 的角色每句话都必须
 * 留在本地。先用服务器身份 + 当前轮语义做一个刻意保守的小门：明确控制/查询设备时
 * 才在前端跑 MCP；普通闲聊仍可走 Instant Chat。未知的私有 MCP 没有可靠的意图词典，
 * 继续沿用「始终留本地」的安全口径，避免静默丢工具。
 */
const isHomeAssistantServer = (server: McpServerConfig): boolean =>
    HOME_ASSISTANT_NAME_RE.test(server.name || '')
    || HOME_ASSISTANT_PATH_RE.test(server.url || '')
    || (server.tools || []).some((tool) => HOME_ASSISTANT_TOOL_RE.test(tool.name || ''));

/** 复用现有 MCP 角色绑定，作为该角色是否可读取同一台 HA 内私密数据的权限开关。 */
export const hasHomeAssistantMcpAccess = (charId?: string): boolean =>
    getEnabledMcpServers(charId).some(isHomeAssistantServer);

const messageContentText = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((part) => messageContentText(part)).filter(Boolean).join(' ');
    if (content && typeof content === 'object' && 'text' in content) {
        return typeof (content as { text?: unknown }).text === 'string'
            ? (content as { text: string }).text
            : '';
    }
    return '';
};

const HOME_DEVICE_RE = /(?:灯泡?|照明|台灯|床头灯|夜灯|吊灯|灯带|净化器|空气净化|空气质量|PM\s*(?:2[.．]?5|10)|风扇|风机|风速|风档|home\s*assistant|智能家居|共栖舱|HA\b|\blights?\b|\blamps?\b|air\s*(?:purifier|quality)|\bfans?\b)/i;
const HOME_OPERATION_RE = /(?:打开|开启|开一下|开到|开着|关掉|关闭|关一下|关着|调(?:整|成|到|高|低|亮|暗)|设置|设为|换成|变成|启动|停止|暂停|继续|查看|看看|查询|多少|状态|亮度|颜色|色温|模式|档位?|有没有|是否|怎么样|怎么了|turn\s+(?:on|off)|switch\s+(?:on|off)|dim|brighten|set|change|status|colour|color|brightness)/i;
const HOME_SCENE_RE = /(?:(?:回家|离家|晚安|起床|睡眠|专注).{0,5}(?:模式|场景)|(?:启动|打开|开启|切换|设置).{0,8}(?:回家|离家|晚安|起床|睡眠|专注)(?:模式|场景))/i;
const HOME_SHORT_COMMAND_RE = /(?:(?:开|关)(?:一下|下|个)?(?:床头|台|夜|吊)?灯|(?:开|关)(?:一下|下)?(?:空气)?净化器|lights?\s+(?:on|off))/i;
const HOME_FOLLOWUP_RE = /(?:再?(?:亮|暗|高|低|强|弱)(?:一|两)?点|(?:把它)?(?:换|调|设|变)(?:成|为|到)?\s*(?:红|橙|黄|绿|青|蓝|紫|粉|白|暖白|冷白)(?:色)?|(?:红|橙|黄|绿|青|蓝|紫|粉|白|暖白|冷白)(?:色)?(?:吧|呢)?|把?它(?:打开|关掉|关闭|调亮|调暗)|再?(?:打开|关掉|关闭|调高|调低)(?:一点)?|(?:调到)?\s*\d{1,3}\s*%|(?:brighter|dimmer|turn\s+it\s+(?:on|off)))/i;
const hasDirectHomeAssistantIntent = (text: string): boolean => {
    const normalized = text.trim();
    if (!normalized) return false;
    return HOME_SCENE_RE.test(normalized)
        || HOME_SHORT_COMMAND_RE.test(normalized)
        || (HOME_DEVICE_RE.test(normalized) && HOME_OPERATION_RE.test(normalized));
};

const hasHomeAssistantTurnIntent = (messages: McpRoutingMessage[]): boolean => {
    const userTexts = messages
        .filter((message) => message?.role === 'user')
        .map((message) => messageContentText(message.content).trim())
        .filter(Boolean);
    const latest = userTexts.at(-1) || '';
    if (hasDirectHomeAssistantIntent(latest)) return true;

    const previous = userTexts.at(-2) || '';
    return HOME_FOLLOWUP_RE.test(latest) && hasDirectHomeAssistantIntent(previous);
};

/** 当前轮是否应该把 MCP 工具与工具提示真正交给模型。 */
export const shouldActivateMcpForTurn = (
    messages: McpRoutingMessage[],
    charId?: string,
): boolean => {
    const servers = getEnabledMcpServers(charId);
    if (!servers.length) return false;
    // 公网 MCP 可由 worker 自己执行；未知私网 MCP 没有可泛化词典，保留旧行为。
    if (servers.some((server) => isWorkerReachableUrl(server.url) || !isHomeAssistantServer(server))) return true;
    return hasHomeAssistantTurnIntent(messages);
};

/**
 * 当前轮是否真的需要调用 worker 够不着的 MCP。
 *
 * HA：明确设备语义才本地；「再暗一点 / 把它关掉」只继承紧邻的上一条用户指令。
 * 其他私有 MCP：缺少可泛化的语义词典，仍然保守地留在本地。
 */
export const shouldPreferLocalMcpForTurn = (
    messages: McpRoutingMessage[],
    charId?: string,
): boolean => {
    const privateServers = getEnabledMcpServers(charId).filter((server) => !isWorkerReachableUrl(server.url));
    if (!privateServers.length) return false;
    if (privateServers.some((server) => !isHomeAssistantServer(server))) return true;

    return hasHomeAssistantTurnIntent(messages);
};

/**
 * 上云给 amsg worker 用的服务器子集。注意不走 getEnabledMcpServers：
 * 那个函数缺 charId 时只回通用服务器，而这里要的是全部 enabled（含绑定角色的），
 * charIds 原样带上、由 worker 在 fire 时按角色过滤。
 *
 * 带上 token/customHeaders：走的是 client_state 端到端加密通道、落在用户自己的
 * amsg worker（不是项目方服务器，与文件头「不走中心 sfworker」的原则不冲突），
 * 与 notion/飞书凭据同一信任模型。
 */
export const collectMcpFireServers = (): McpFireServer[] =>
    loadMcpServers()
        .filter((s) => s.enabled && s.url && (s.tools?.length || 0) > 0 && isWorkerReachableUrl(s.url))
        .map((s) => ({
            id: s.id, name: s.name, url: s.url,
            ...(s.token ? { token: s.token } : {}),
            ...(s.customHeaders?.length ? { customHeaders: s.customHeaders } : {}),
            ...(s.charIds?.length ? { charIds: s.charIds } : {}),
            tools: (s.tools || []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        }));

// ── 备份用：随「设置 → 导出/导入备份」一起带走（存 localStorage） ──
export function exportMcpLocal(): Record<string, string> | undefined {
    try {
        const out: Record<string, string> = {};
        const servers = localStorage.getItem(MCP_SERVERS_KEY);
        const useNativeTools = localStorage.getItem(MCP_USE_NATIVE_TOOLS_KEY);
        if (servers) {
            const parsed = JSON.parse(servers) as unknown;
            const sanitized = Array.isArray(parsed)
                ? parsed.map((entry) => {
                    if (!entry || typeof entry !== 'object' || !isHomeAssistantServer(entry as McpServerConfig)) return entry;
                    const { token: _token, proxyKey: _proxyKey, customHeaders: _customHeaders, ...safe } = entry as McpServerConfig;
                    // Smart Home 会把同一枚 HA token 复制进 MCP 配置。两处都必须剥离，
                    // 并在恢复后停用这台服务器，等待用户重新填凭据并测试连接。
                    return { ...safe, enabled: false };
                })
                : parsed;
            out[MCP_SERVERS_KEY] = JSON.stringify(sanitized);
        }
        if (useNativeTools) out[MCP_USE_NATIVE_TOOLS_KEY] = useNativeTools;
        return Object.keys(out).length ? out : undefined;
    } catch { return undefined; }
}
export function importMcpLocal(data: Record<string, string> | null | undefined): void {
    if (!data || typeof data !== 'object') return;
    try {
        if (typeof data[MCP_SERVERS_KEY] === 'string') localStorage.setItem(MCP_SERVERS_KEY, data[MCP_SERVERS_KEY]);
        if (typeof data[MCP_USE_NATIVE_TOOLS_KEY] === 'string') localStorage.setItem(MCP_USE_NATIVE_TOOLS_KEY, data[MCP_USE_NATIVE_TOOLS_KEY]);
    } catch { /* ignore */ }
}

// ========== JSON-RPC 会话状态 (内存, 每服务器一份) ==========

const sessions = new Map<string, McpSessionState>();

const getSession = (serverId: string): McpSessionState => {
    let s = sessions.get(serverId);
    if (!s) {
        s = createMcpSessionState();
        sessions.set(serverId, s);
    }
    return s;
};

export const resetMcpSession = (serverId: string): void => {
    sessions.delete(serverId);
};

/** 实际请求地址：配了代理就包成 <proxy>?target=<url>，没配就直连 */
export const buildMcpFetchUrl = (server: Pick<McpServerConfig, 'url' | 'proxyUrl'>): string => {
    const proxy = (server.proxyUrl || '').trim().replace(/\/+$/, '');
    if (!proxy) return server.url;
    const sep = proxy.includes('?') ? '&' : '?';
    return `${proxy}${sep}target=${encodeURIComponent(server.url)}`;
};

/**
 * 组装 MCP 请求头。自定义头在 Bearer / session 等托管字段之前写入，因此用户
 * 可以在不填 Bearer Token 时自定义 Authorization，但不会意外覆盖当前 session。
 * 走代理时额外带一份“需要透传的头名”清单，代理据此只放行用户明确配置的头。
 */
export const buildMcpRequestHeaders = (
    server: Pick<McpServerConfig, 'token' | 'customHeaders' | 'proxyUrl' | 'proxyKey'>,
    sessionId?: string | null,
): Headers => {
    const headers = new Headers({
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    });
    const customNames: string[] = [];
    for (const item of server.customHeaders || []) {
        const name = String(item?.name || '').trim();
        const value = String(item?.value || '').trim();
        if (!name || !value) continue;
        try {
            headers.set(name, value);
            customNames.push(name);
        } catch {
            // 非法 HTTP 头名/值留给设置页继续编辑，不让整条 MCP 请求在 fetch 前崩掉。
        }
    }
    if (server.token) headers.set('Authorization', `Bearer ${server.token}`);
    if (server.proxyUrl && server.proxyKey) headers.set('X-Proxy-Key', server.proxyKey);
    if (server.proxyUrl && customNames.length) headers.set('X-MCP-Forward-Headers', customNames.join(','));
    if (sessionId) headers.set('Mcp-Session-Id', sessionId);
    return headers;
};

/** 一次请求的目标：代理包装和请求头都是浏览器侧独有的，在这里落地后交给 core。 */
const targetFor = (server: McpServerConfig): McpTransportTarget => ({
    url: buildMcpFetchUrl(server),
    headers: (sessionId) => buildMcpRequestHeaders(server, sessionId),
    // 直连时 fetch 抛 TypeError 十有八九是 CORS，把排查方向直接告诉用户
    fetchErrorHint: server.proxyUrl
        ? '请检查代理 URL 是否可访问、代理密钥是否正确。'
        : '很可能是浏览器 CORS 限制。请在这个服务器的「代理 URL」里配置代理（本地 node scripts/mcp-proxy.mjs 或自部署 worker/mcp-proxy）。',
});

// ========== 公开 API ==========

/** 握手 + tools/list。调用方负责把返回的工具清单存回 McpServerConfig.tools */
export const discoverMcpTools = async (server: McpServerConfig): Promise<McpToolDef[]> => {
    resetMcpSession(server.id);
    return discoverMcpToolsCore(targetFor(server), getSession(server.id), MCP_REQUEST_TIMEOUT_MS);
};

/**
 * 调用一个工具（会自动补握手；session 失效自动重试一次）。
 * 重试前的会话重置是 core 就地做的，改的就是这张表里的那个对象，两边不会走岔。
 */
export const callMcpTool = async (
    server: McpServerConfig,
    toolName: string,
    args: Record<string, any> = {},
): Promise<McpToolResult> =>
    callMcpToolCore(targetFor(server), getSession(server.id), toolName, args, {
        inputSchema: (server.tools || []).find(tool => tool.name === toolName)?.inputSchema,
        serverLabel: server.name,
    });

/** 测试连接: 验证握手 + tools/list 能通，返回工具清单供持久化 */
export const testMcpConnection = async (server: McpServerConfig): Promise<{ ok: boolean; message: string; tools?: McpToolDef[] }> => {
    try {
        const tools = await discoverMcpTools(server);
        if (!tools.length) return { ok: true, message: '已连接, 但工具清单为空', tools };
        return { ok: true, message: `已连接, 发现 ${tools.length} 个工具: ${tools.map(t => t.name).slice(0, 8).join('、')}${tools.length > 8 ? '…' : ''}`, tools };
    } catch (e: any) {
        return { ok: false, message: e?.message || String(e) };
    }
};
