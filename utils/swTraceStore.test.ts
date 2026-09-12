import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

let store: typeof import('./swTraceStore');
beforeEach(async () => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); store = await import('./swTraceStore'); });
afterEach(() => vi.unstubAllGlobals());
const seedV1 = (withStore = false) => new Promise<void>((resolve, reject) => {
  const request = indexedDB.open('ActiveMsgSwTrace', 1);
  request.onupgradeneeded = () => { if (withStore) request.result.createObjectStore('entries', { keyPath: 'seq', autoIncrement: true }).add({ event: 'old' }); };
  request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
});

describe('SW diagnostic storage', () => {
  it('reading before installation does not create an empty database, and later logging works', async () => {
    expect(await store.readSwTraceEntries()).toEqual([]);
    expect(await indexedDB.databases()).toEqual([]);
    await store.appendSwTraceEntry({ event: 'first' });
    expect((await store.readSwTraceEntries()).map(row => row.event)).toEqual(['first']);
  });
  it('repairs an existing empty v1 without touching other databases', async () => {
    await seedV1(); await store.appendSwTraceEntry({ event: 'repaired' });
    expect(await indexedDB.databases()).toEqual([{ name: 'ActiveMsgSwTrace', version: 2 }]);
    expect((await store.readSwTraceEntries())[0].event).toBe('repaired');
  });
  it('preserves old records and keeps the newest 300 entries under concurrent writes', async () => {
    await seedV1(true); await store.appendSwTraceEntry({ event: 'second' });
    expect((await store.readSwTraceEntries()).map(row => row.event)).toEqual(['old', 'second']);
    await Promise.all(Array.from({ length: 301 }, (_, i) => store.appendSwTraceEntry({ event: `new-${i}` })));
    const rows = await store.readSwTraceEntries();
    expect(rows).toHaveLength(300); expect(rows[0].event).toBe('new-1'); expect(rows.at(-1)?.event).toBe('new-300');
  });
  it('a blocked upgrade releases its late connection and retries after the old reader closes', async () => {
    await seedV1();
    const old = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('ActiveMsgSwTrace', 1); req.onsuccess = () => resolve(req.result); });
    await expect(store.appendSwTraceEntry({ event: 'blocked' })).rejects.toThrow('busy');
    old.close();
    await store.appendSwTraceEntry({ event: 'after-close' });
    expect((await store.readSwTraceEntries()).map(row => row.event)).toEqual(['after-close']);
  });
  it('merges both sides by time without exporting message bodies or credentials from the environment', async () => {
    const trace = await import('./instantTraceLog');
    localStorage.removeItem('instant_push_trace_log_v1');
    trace.appendInstantTraceEntry({ ts: '2026-09-12T12:00:02Z', event: 'page-test' });
    await store.appendSwTraceEntry({ ts: '2026-09-12T12:00:01Z', event: 'sw-test' });
    const result = JSON.parse(await trace.formatFullTraceLog());
    expect(result.count).toBe(2); expect(result.pageCount).toBe(1); expect(result.swCount).toBe(1);
    expect(result.entries.map((row: any) => row.side)).toEqual(['page', 'sw']);
    expect(result.env).not.toHaveProperty('apiKey');
  });
});
