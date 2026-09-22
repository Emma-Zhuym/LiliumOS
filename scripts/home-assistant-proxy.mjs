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
            routes: { homeAssistant: '/api/*', appleEvents: '/mcp', agentBackend: '/agent/*' },
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
        if (isAppleEventsPath) {
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
    if (!isHomeAssistantPath && !isAppleEventsPath && !isAgentBackendPath) {
        response.writeHead(404, corsHeaders(origin));
        response.end();
        return;
    }

    const upstreamHeaders = {};
    for (const name of ['accept', 'authorization', 'content-type', 'last-event-id', 'mcp-protocol-version', 'mcp-session-id']) {
        const value = request.headers[name];
        if (value !== undefined) upstreamHeaders[name] = value;
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

server.listen(PORT, HOST, () => {
    console.log(`LiliumOS local service mux listening on http://${HOST}:${PORT}`);
    console.log(`Forwarding /api requests to ${TARGET.origin}`);
    console.log(`Forwarding /mcp requests to ${APPLE_EVENTS_TARGET.origin}`);
    console.log(`Forwarding /agent requests to ${AGENT_BACKEND_TARGET.origin}`);
});
