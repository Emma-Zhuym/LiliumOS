// Vertex AI（现名 Gemini 平台 / Agent Platform）→ OpenAI 兼容接口的小转接，只听本机。
// 凭据是 mini 上 gcloud 的 ADC（应用默认凭据）登录态：不产生任何密钥文件，令牌每小时由 gcloud 自动换。
// 对外只经 Funnel 网关 /vertex/v1/*（scripts/home-assistant-proxy.mjs）；调用方带固定 Bearer（secrets/vertex-proxy-token）。
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 20 * 1024 * 1024; // 带图的请求
const TOKEN_TTL_MS = 45 * 60 * 1000; // ADC 令牌一小时有效，提前换
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // Pro 想得久

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const safeTokenEqual = (actual, expected) => {
  const a = Buffer.from(actual || '');
  const b = Buffer.from(expected || '');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

/** global 用 aiplatform.googleapis.com，其余区域加前缀 */
export const vertexBaseUrl = (project, location) => {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/endpoints/openapi`;
};

/** Vertex 的 OpenAI 接口要 `google/gemini-…`；调用方写裸名也认 */
export const toVertexModel = (model) => {
  const name = String(model || '').trim();
  if (!name) return name;
  return name.includes('/') ? name : `google/${name}`;
};

/**
 * Vertex 出错时回的是数组 `[{"error":{…}}]`，酒馆等 OpenAI 客户端认不出来，会一声不吭地停掉。
 * 统一成 `{"error":{message,type,code}}`。
 */
export const normalizeVertexError = (status, text) => {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 不是 JSON */ }
  const inner = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
  const message = typeof inner === 'string'
    ? inner
    : (inner?.message || String(text || '').trim().slice(0, 500) || `Vertex HTTP ${status}`);
  const label = status === 429 ? 'Vertex 容量满了（429，不是赠金用完），稍后再试：' : '';
  return {
    error: {
      message: `${label}${message}`,
      type: status === 429 ? 'rate_limit_error' : 'upstream_error',
      code: inner?.status || status,
    },
  };
};

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new Error('aborted')); }, { once: true });
});

export const parseModelList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim().replace(/^google\//, ''))
  .filter(Boolean);

/** 用 gcloud 换 ADC 令牌，缓存 45 分钟；401 时 invalidate 再换一次 */
export const createGcloudTokenSource = ({ gcloud, env, ttlMs = TOKEN_TTL_MS, now = () => Date.now(), run } = {}) => {
  const exec = run || ((cmd, args, opts) => new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (error, stdout, stderr) => {
      if (error) reject(new Error(`gcloud 换令牌失败：${String(stderr || error.message).trim().slice(0, 300)}`));
      else resolve(String(stdout));
    });
  }));
  let cached = null;
  let inflight = null;
  return {
    async get() {
      if (cached && cached.expiresAt > now()) return cached.token;
      if (!inflight) {
        inflight = exec(gcloud, ['auth', 'application-default', 'print-access-token'], { env, timeout: 30_000 })
          .then((out) => {
            const token = out.trim();
            if (!token) throw new Error('gcloud 没有返回令牌');
            cached = { token, expiresAt: now() + ttlMs };
            return token;
          })
          .finally(() => { inflight = null; });
      }
      return inflight;
    },
    invalidate() { cached = null; },
  };
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(Object.assign(new Error('请求太大'), { status: 413 }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

export const createVertexProxyHandler = ({
  apiToken,
  project,
  location = 'global',
  models = [],
  tokenSource,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelaysMs = [2000, 5000], // 429 是共享容量挤满，隔几秒常常就通了
  log = (line) => process.stdout.write(`${line}\n`),
}) => {
  if (!apiToken) throw new Error('缺少 apiToken');
  if (!project) throw new Error('缺少 project');
  const base = vertexBaseUrl(project, location);

  const callUpstream = async (body, signal) => {
    const send = async () => fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await tokenSource.get()}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': project,
      },
      body,
      signal,
    });
    let upstream = await send();
    if (upstream.status === 401) {
      await upstream.body?.cancel?.();
      tokenSource.invalidate();
      upstream = await send();
    }
    return upstream;
  };

  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true, service: 'vertex-proxy', project, location });
      return;
    }

    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!safeTokenEqual(bearer, apiToken)) {
      json(res, 401, { error: { message: 'Unauthorized', type: 'invalid_request_error' } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      json(res, 200, {
        object: 'list',
        data: models.map((id) => ({ id, object: 'model', owned_by: 'google' })),
      });
      return;
    }

    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      json(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
      return;
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8'));
    } catch (error) {
      json(res, error.status || 400, { error: { message: error.status ? error.message : '请求不是合法 JSON', type: 'invalid_request_error' } });
      return;
    }
    const requested = String(payload?.model || '');
    payload.model = toVertexModel(requested);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    res.on('close', () => { if (!res.writableEnded) controller.abort(new Error('client closed')); });
    const startedAt = Date.now();
    try {
      const body = JSON.stringify(payload);
      let upstream = await callUpstream(body, controller.signal);
      for (const delay of retryDelaysMs) {
        if (upstream.status !== 429) break;
        await upstream.body?.cancel?.();
        log(`[vertex-proxy] ${payload.model} 429, retry in ${delay}ms`);
        await sleep(delay, controller.signal);
        upstream = await callUpstream(body, controller.signal);
      }
      if (!upstream.ok) {
        const text = await upstream.text();
        json(res, upstream.status, normalizeVertexError(upstream.status, text));
        log(`[vertex-proxy] ${payload.model} ${upstream.status} ${Date.now() - startedAt}ms${payload.stream ? ' stream' : ''}`);
        return;
      }
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      if (upstream.body) {
        await new Promise((resolve, reject) => {
          const stream = Readable.fromWeb(upstream.body);
          stream.on('error', reject);
          res.on('finish', resolve);
          res.on('close', resolve);
          stream.pipe(res);
        });
      } else {
        res.end();
      }
      // 只记模型、状态、耗时，不记正文
      log(`[vertex-proxy] ${payload.model} ${upstream.status} ${Date.now() - startedAt}ms${payload.stream ? ' stream' : ''}`);
    } catch (error) {
      const timedOut = controller.signal.aborted && String(controller.signal.reason?.message) === 'timeout';
      log(`[vertex-proxy] ${payload.model} failed ${Date.now() - startedAt}ms: ${String(error?.message || error).slice(0, 200)}`);
      if (!res.headersSent) {
        json(res, timedOut ? 504 : 502, { error: { message: timedOut ? 'Vertex 超时' : `Vertex 请求失败：${String(error?.message || error).slice(0, 200)}`, type: 'upstream_error' } });
      } else {
        res.destroy();
      }
    } finally {
      clearTimeout(timer);
    }
  };
};

const main = () => {
  const host = process.env.VERTEX_PROXY_HOST || '127.0.0.1';
  const port = Number(process.env.VERTEX_PROXY_PORT || 2060);
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    process.stderr.write('vertex-proxy 只许听本机\n');
    process.exit(1);
  }
  const tokenSource = createGcloudTokenSource({
    gcloud: process.env.GCLOUD_BIN || '/opt/homebrew/share/google-cloud-sdk/bin/gcloud',
    env: { ...process.env, CLOUDSDK_CONFIG: process.env.CLOUDSDK_CONFIG },
  });
  const handler = createVertexProxyHandler({
    apiToken: process.env.VERTEX_PROXY_TOKEN,
    project: process.env.VERTEX_PROJECT,
    location: process.env.VERTEX_LOCATION || 'global',
    models: parseModelList(process.env.VERTEX_MODELS),
    tokenSource,
  });
  createServer((req, res) => { handler(req, res).catch((error) => {
    process.stderr.write(`[vertex-proxy] ${error?.stack || error}\n`);
    if (!res.headersSent) json(res, 500, { error: { message: 'internal error' } });
  }); }).listen(port, host, () => {
    process.stdout.write(`[vertex-proxy] listening on http://${host}:${port} (${process.env.VERTEX_LOCATION || 'global'})\n`);
  });
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
