/**
 * 贴贴事后记录的独立库 LiliumOS_Tietie。
 * 聊天里只有一张卡（metadata.tietieId 指过来），日记全文、记忆 id 都在这里。
 */

import type { TietieRecord } from './tietie';

const DB_NAME = 'LiliumOS_Tietie';
const DB_VERSION = 1;
const STORE = 'records';

/** 写了 / 改了 / 删了记忆就广播一次（detail.charId），卡片和日记各自重读 */
export const TIETIE_CHANGED_EVENT = 'em-tietie-changed';

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

const announce = (charId: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(TIETIE_CHANGED_EVENT, { detail: { charId } }));
};

async function readAll(charId?: string): Promise<TietieRecord[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const store = db.transaction(STORE, 'readonly').objectStore(STORE);
        const req = charId ? store.index('charId').getAll(charId) : store.getAll();
        req.onsuccess = () => resolve((req.result as TietieRecord[]).sort((a, b) => a.startedAt - b.startedAt));
        req.onerror = () => reject(req.error);
    });
}

async function putAll(records: TietieRecord[]): Promise<void> {
    if (!records.length) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        for (const record of records) tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export const TietieDB = {
    /** 这个角色的所有记录，早的在前 */
    list: (charId: string) => readAll(charId),

    get: async (id: string): Promise<TietieRecord | null> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
            req.onsuccess = () => resolve((req.result as TietieRecord) || null);
            req.onerror = () => reject(req.error);
        });
    },

    save: async (record: TietieRecord): Promise<void> => {
        await putAll([record]);
        announce(record.charId);
    },

    exportAll: () => readAll(),

    importAll: async (records: TietieRecord[] | undefined): Promise<void> => {
        if (!Array.isArray(records)) return;
        await putAll(records.filter(r => r && typeof r.id === 'string' && typeof r.charId === 'string' && Number.isFinite(r.startedAt)));
    },
};
