import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ActiveMsgStore } from './activeMsgStore';
import type { ActiveMsg2InboxMessage } from '../types';
const installed = vi.hoisted(() => ({ business: null as ((payload: any) => Promise<void>) | null }));
vi.mock('@rei-standard/amsg-sw', () => ({ installReiSW: (_sw: unknown, options: any) => { installed.business = options.onBusinessPayload; } }));
const posted = vi.fn();
const events = new Map<string, (event: any) => void>();
const matches = vi.fn(async () => [{ visibilityState: 'hidden', url: 'https://example.test/app?secret=private#token', postMessage: posted }]);
beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('self', { clients: { matchAll: matches }, addEventListener: (type: string, fn: (event: any) => void) => events.set(type, fn) });
  await import('../worker/sw-keep-alive');
});
afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const inbox = (id: string, time: number): ActiveMsg2InboxMessage => ({ messageId: id, charId: 'delivery-test', charName: 'Test', body: 'Recovered', receivedAt: time, metadata: { amsgOutboxBackfill: true } });
const push = (id: string) => installed.business!({ messageId: id, metadata: { charId: 'delivery-test' }, message: 'Live', messageKind: 'content' });
const get = async (id: string) => (await ActiveMsgStore.listInboxMessages()).find(row => row.messageId === id)!;

describe('real page and service worker delivery writers', () => {
  it('keeps the first SW arrival time and hidden state when the page backfills', async () => {
    const id = 'em-inbox-sw-first'; await push(id); const original = await get(id);
    await ActiveMsgStore.saveInboxMessage(inbox(id, original.receivedAt + 1000));
    expect(await get(id)).toMatchObject({ receivedAt: original.receivedAt, receivedWhileVisible: false, body: 'Recovered', metadata: { amsgOutboxBackfill: true } });
  });
  it('keeps backfill time and marker when a delayed SW notification arrives', async () => {
    const id = 'em-inbox-page-first'; await ActiveMsgStore.saveInboxMessage(inbox(id, 1000)); await push(id);
    expect(await get(id)).toMatchObject({ receivedAt: 1000, metadata: { amsgOutboxBackfill: true }, body: 'Live' });
  });
  it('concurrent page delivery replacements preserve the first committed arrival and one inbox row', async () => {
    const id = 'em-inbox-race';
    await Promise.all([ActiveMsgStore.saveInboxMessage(inbox(id, 2000)), ActiveMsgStore.saveInboxMessage({ ...inbox(id, 3000), body: 'second' }), push(id)]);
    const rows = (await ActiveMsgStore.listInboxMessages()).filter(row => row.messageId === id);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ receivedAt: 2000, metadata: { amsgOutboxBackfill: true } });
  });
  it('aborted replacement rejects and retains the previous delivery', async () => {
    const id = 'em-inbox-abort'; await ActiveMsgStore.saveInboxMessage(inbox(id, 4000));
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
      const result = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (this.name === 'inbox' && value.messageId === id) this.transaction.abort();
      return result;
    });
    try { await expect(ActiveMsgStore.saveInboxMessage({ ...inbox(id, 5000), body: 'lost' })).rejects.toThrow(); }
    finally { spy.mockRestore(); }
    expect(await get(id)).toMatchObject({ receivedAt: 4000, body: 'Recovered' });
  });
  it('SW probe answers through both the reply port and the actual clients path', async () => {
    const port = vi.fn(), waits: Promise<unknown>[] = []; posted.mockClear();
    events.get('message')!({ data: { type: 'SW_CHANNEL_PROBE', nonce: 'probe-test' }, ports: [{ postMessage: port }], waitUntil: (work: Promise<unknown>) => waits.push(work) });
    await Promise.all(waits);
    expect(port).toHaveBeenCalledWith(expect.objectContaining({ type: 'sw-channel-probe-port-ack', nonce: 'probe-test' }));
    expect(posted).toHaveBeenCalledWith(expect.objectContaining({ type: 'sw-channel-probe-ack', nonce: 'probe-test' }));
    const { readSwTraceEntries } = await import('./swTraceStore');
    await vi.waitFor(async () => expect(JSON.stringify(await readSwTraceEntries())).toContain('notify-clients'));
    expect(JSON.stringify(await readSwTraceEntries())).not.toContain('secret=private');
  });
});
