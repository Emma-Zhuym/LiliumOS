// [EM-START: meet-extra]
/**
 * 番外的独立库 LiliumOS_MeetExtra（照 tietieDb 的写法）。
 * 全文只在这里和分享出去的那张卡上，不进记忆宫殿。
 */
import type { MeetExtra } from './meetExtra';

const DB_NAME = 'LiliumOS_MeetExtra';
const DB_VERSION = 1;
const STORE = 'extras';

/** 写了 / 改了 / 删了就广播一次（detail.id），书架和阅读页各自重读 */
export const MEET_EXTRA_CHANGED_EVENT = 'em-meet-extra-changed';

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('charId', 'charId', { unique: false });
            }
        };
    });
}

const announce = (id: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MEET_EXTRA_CHANGED_EVENT, { detail: { id } }));
};

async function readAll(): Promise<MeetExtra[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as MeetExtra[]).sort((a, b) => b.createdAt - a.createdAt));
        req.onerror = () => reject(req.error);
    });
}

async function putAll(rows: MeetExtra[]): Promise<void> {
    if (!rows.length) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        for (const row of rows) tx.objectStore(STORE).put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export const MeetExtraDB = {
    /** 全部，新的在前 */
    list: () => readAll(),

    get: async (id: string): Promise<MeetExtra | null> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
            req.onsuccess = () => resolve((req.result as MeetExtra) || null);
            req.onerror = () => reject(req.error);
        });
    },

    save: async (row: MeetExtra, opts?: { quiet?: boolean }): Promise<void> => {
        await putAll([row]);
        if (!opts?.quiet) announce(row.id);
    },

    remove: async (id: string): Promise<void> => {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        announce(id);
    },

    exportAll: () => readAll(),

    importAll: async (rows: MeetExtra[] | undefined): Promise<void> => {
        if (!Array.isArray(rows)) return;
        await putAll(rows.filter(r => r && typeof r.id === 'string' && typeof r.charId === 'string' && typeof r.body === 'string'));
    },
};
// [EM-END: meet-extra]
