import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error 中心 Worker 是部署用纯 JS 文件
import worker from './index.js';

const callProxy = (path: string, body: Record<string, unknown>, auth = 'Bearer image-key') => worker.fetch(
  new Request(`https://proxy.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://emma-zhuym.github.io',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  }),
  {},
  { waitUntil: () => {} },
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/image-generation proxy', () => {
  it('forwards text generation without forcing a size', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await callProxy('/image-generation', {
      baseUrl: 'https://images.example/v1/images/generations',
      model: 'image-model',
      prompt: 'a quiet room',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://emma-zhuym.github.io');
    expect(calls[0].url).toBe('https://images.example/v1/images/generations');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Headers).get('Authorization')).toBe('Bearer image-key');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ model: 'image-model', prompt: 'a quiet room', n: 1 });
  });

  it('uses the singular image field for edits', async () => {
    let form: FormData | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      form = init.body as FormData;
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/result.png' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await callProxy('/image-generation', {
      baseUrl: 'https://images.example/v1',
      model: 'image-model',
      prompt: 'same person at home',
      referenceImageDataUrl: 'data:image/png;base64,QUJD',
    });

    expect(response.status).toBe(200);
    expect(form?.get('image')).toBeInstanceOf(Blob);
    expect(form?.get('image[]')).toBeNull();
  });

  it('blocks private or non-HTTPS upstreams before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const privateResponse = await callProxy('/image-generation', {
      baseUrl: 'http://127.0.0.1:8188/v1', model: 'm', prompt: 'p',
    });
    expect(privateResponse.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies the model list with GET', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ data: [{ id: 'image-model' }] }), { status: 200 });
    }));

    const response = await callProxy('/image-generation/models', { baseUrl: 'https://images.example/v1/images' });
    expect(response.status).toBe(200);
    expect(calls[0]).toMatchObject({ url: 'https://images.example/v1/models' });
    expect(calls[0].init.method).toBe('GET');
  });
});
