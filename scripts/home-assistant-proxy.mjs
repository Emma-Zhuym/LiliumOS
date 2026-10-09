#!/usr/bin/env node

import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const HOST = getArg('--host', '127.0.0.1');
const PORT = Number.parseInt(getArg('--port', '18123'), 10);
const TARGET = new URL(getArg('--target', 'http://192.168.64.2'));
const APPLE_EVENTS_TARGET = new URL(getArg('--apple-events-target', 'http://127.0.0.1:8765'));
const AGENT_BACKEND_TARGET = new URL(getArg('--agent-backend-target', 'http://127.0.0.1:8790'));
// 小红书：mini 上的 xiaohongshu-mcp（server/xhs-mcp）。对外是 /xhs/*，转发时去掉 /xhs 前缀；
// 鉴权由它自己的 AUTH_TOKEN 做，这里只管路由和来源白名单。
const XHS_MCP_TARGET = new URL(getArg('--xhs-mcp-target', 'http://127.0.0.1:18060'));
const XHS_PREFIX = '/xhs';
/**
 * 小红书的「输出」类工具一律停用（阿萌 2026-09-26 定）：角色可以看、点赞、收藏、转发给阿萌，
 * 但不在小红书上发帖、评论、回复，也不能把登录删掉。上游没有开关，只能在这一层拦：
 * tools/call 直接回 JSON-RPC 错误，tools/list 里也把它们藏起来，模型根本看不到。
 * mini 上的心跳本机直连、不走这里，那边另有白名单（server/agent-backend/xhsFeed.mjs）。
 */
export const XHS_BLOCKED_TOOLS = new Set([
    'publish_content',
    'publish_with_video',
    'post_comment_to_feed',
    'reply_comment_in_feed',
    'reply_notification',
    'delete_cookies',
]);
const XHS_MAX_BODY = 1024 * 1024;
// B 站：mini 上的 bilibili-mcp（server/bilibili-mcp，stdio 外包一层 apple-events-bridge）。对外 /bili/*，去前缀转发；
// 工具全是只读的（读视频、字幕、评论、搜索、收藏夹），不需要停用名单。鉴权由桥自己的 Bearer 做。
const BILI_MCP_TARGET = new URL(getArg('--bili-mcp-target', 'http://127.0.0.1:8768'));
const BILI_PREFIX = '/bili';
const ALLOWED_ORIGINS = new Set(
    getArg('--origins', 'https://emma-zhuym.github.io,http://localhost:5173,http://127.0.0.1:5173')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean),
);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('Invalid --port value');
}
if (TARGET.protocol !== 'http:' && TARGET.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS Home Assistant targets are supported');
}
if (APPLE_EVENTS_TARGET.protocol !== 'http:' && APPLE_EVENTS_TARGET.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS Apple Events targets are supported');
}
if (AGENT_BACKEND_TARGET.protocol !== 'http:' && AGENT_BACKEND_TARGET.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS Agent Backend targets are supported');
}
if (XHS_MCP_TARGET.protocol !== 'http:' && XHS_MCP_TARGET.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS Xiaohongshu MCP targets are supported');
}
if (BILI_MCP_TARGET.protocol !== 'http:' && BILI_MCP_TARGET.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS Bilibili MCP targets are supported');
}

const corsHeaders = origin => ({
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, Last-Event-ID, MCP-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
});

const server = createServer((request, response) => {
    const origin = request.headers.origin || '';
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', Vary: 'Origin' });
        response.end('Origin is not allowed');
        return;
    }

    if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders(origin));
        response.end();
        return;
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
        response.writeHead(405, { ...corsHeaders(origin), Allow: 'GET, POST, OPTIONS' });
        response.end();
        return;
    }

    let incoming;
    try {
        incoming = new URL(request.url || '/', 'http://localhost');
    } catch {
        response.writeHead(400, corsHeaders(origin));
        response.end();
        return;
    }
    if (incoming.pathname === '/__proxy-health') {
        response.writeHead(200, {
            ...corsHeaders(origin),
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({
            status: 'ok',
            routes: { homeAssistant: '/api/*', appleEvents: '/mcp', agentBackend: '/agent/*', xiaohongshu: '/xhs/mcp', bilibili: '/bili/mcp' },
        }));
        return;
    }

    const requestedTarget = incoming.searchParams.get('target');
    let target;
    let upstreamName = 'Home Assistant';
    if (requestedTarget) {
        try {
            target = new URL(requestedTarget);
        } catch {
            response.writeHead(400, corsHeaders(origin));
            response.end();
            return;
        }
        if (target.origin !== TARGET.origin) {
            response.writeHead(403, corsHeaders(origin));
            response.end();
            return;
        }
    } else {
        const isAppleEventsPath = incoming.pathname === '/mcp' || incoming.pathname.startsWith('/mcp/');
        const isAgentBackendPath = incoming.pathname.startsWith('/agent/');
        // 只放 MCP 端点和健康检查：它的 /api/v1/* REST 接口（发帖、删 cookie…）不从公网开
        const xhsPath = incoming.pathname.startsWith(`${XHS_PREFIX}/`) ? incoming.pathname.slice(XHS_PREFIX.length) : null;
        const biliPath = incoming.pathname.startsWith(`${BILI_PREFIX}/`) ? incoming.pathname.slice(BILI_PREFIX.length) : null;
        if (biliPath === '/mcp' || biliPath === '/health') {
            target = new URL(`${biliPath}${incoming.search}`, BILI_MCP_TARGET);
            upstreamName = 'Bilibili MCP';
        } else if (xhsPath === '/mcp' || xhsPath === '/health') {
            target = new URL(`${xhsPath}${incoming.search}`, XHS_MCP_TARGET);
            upstreamName = 'Xiaohongshu MCP';
        } else if (isAppleEventsPath) {
            target = new URL(`${incoming.pathname}${incoming.search}`, APPLE_EVENTS_TARGET);
            upstreamName = 'Apple Events';
        } else if (isAgentBackendPath) {
            target = new URL(`${incoming.pathname}${incoming.search}`, AGENT_BACKEND_TARGET);
            upstreamName = 'Agent Backend';
        } else {
            target = new URL(`${incoming.pathname}${incoming.search}`, TARGET);
        }
    }

    const isHomeAssistantPath = target.origin === TARGET.origin
        && (target.pathname === '/api' || target.pathname.startsWith('/api/'));
    const isAppleEventsPath = target.origin === APPLE_EVENTS_TARGET.origin
        && (target.pathname === '/mcp' || target.pathname.startsWith('/mcp/'));
    const isAgentBackendPath = target.origin === AGENT_BACKEND_TARGET.origin
        && target.pathname.startsWith('/agent/');
    const isXhsMcpPath = upstreamName === 'Xiaohongshu MCP';
    const isBiliMcpPath = upstreamName === 'Bilibili MCP';
    if (!isHomeAssistantPath && !isAppleEventsPath && !isAgentBackendPath && !isXhsMcpPath && !isBiliMcpPath) {
        response.writeHead(404, corsHeaders(origin));
        response.end();
        return;
    }

    const upstreamHeaders = {};
    for (const name of ['accept', 'authorization', 'content-type', 'last-event-id', 'mcp-protocol-version', 'mcp-session-id']) {
        const value = request.headers[name];
        if (value !== undefined) upstreamHeaders[name] = value;
    }

    if (isXhsMcpPath && request.method === 'POST') {
        forwardXhsMcp({ request, response, target, origin, upstreamHeaders });
        return;
    }

    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstream = send(target, { method: request.method, headers: upstreamHeaders }, upstreamResponse => {
        const headers = corsHeaders(origin);
        for (const name of ['cache-control', 'content-type', 'mcp-session-id', 'www-authenticate']) {
            const value = upstreamResponse.headers[name];
            if (value !== undefined) headers[name] = value;
        }
        response.writeHead(upstreamResponse.statusCode || 502, headers);
        upstreamResponse.pipe(response);
    });

    upstream.on('error', error => {
        console.error(`${upstreamName} request failed: ${error.code || error.name}: ${error.message}`);
        if (response.headersSent) {
            response.destroy(error);
            return;
        }
        response.writeHead(502, { ...corsHeaders(origin), 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(`${upstreamName} is unavailable`);
    });
    request.pipe(upstream);
});

/** 一条或一批 JSON-RPC 请求里，有没有想调停用工具的。 */
const blockedToolIn = message => {
    const calls = Array.isArray(message) ? message : [message];
    for (const call of calls) {
        const name = call?.method === 'tools/call' ? String(call?.params?.name ?? '') : '';
        if (XHS_BLOCKED_TOOLS.has(name)) return { name, id: call?.id ?? null };
    }
    return null;
};

/** tools/list 的结果里去掉停用的工具。JSON 和 SSE 两种回法都认；认不出就原样返回。 */
const hideBlockedTools = text => {
    const filter = parsed => {
        const tools = parsed?.result?.tools;
        if (!Array.isArray(tools)) return parsed;
        return { ...parsed, result: { ...parsed.result, tools: tools.filter(tool => !XHS_BLOCKED_TOOLS.has(tool?.name)) } };
    };
    try {
        return JSON.stringify(filter(JSON.parse(text)));
    } catch {
        return text.split('\n').map(line => {
            if (!line.startsWith('data:')) return line;
            try {
                return `data: ${JSON.stringify(filter(JSON.parse(line.slice(5).trim())))}`;
            } catch {
                return line;
            }
        }).join('\n');
    }
};

/** 小红书 MCP：整段读完请求再决定放不放行；tools/list 的回包也整段读完、去掉停用工具再回。 */
const forwardXhsMcp = ({ request, response, target, origin, upstreamHeaders }) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    request.on('data', chunk => {
        if (aborted) return;
        size += chunk.length;
        if (size > XHS_MAX_BODY) {
            aborted = true;
            response.writeHead(413, corsHeaders(origin));
            response.end();
            request.destroy();
            return;
        }
        chunks.push(chunk);
    });
    request.on('end', () => {
        if (aborted) return;
        const body = Buffer.concat(chunks);
        let message = null;
        try {
            message = JSON.parse(body.toString('utf8') || 'null');
        } catch { /* 不是 JSON 就原样转，由上游回错 */ }
        const blocked = message && blockedToolIn(message);
        if (blocked) {
            response.writeHead(200, { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({
                jsonrpc: '2.0',
                id: blocked.id,
                error: { code: -32601, message: `小红书工具 ${blocked.name} 在 LiliumOS 里停用了：角色只看、点赞、收藏、转发给阿萌，不发帖不评论。` },
            }));
            return;
        }
        const listing = !Array.isArray(message) && message?.method === 'tools/list';
        const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
        const upstream = send(target, {
            method: 'POST',
            headers: { ...upstreamHeaders, 'content-length': String(body.length) },
        }, upstreamResponse => {
            const headers = corsHeaders(origin);
            for (const name of ['cache-control', 'content-type', 'mcp-session-id', 'www-authenticate']) {
                const value = upstreamResponse.headers[name];
                if (value !== undefined) headers[name] = value;
            }
            if (!listing) {
                response.writeHead(upstreamResponse.statusCode || 502, headers);
                upstreamResponse.pipe(response);
                return;
            }
            const parts = [];
            upstreamResponse.on('data', part => parts.push(part));
            upstreamResponse.on('end', () => {
                response.writeHead(upstreamResponse.statusCode || 502, headers);
                response.end(hideBlockedTools(Buffer.concat(parts).toString('utf8')));
            });
        });
        upstream.on('error', error => {
            console.error(`Xiaohongshu MCP request failed: ${error.code || error.name}: ${error.message}`);
            if (response.headersSent) {
                response.destroy(error);
                return;
            }
            response.writeHead(502, { ...corsHeaders(origin), 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Xiaohongshu MCP is unavailable');
        });
        upstream.end(body);
    });
};

server.listen(PORT, HOST, () => {
    console.log(`LiliumOS local service mux listening on http://${HOST}:${PORT}`);
    console.log(`Forwarding /api requests to ${TARGET.origin}`);
    console.log(`Forwarding /mcp requests to ${APPLE_EVENTS_TARGET.origin}`);
    console.log(`Forwarding /agent requests to ${AGENT_BACKEND_TARGET.origin}`);
    console.log(`Forwarding /xhs/mcp requests to ${XHS_MCP_TARGET.origin}`);
    console.log(`Forwarding /bili/mcp requests to ${BILI_MCP_TARGET.origin}`);
});
