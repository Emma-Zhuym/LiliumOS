// [EM-START: settings-ios-list]
/**
 * 设置首页「MCP 工具 4/5 在线」那一行背后的体检：挨个连一遍开着的服务器，只看通不通。
 *
 * 只测、不改配置——工具清单的落盘仍走 MCP 配置页里的「测试」，这里不碰，免得一打开设置就触发上云同步。
 * 结果留在内存里：同一次打开 App 里五分钟内再进设置不重测，点「全部重测」才强制。
 */

import { callMcpTool, loadMcpServers, testMcpConnection, type McpServerConfig } from './mcpClient';
import type { McpCheckResult, McpHealth, McpLoginState } from './emSettingsPages';
import { resultText } from './emBiliTranscript';

const FRESH_MS = 5 * 60_000;
const TIMEOUT_MS = 15_000;

let last: McpHealth | null = null;
let running: Promise<McpHealth> | null = null;
const listeners = new Set<(health: McpHealth | null, checking: boolean) => void>();

const emit = () => listeners.forEach(fn => fn(last, running !== null));

/** 要体检的：开着、填了地址的。关着的服务器不算进「几台在线」。 */
export const mcpServersToCheck = (servers: McpServerConfig[] = loadMcpServers()): McpServerConfig[] =>
    servers.filter(s => s.enabled && s.url.trim());

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${Math.round(ms / 1000)} 秒没回应`)), ms);
    p.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});

// [EM-START: mcp-login-status]
/**
 * 能问「还登着没有」的工具（2026-11-24 阿萌：只有 MCP 在不在线，看不出 B 站登录过期）。
 * 只列又快又只读的：B 站那个只打一次 /x/web-interface/nav。
 * 小红书的 check_login_status 要开浏览器（机房那边带 10 分钟缓存），别加进来。
 */
export const LOGIN_CHECK_TOOLS = ['check_bilibili_credentials'];

/** 工具回的是 JSON（{ configured, logged_in }）；认不出来就当不知道，不报过期 */
export const parseLoginStatus = (text: string): McpLoginState | undefined => {
    try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object') {
            const v = data.logged_in ?? data.isLogin ?? data.is_logged_in;
            if (typeof v === 'boolean') return v && data.configured !== false ? 'ok' : 'expired';
        }
    } catch { /* 不是 JSON，往下按文字认 */ }
    if (/未登录|未配置|过期|expired|not logged in/i.test(text)) return 'expired';
    return undefined;
};

const checkLogin = async (server: McpServerConfig, toolNames: string[]): Promise<McpLoginState | undefined> => {
    const name = LOGIN_CHECK_TOOLS.find(n => toolNames.includes(n));
    if (!name) return undefined;
    try {
        const r = await withTimeout(callMcpTool(server, name, {}), TIMEOUT_MS);
        if (!r.success) return parseLoginStatus(`${r.error ?? ''} ${r.rawText ?? ''}`);
        return parseLoginStatus(resultText(r.data, r.rawText));
    } catch {
        return undefined;
    }
};
// [EM-END: mcp-login-status]

const checkOne = async (server: McpServerConfig): Promise<McpCheckResult> => {
    try {
        const r = await withTimeout(testMcpConnection(server), TIMEOUT_MS);
        const base: McpCheckResult = { id: server.id, name: server.name, ok: r.ok, message: r.ok ? `${r.tools?.length ?? 0} 个工具` : r.message, toolCount: r.tools?.length ?? 0 };
        if (!r.ok) return base;
        const login = await checkLogin({ ...server, tools: r.tools ?? server.tools }, (r.tools ?? server.tools ?? []).map(t => t.name)); // [EM: mcp-login-status]
        return login ? { ...base, login } : base;
    } catch (e: any) {
        return { id: server.id, name: server.name, ok: false, message: e?.message || String(e), toolCount: 0 };
    }
};

export function getMcpHealth(): { health: McpHealth | null; checking: boolean } {
    return { health: last, checking: running !== null };
}

export function checkMcpHealth(force = false): Promise<McpHealth> {
    if (running) return running;
    if (!force && last && Date.now() - last.checkedAt < FRESH_MS) return Promise.resolve(last);
    const servers = mcpServersToCheck();
    running = Promise.all(servers.map(checkOne)).then(results => {
        last = { checkedAt: Date.now(), results };
        return last;
    }).finally(() => { running = null; emit(); });
    emit();
    return running;
}

export function subscribeMcpHealth(fn: (health: McpHealth | null, checking: boolean) => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}
// [EM-END: settings-ios-list]
