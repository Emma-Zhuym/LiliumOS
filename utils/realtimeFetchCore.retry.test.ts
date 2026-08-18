import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./proxyWorker', () => ({
  getProxyWorkerUrl: () => 'https://worker.test',
}));

import { notionGetDiaryByDate, notionGetRecentDiaries, notionReadDiaryContent } from './realtimeFetchCore';

const response = (status: number, body: unknown): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('Notion read retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a transient network failure and then returns the diary query', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = notionGetDiaryByDate('key', 'db', '测试角色', '2026-08-01');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ success: true, entries: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries Load failed while fetching recent diaries', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(response(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = notionGetRecentDiaries('key', 'db', '测试角色');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ success: true, entries: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx responses but does not retry an authentication error', async () => {
    const transientFetch = vi.fn()
      .mockResolvedValueOnce(response(503, { error: 'busy' }))
      .mockResolvedValueOnce(response(200, { results: [] }));
    vi.stubGlobal('fetch', transientFetch);

    const pending = notionReadDiaryContent('key', 'page');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ success: true, content: '（空白日记）' });
    expect(transientFetch).toHaveBeenCalledTimes(2);

    const authFetch = vi.fn().mockResolvedValue(response(401, { error: 'unauthorized' }));
    vi.stubGlobal('fetch', authFetch);
    await expect(notionReadDiaryContent('bad-key', 'page')).resolves.toMatchObject({
      success: false,
      message: '读取失败: 401',
    });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
});
