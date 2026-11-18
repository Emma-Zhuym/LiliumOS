import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  createVertexProxyHandler,
  createGcloudTokenSource,
  toVertexModel,
  vertexBaseUrl,
  parseModelList,
} from './index.mjs';

const TOKEN = 'test-proxy-token';

const startProxy = async (opts) => {
  const handler = createVertexProxyHandler({ apiToken: TOKEN, project: 'p1', log: () => {}, ...opts });
  const server = createServer((req, res) => { handler(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
};

const fakeTokens = () => {
  let n = 0;
  return { get: async () => `adc-${++n}`, invalidate() {}, get count() { return n; } };
};

test('模型名补 google/ 前缀，区域决定域名', () => {
  assert.equal(toVertexModel('gemini-3.8-flash'), 'google/gemini-3.8-flash');
  assert.equal(toVertexModel('google/gemini-3.8-flash'), 'google/gemini-3.8-flash');
  assert.equal(vertexBaseUrl('p1', 'global'), 'https://aiplatform.googleapis.com/v1/projects/p1/locations/global/endpoints/openapi');
  assert.equal(vertexBaseUrl('p1', 'us-central1'), 'https://us-central1-aiplatform.googleapis.com/v1/projects/p1/locations/us-central1/endpoints/openapi');
  assert.deepEqual(parseModelList(' google/a , b,,'), ['a', 'b']);
});

test('没带或带错 key 一律 401，不碰上游', async () => {
  let called = 0;
  const proxy = await startProxy({ tokenSource: fakeTokens(), fetchImpl: async () => { called += 1; } });
  try {
    for (const headers of [{}, { Authorization: 'Bearer nope' }]) {
      const r = await fetch(`${proxy.url}/v1/chat/completions`, { method: 'POST', headers, body: '{}' });
      assert.equal(r.status, 401);
    }
    assert.equal(called, 0);
  } finally { await proxy.close(); }
});

test('转发到 Vertex：ADC 令牌、计费项目、补前缀', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '好' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const proxy = await startProxy({ tokenSource: fakeTokens(), fetchImpl });
  try {
    const r = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, '好');
    assert.equal(seen.url, 'https://aiplatform.googleapis.com/v1/projects/p1/locations/global/endpoints/openapi/chat/completions');
    assert.equal(seen.init.headers.Authorization, 'Bearer adc-1');
    assert.equal(seen.init.headers['x-goog-user-project'], 'p1');
    assert.equal(seen.body.model, 'google/gemini-3.8-flash');
  } finally { await proxy.close(); }
});

test('上游 401 时换一次令牌重试', async () => {
  let invalidated = 0;
  let n = 0;
  const tokenSource = { get: async () => `adc-${n}`, invalidate() { invalidated += 1; n += 1; } };
  const auths = [];
  const fetchImpl = async (_url, init) => {
    auths.push(init.headers.Authorization);
    return auths.length === 1
      ? new Response('{}', { status: 401 })
      : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const proxy = await startProxy({ tokenSource, fetchImpl });
  try {
    const r = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ model: 'x' }),
    });
    assert.equal(r.status, 200);
    assert.equal(invalidated, 1);
    assert.deepEqual(auths, ['Bearer adc-0', 'Bearer adc-1']);
  } finally { await proxy.close(); }
});

test('流式响应原样转出', async () => {
  const chunks = ['data: {"a":1}\n\n', 'data: [DONE]\n\n'];
  const fetchImpl = async () => new Response(new ReadableStream({
    start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const proxy = await startProxy({ tokenSource: fakeTokens(), fetchImpl });
  try {
    const r = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ model: 'x', stream: true }),
    });
    assert.equal(r.headers.get('content-type'), 'text/event-stream');
    assert.equal(await r.text(), chunks.join(''));
  } finally { await proxy.close(); }
});

test('/v1/models 列配置的模型；其他路径 404；/health 不要 key', async () => {
  const proxy = await startProxy({ tokenSource: fakeTokens(), models: ['gemini-3.8-flash'], fetchImpl: async () => { throw new Error('no'); } });
  try {
    const m = await fetch(`${proxy.url}/v1/models`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.deepEqual((await m.json()).data.map((d) => d.id), ['gemini-3.8-flash']);
    const other = await fetch(`${proxy.url}/v1/files`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(other.status, 404);
    const health = await fetch(`${proxy.url}/health`);
    assert.equal(health.status, 200);
  } finally { await proxy.close(); }
});

test('上游连不上回 502', async () => {
  const proxy = await startProxy({ tokenSource: fakeTokens(), fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  try {
    const r = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ model: 'x' }),
    });
    assert.equal(r.status, 502);
  } finally { await proxy.close(); }
});

test('gcloud 令牌缓存到期前不重复换，invalidate 后重换', async () => {
  let calls = 0;
  let t = 0;
  const src = createGcloudTokenSource({ gcloud: 'g', run: async () => `tok${++calls}\n`, now: () => t, ttlMs: 100 });
  assert.equal(await src.get(), 'tok1');
  assert.equal(await src.get(), 'tok1');
  t = 200;
  assert.equal(await src.get(), 'tok2');
  src.invalidate();
  assert.equal(await src.get(), 'tok3');
});

test('Vertex 的数组报错转成 OpenAI 格式，429 说清楚不是赠金用完', async () => {
  const vertexBody = JSON.stringify([{ error: { code: 429, message: 'Resource exhausted.', status: 'RESOURCE_EXHAUSTED' } }]);
  const proxy = await startProxy({ tokenSource: fakeTokens(), retryDelaysMs: [], fetchImpl: async () => new Response(vertexBody, { status: 429 }) });
  try {
    const r = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ model: 'x', stream: true }),
    });
    assert.equal(r.status, 429);
    assert.match(r.headers.get('content-type'), /application\/json/);
    const d = await r.json();
    assert.equal(d.error.type, 'rate_limit_error');
    assert.equal(d.error.code, 'RESOURCE_EXHAUSTED');
    assert.match(d.error.message, /不是赠金用完.*Resource exhausted/);
  } finally { await proxy.close(); }
});

test('429 自动重试，后一次通了就正常返回', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls < 3
    ? new Response('[{"error":{"code":429}}]', { status: 429 })
    : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
  const proxy = await startProxy({ tokenSource: fakeTokens(), retryDelaysMs: [1, 1], fetchImpl });
  try {
    const r = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ model: 'x' }),
    });
    assert.equal(r.status, 200);
    assert.equal(calls, 3);
  } finally { await proxy.close(); }
});

test('非 JSON 的报错也给出 OpenAI 格式', async () => {
  const proxy = await startProxy({ tokenSource: fakeTokens(), retryDelaysMs: [], fetchImpl: async () => new Response('bad gateway', { status: 503 }) });
  try {
    const r = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ model: 'x' }),
    });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.message, 'bad gateway');
  } finally { await proxy.close(); }
});
