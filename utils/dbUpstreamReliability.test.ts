import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { FullBackupData, Message, XhsOwnedPost } from '../types';

let connection: IDBDatabase | undefined;
beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { connection?.close(); connection = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const load = async () => { const module = await import('./db'); connection = await module.openDB(); return module.DB; };
const message = (charId: string) => ({ charId, role: 'assistant' as const, type: 'text' as const, content: '已经送达', timestamp: 123 });

describe('database upgrade and delivery reliability', () => {
    it('upgrades a v70 fixture without replacing characters, agenda or favorite metadata', async () => {
        const records = {
            characters: { id: 'emma-char', name: '保留角色', avatar: 'asset:avatar-id', chatApiPresetId: 'my-api' },
            agenda: { id: 'agenda-1', title: '保留日程', dateTime: '2026-09-12T17:05' },
            assets: { id: 'local-asset', data: '保留素材' },
            gallery: { id: 'photo-1', charId: 'emma-char', url: 'asset:photo', favorited: true, favoriteOrigins: { user: true, characters: { friend: { name: '朋友', favoritedAt: 1 } } } },
        };
        await new Promise<void>((resolve, reject) => {
            const open = indexedDB.open('AetherOS_Data', 70);
            open.onupgradeneeded = () => { for (const [name, record] of Object.entries(records)) {
                const store = open.result.createObjectStore(name, { keyPath: 'id' });
                if (name === 'gallery') store.createIndex('charId', 'charId');
                store.put(record);
            } };
            open.onsuccess = () => { open.result.close(); resolve(); }; open.onerror = () => reject(open.error);
        });
        const DB = await load();
        expect(connection?.version).toBe(72);
        expect(connection?.objectStoreNames.contains('xhs_owned_posts')).toBe(true);
        expect(await DB.getAllXhsOwnedPosts()).toEqual([]);
        for (const [name, record] of Object.entries(records)) expect(await DB.getRawStoreData(name)).toEqual([record]);
    });

    it('commits one message per delivery and preserves timestamp on concurrent retries', async () => {
        const DB = await load();
        const ids = await Promise.all([DB.saveMessageOnce('one', message('c')), DB.saveMessageOnce('one', message('c')), DB.saveMessageOnce('two', message('c'))]);
        expect(ids[0]).toBe(ids[1]); expect(ids[2]).not.toBe(ids[0]);
        const saved = await DB.getMessagesByCharId('c', true);
        expect(saved).toHaveLength(2); expect(saved.every(item => item.timestamp === 123)).toBe(true);
        const originalAdd = IDBObjectStore.prototype.add;
        const fail = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: any[]) {
            const request = originalAdd.apply(this, args as [any]);
            if (this.name === 'messages') request.addEventListener('success', () => this.transaction.abort());
            return request;
        });
        await expect(DB.saveMessageOnce('retry', message('retry-char'))).rejects.toBeTruthy();
        fail.mockRestore(); expect(await DB.getMessagesByCharId('retry-char', true)).toEqual([]);
        await DB.saveMessageOnce('retry', message('retry-char'));
        expect(await DB.getMessagesByCharId('retry-char', true)).toHaveLength(1);
    });

    it('fills a filtered display window past non-chat rows without reading the whole history', async () => {
        const DB = await load();
        const first = await DB.saveMessage({ ...message('c'), content: '第一条' });
        await DB.saveMessage({ ...message('c'), content: '第二条' });
        await DB.saveMessage({ ...message('c'), content: '见面对白', metadata: { scene: 'date' } });
        await DB.saveMessage({ ...message('c'), content: '群聊', groupId: 'group' });
        const allRead = vi.spyOn(IDBIndex.prototype, 'getAll');
        const view = await DB.getRecentMessagesWithCount('c', 2, (m: Message) => m.metadata?.scene !== 'date');
        expect(view.messages.map(m => m.content)).toEqual(['第一条', '第二条']);
        expect((await DB.getMessagesFromId('c', first + 1)).messages.map(m => m.content)).toEqual(['第二条', '见面对白']);
        expect(allRead).not.toHaveBeenCalled();
    });

    it('restores v71 compatibility records, distinguishes absent from empty, and leaves ordinary messages alone', async () => {
        const DB = await load();
        await DB.saveMessage(message('keep'));
        const post: XhsOwnedPost = { id: 'c:post', characterId: 'c', noteId: 'post', title: '兼容记录', body: '原文', publishedAt: 1, updatedAt: 1 };
        await DB.importFullData({ xhsOwnedPosts: [post] } as FullBackupData);
        expect((await DB.exportFullData()).xhsOwnedPosts).toEqual([post]);
        await expect(DB.importFullData({ xhsOwnedPosts: [{ title: '缺少主键' }] } as unknown as FullBackupData)).rejects.toBeTruthy();
        expect(await DB.getAllXhsOwnedPosts()).toEqual([post]);
        await DB.importFullData({ xhsActivities: [] } as unknown as FullBackupData);
        expect(await DB.getAllXhsOwnedPosts()).toEqual([post]);
        await DB.importFullData({ xhsOwnedPosts: [] } as unknown as FullBackupData);
        expect(await DB.getAllXhsOwnedPosts()).toEqual([]);
        expect(await DB.getMessagesByCharId('keep', true)).toHaveLength(1);
    });
});
