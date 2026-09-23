import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;
const DEFAULT_TIMEOUT_MS = 35_000;
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

const isLoopbackHost = (host) => ['127.0.0.1', '::1', 'localhost'].includes(host);

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
};

const safeTokenEqual = (actual, expected) => {
  const a = Buffer.from(actual || '');
  const b = Buffer.from(expected || '');
  return a.length === b.length && timingSafeEqual(a, b);
};

const parseOrigins = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

class StdioSession {
  constructor({ command, args, env, timeoutMs, onExit }) {
    this.pending = new Map();
    this.buffer = '';
    this.timeoutMs = timeoutMs;
    this.lastUsedAt = Date.now();
    this.child = spawn(command, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#onStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => process.stderr.write(`[apple-events] ${chunk}`));
    this.child.once('error', (error) => this.#failAll(error));
    this.child.once('exit', (code, signal) => {
      this.#failAll(new Error(`Apple Events MCP exited (${signal || code})`));
      onExit?.();
    });
  }

  #onStdout(chunk) {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stderr.write('[apple-events] Ignored non-JSON stdout line\n');
        continue;
      }

      this.lastUsedAt = Date.now();
      if (message.id === undefined) continue;
      const key = JSON.stringify(message.id);
      const pending = this.pending.get(key);
      if (!pending) continue;
      this.pending.delete(key);
      clearTimeout(pending.timer);
      pending.resolve(message);
    }
  }

  #failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(message) {
    if (!this.child.stdin.writable) throw new Error('Apple Events MCP is not writable');
    this.lastUsedAt = Date.now();
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(message) {
    if (message.id === undefined) throw new Error('MCP request id is required');
    const key = JSON.stringify(message.id);
    if (this.pending.has(key)) throw new Error(`Duplicate MCP request id: ${key}`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Apple Events MCP timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(key, { resolve, reject, timer });
      try {
        this.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(error);
      }
    });
  }

  close() {
    this.child.kill('SIGTERM');
  }
}

const readJsonBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
};

export const createAppleEventsBridge = ({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  token = '',
  allowedOrigins = [],
  command,
  args = [],
  childEnv = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
} = {}) => {
  if (!command) throw new Error('APPLE_EVENTS_COMMAND is required');
  if (!isLoopbackHost(host) && !token) {
    throw new Error('LILIUM_MCP_TOKEN is required when listening beyond localhost');
  }

  const origins = new Set(allowedOrigins);
  const sessions = new Map();
  let sweepTimer = null;

  const dropSession = (id) => {
    const session = sessions.get(id);
    if (!session) return false;
    sessions.delete(id);
    session.close();
    return true;
  };

  // Clients never send DELETE: browser tabs just close and worker calls are one-shot.
  // Idle sessions must be reclaimed here, or each one keeps an EventKit child alive forever.
  const sweepIdleSessions = (now = Date.now()) => {
    let closed = 0;
    for (const [id, session] of sessions) {
      if (now - session.lastUsedAt < idleTimeoutMs) continue;
      sessions.delete(id);
      session.close();
      closed += 1;
    }
    if (closed) process.stderr.write(`[apple-events] Closed ${closed} idle session(s)\n`);
    return closed;
  };

  const corsHeaders = (origin) => {
    if (!origin || !origins.has(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id',
      Vary: 'Origin',
    };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { status: 'ok', sessions: sessions.size });
    }
    if (url.pathname !== '/mcp') return json(res, 404, { error: 'Not found' });

    const origin = req.headers.origin;
    const cors = corsHeaders(origin);
    if (origin && !origins.has(origin)) return json(res, 403, { error: 'Origin not allowed' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }

    if (token) {
      const auth = String(req.headers.authorization || '');
      if (!auth.startsWith('Bearer ') || !safeTokenEqual(auth.slice(7), token)) {
        return json(res, 401, { error: 'Unauthorized' }, cors);
      }
    }

    const sessionId = String(req.headers['mcp-session-id'] || '');
    if (req.method === 'DELETE') {
      if (!dropSession(sessionId)) return json(res, 404, { error: 'Unknown MCP session' }, cors);
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }, cors);

    try {
      const message = await readJsonBody(req);
      let session;
      let responseSessionId = sessionId;

      if (message.method === 'initialize') {
        // A re-handshake means the client dropped the old session; close it or the child is orphaned.
        if (sessionId) dropSession(sessionId);
        responseSessionId = randomUUID();
        session = new StdioSession({
          command,
          args,
          env: childEnv,
          timeoutMs,
          onExit: () => sessions.delete(responseSessionId),
        });
        sessions.set(responseSessionId, session);
      } else {
        session = sessions.get(sessionId);
        if (!session) return json(res, 400, { error: 'Missing or unknown Mcp-Session-Id' }, cors);
      }

      if (message.id === undefined) {
        session.send(message);
        res.writeHead(202, cors);
        return res.end();
      }

      try {
        const response = await session.request(message);
        return json(res, 200, response, {
          ...cors,
          ...(message.method === 'initialize' ? { 'Mcp-Session-Id': responseSessionId } : {}),
        });
      } catch (error) {
        if (message.method === 'initialize') dropSession(responseSessionId);
        throw error;
      }
    } catch (error) {
      const status = Number(error?.status) || 502;
      return json(res, status, { error: error instanceof Error ? error.message : String(error) }, cors);
    }
  });

  return {
    server,
    sessions,
    sweepIdleSessions,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        sweepTimer = setInterval(() => sweepIdleSessions(), sweepIntervalMs);
        sweepTimer.unref?.();
        resolve(server.address());
      });
    }),
    close: () => new Promise((resolve, reject) => {
      if (sweepTimer) clearInterval(sweepTimer);
      sweepTimer = null;
      for (const session of sessions.values()) session.close();
      sessions.clear();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
};

const main = async () => {
  const host = process.env.LILIUM_MCP_HOST || DEFAULT_HOST;
  const port = Number(process.env.LILIUM_MCP_PORT || DEFAULT_PORT);
  const command = process.env.APPLE_EVENTS_COMMAND;
  const args = process.env.APPLE_EVENTS_ARGS_JSON ? JSON.parse(process.env.APPLE_EVENTS_ARGS_JSON) : [];
  const bridge = createAppleEventsBridge({
    host,
    port,
    command,
    args,
    token: process.env.LILIUM_MCP_TOKEN || '',
    allowedOrigins: parseOrigins(process.env.LILIUM_ALLOWED_ORIGINS),
    childEnv: process.env,
    idleTimeoutMs: Number(process.env.LILIUM_MCP_SESSION_IDLE_MS || DEFAULT_IDLE_TIMEOUT_MS),
  });
  await bridge.listen();
  console.log(`LiliumOS Apple Events bridge listening on http://${host}:${port}`);

  const shutdown = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
