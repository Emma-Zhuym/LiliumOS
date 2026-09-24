// [EM-START: moments]
/**
 * 朋友圈的本地存储（IndexedDB：LiliumOS_Moments）。
 * posts = 用户自己发的动态；interactions = 所有动态（含角色的）的点赞和评论；settings = 各角色上次刷朋友圈的时间等。
 */

import type { MomentInteractions, UserMomentPost } from './moments';

const DB_NAME = 'LiliumOS_Moments';
const DB_VERSION = 1;
const STORE_POSTS = 'posts';
const STORE_INTERACTIONS = 'interactions';
const STORE_SETTINGS = 'settings';

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_POSTS)) db.createObjectStore(STORE_POSTS, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORE_INTERACTIONS)) db.createObjectStore(STORE_INTERACTIONS, { keyPath: 'postId' });
            if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        };
    });
}

async function getAll<T>(store: string): Promise<T[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function putMany(store: string, values: unknown[]): Promise<void> {
    if (values.length === 0) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        for (const value of values) tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function del(store: string, key: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export interface MomentsBackup {
    posts?: UserMomentPost[];
    interactions?: MomentInteractions[];
    settings?: { key: string; value: unknown }[];
}

export const MomentsDB = {
    getPosts: () => getAll<UserMomentPost>(STORE_POSTS),
    savePost: (post: UserMomentPost) => putMany(STORE_POSTS, [post]),
    deletePost: async (id: string) => { await del(STORE_POSTS, id); await del(STORE_INTERACTIONS, id); },

    getInteractions: () => getAll<MomentInteractions>(STORE_INTERACTIONS),
    saveInteractions: (items: MomentInteractions[]) => putMany(STORE_INTERACTIONS, items),

    getSetting: async <T>(key: string): Promise<T | undefined> =>
        (await getAll<{ key: string; value: T }>(STORE_SETTINGS)).find(s => s.key === key)?.value,
    saveSetting: (key: string, value: unknown) => putMany(STORE_SETTINGS, [{ key, value }]),

    /** 文字备份不带图片（图片是 data URL，太大）；完整备份全带。 */
    exportAll: async (withImages: boolean): Promise<MomentsBackup> => {
        const [posts, interactions, settings] = await Promise.all([
            getAll<UserMomentPost>(STORE_POSTS),
            getAll<MomentInteractions>(STORE_INTERACTIONS),
            getAll<{ key: string; value: unknown }>(STORE_SETTINGS),
        ]);
        return { posts: withImages ? posts : posts.map(p => ({ ...p, images: [] })), interactions, settings };
    },

    importAll: async (data: MomentsBackup) => {
        // 文字备份里的图片是空的：恢复时保留本机已有的图，别被空数组盖掉
        const existingImages = new Map((await getAll<UserMomentPost>(STORE_POSTS)).map(p => [p.id, p.images]));
        const posts = data.posts?.map(p => (p.images?.length ? p : { ...p, images: existingImages.get(p.id) ?? [] }));
        const db = await openDB();
        const stores = [
            data.posts !== undefined ? STORE_POSTS : null,
            data.interactions !== undefined ? STORE_INTERACTIONS : null,
            data.settings !== undefined ? STORE_SETTINGS : null,
        ].filter((s): s is string => !!s);
        if (stores.length === 0) return;
        const tx = db.transaction(stores, 'readwrite');
        for (const name of stores) tx.objectStore(name).clear();
        for (const p of posts ?? []) tx.objectStore(STORE_POSTS).put(p);
        for (const i of data.interactions ?? []) tx.objectStore(STORE_INTERACTIONS).put(i);
        for (const s of data.settings ?? []) tx.objectStore(STORE_SETTINGS).put(s);
        return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
};
// [EM-END: moments]
