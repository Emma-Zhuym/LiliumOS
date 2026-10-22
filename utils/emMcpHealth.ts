// [EM-START: settings-ios-list]
/**
 * 设置首页「MCP 工具 4/5 在线」那一行背后的体检：挨个连一遍开着的服务器，只看通不通。
 *
 * 只测、不改配置——工具清单的落盘仍走 MCP 配置页里的「测试」，这里不碰，免得一打开设置就触发上云同步。
 * 结果留在内存里：同一次打开 App 里五分钟内再进设置不重测，点「全部重测」才强制。
 */

import { loadMcpServers, testMcpConnection, type McpServerConfig } from './mcpClient';
import type { McpCheckResult, McpHealth } from './emSettingsPages';

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

const checkOne = async (server: McpServerConfig): Promise<McpCheckResult> => {
    try {
        const r = await withTimeout(testMcpConnection(server), TIMEOUT_MS);
        return { id: server.id, name: server.name, ok: r.ok, message: r.ok ? `${r.tools?.length ?? 0} 个工具` : r.message, toolCount: r.tools?.length ?? 0 };
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
