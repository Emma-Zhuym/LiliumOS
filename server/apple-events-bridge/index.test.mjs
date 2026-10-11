import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAppleEventsBridge } from './index.mjs';

const mockCommand = process.execPath;
const mockArgs = [fileURLToPath(new URL('./fixtures/mock-mcp.mjs', import.meta.url))];

const startBridge = async (options = {}) => {
  const bridge = createAppleEventsBridge({
    host: '127.0.0.1',
    port: 0,
    command: mockCommand,
    args: mockArgs,
    timeoutMs: 2_000,
    ...options,
  });
  const address = await bridge.listen();
  return { bridge, baseUrl: `http://127.0.0.1:${address.port}` };
};

const initialize = async (baseUrl, headers = {}) => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'bridge-test', version: '0.1.0' },
      },
    }),
  });
  return { response, sessionId: response.headers.get('mcp-session-id') };
};

test('proxies initialize, notifications, tools/list, and tools/call', async (t) => {
  const { bridge, baseUrl } = await startBridge();
  t.after(() => bridge.close());

  const health = await fetch(`${baseUrl}/health`);
  assert.deepEqual(await health.json(), { status: 'ok', sessions: 0 });

  const { response, sessionId } = await initialize(baseUrl);
  assert.equal(response.status, 200);
  assert.ok(sessionId);
  assert.equal((await response.json()).result.serverInfo.name, 'mock-apple-events');

  const notification = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(notification.status, 202);

  const list = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  assert.equal((await list.json()).result.tools[0].name, 'calendar_calendars');

  const call = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'calendar_calendars', arguments: { action: 'read' } },
    }),
  });
  assert.equal((await call.json()).result.content[0].text, 'called:calendar_calendars');
});

test('requires bearer auth when configured', async (t) => {
  const { bridge, baseUrl } = await startBridge({ token: 'test-secret' });
  t.after(() => bridge.close());

  assert.equal((await initialize(baseUrl)).response.status, 401);
  const authed = await initialize(baseUrl, { Authorization: 'Bearer test-secret' });
  assert.equal(authed.response.status, 200);
});

test('allows configured browser origins and rejects others', async (t) => {
  const allowed = 'https://emma-zhuym.github.io';
  const { bridge, baseUrl } = await startBridge({ allowedOrigins: [allowed] });
  t.after(() => bridge.close());

  const accepted = await initialize(baseUrl, { Origin: allowed });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.response.headers.get('access-control-allow-origin'), allowed);

  const rejected = await initialize(baseUrl, { Origin: 'https://example.com' });
  assert.equal(rejected.response.status, 403);
});

test('refuses non-loopback listeners without a token', () => {
  assert.throws(
    () => createAppleEventsBridge({ host: '0.0.0.0', command: mockCommand, args: mockArgs }),
    /LILIUM_MCP_TOKEN is required/,
  );
});

test('reclaims sessions that have been idle past the timeout', async (t) => {
  const { bridge, baseUrl } = await startBridge({ idleTimeoutMs: 30 * 60 * 1000 });
  t.after(() => bridge.close());

  const { sessionId } = await initialize(baseUrl);
  assert.equal(bridge.sessions.size, 1);

  assert.equal(bridge.sweepIdleSessions(Date.now() + 29 * 60 * 1000), 0);
  assert.equal(bridge.sessions.size, 1);

  assert.equal(bridge.sweepIdleSessions(Date.now() + 31 * 60 * 1000), 1);
  assert.equal(bridge.sessions.size, 0);

  const orphaned = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }),
  });
  assert.equal(orphaned.status, 400);
});

test('keeps a session alive while it is still being used', async (t) => {
  const { bridge, baseUrl } = await startBridge({ idleTimeoutMs: 30 * 60 * 1000 });
  t.after(() => bridge.close());

  const { sessionId } = await initialize(baseUrl);
  const madeUpNow = Date.now() + 31 * 60 * 1000;

  await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }),
  });

  assert.equal(bridge.sweepIdleSessions(), 0);
  assert.equal(bridge.sessions.size, 1);
  assert.equal(bridge.sweepIdleSessions(madeUpNow), 1);
});

test('re-handshaking closes the session the client abandoned', async (t) => {
  const { bridge, baseUrl } = await startBridge();
  t.after(() => bridge.close());

  const first = await initialize(baseUrl);
  assert.equal(bridge.sessions.size, 1);

  const second = await initialize(baseUrl, { 'Mcp-Session-Id': first.sessionId });
  assert.equal(second.response.status, 200);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(bridge.sessions.size, 1);
  assert.ok(bridge.sessions.has(second.sessionId));
});
