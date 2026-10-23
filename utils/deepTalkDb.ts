// [EM-START: deep-talk]
/**
 * 烛下（深谈）的「这一夜」记录，独立库 LiliumOS_DeepTalk。
 * 对话正文不在这里：它们是普通聊天消息（metadata.source = 'deep_talk' + deepTalkId），
 * 因为记忆宫殿的缓冲区、水位线、召回都只认消息流。
 * 「所有夜晚」只靠 charId 读这个库，以后情侣空间要挂书架直接用。
 */

import { isActiveStatus, isDeepTalkIdle, isMatterNight, type DeepTalkNight } from './deepTalk';

const DB_NAME = 'LiliumOS_DeepTalk';
const DB_VERSION = 1;
const STORE_NIGHTS = 'nights';

/** 状态变了就广播一次（detail.charId），纸面、卡片、心跳快照各自刷新 */
export const DEEP_TALK_CHANGED_EVENT = 'em-deep-talk-changed';

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NIGHTS)) {
                const store = db.createObjectStore(STORE_NIGHTS, { keyPath: 'id' });
                store.createIndex('charId', 'charId', { unique: false });
            }
        };
    });
}

async function nightsOf(charId: string): Promise<DeepTalkNight[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NIGHTS, 'readonly').objectStore(STORE_NIGHTS).index('charId').getAll(charId);
        req.onsuccess = () => {
            const nights = (req.result as DeepTalkNight[]).sort((a, b) => a.invitedAt - b.invitedAt);
            rememberMatter(charId, nights);
            resolve(nights);
        };
        req.onerror = () => reject(req.error);
    });
}

async function getAllNights(): Promise<DeepTalkNight[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NIGHTS, 'readonly').objectStore(STORE_NIGHTS).getAll();
        req.onsuccess = () => resolve(req.result as DeepTalkNight[]);
        req.onerror = () => reject(req.error);
    });
}

async function putNights(nights: DeepTalkNight[]): Promise<void> {
    if (!nights.length) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NIGHTS, 'readwrite');
        for (const night of nights) tx.objectStore(STORE_NIGHTS).put(night);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ── 同步缓存 ──
// 拼提示词（buildMessageHistory 是同步的）要当场知道「哪一夜正开着」，所以每次读写都顺手记一份。
const activeCache = new Map<string, DeepTalkNight | null>();
/** 谈事的那几次的 id：它们的原文按普通聊天进上下文 */
const matterCache = new Map<string, Set<string>>();
const rememberMatter = (charId: string, nights: DeepTalkNight[]) =>
    matterCache.set(charId, new Set(nights.filter(isMatterNight).map(n => n.id)));

const announce = (charId: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(DEEP_TALK_CHANGED_EVENT, { detail: { charId } }));
};
/** 多了一段话也要叫一声，纸面才知道重读 */
export const notifyDeepTalkChanged = announce;

/** 缓存里这个角色正在进行的那一夜（invited / later / open）；还没读过返回 undefined */
export const getCachedActiveNight = (charId: string): DeepTalkNight | null | undefined => activeCache.get(charId);

/** 正开着（变纸了）的那一夜的 id，给历史折叠用 */
export const getCachedOpenNightId = (charId: string): string | null => {
    const night = activeCache.get(charId);
    return night && night.status === 'open' ? night.id : null;
};

/** 缓存里谈事那几次的 id；还没读过就是空的（宁可当说真话藏着） */
export const getCachedMatterNightIds = (charId: string): ReadonlySet<string> => matterCache.get(charId) || new Set();

/** 记忆宫殿、心跳快照、手动总结用：读不出来（没有 IndexedDB）当一个都没有 */
export const loadMatterNightIds = async (charId: string): Promise<ReadonlySet<string>> => {
    try {
        return new Set((await nightsOf(charId)).filter(isMatterNight).map(n => n.id));
    } catch {
        return new Set();
    }
};

export const DeepTalkDB = {
    listNights: nightsOf,

    getNight: async (id: string): Promise<DeepTalkNight | null> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction(STORE_NIGHTS, 'readonly').objectStore(STORE_NIGHTS).get(id);
            req.onsuccess = () => resolve((req.result as DeepTalkNight) || null);
            req.onerror = () => reject(req.error);
        });
    },

    /** 这个角色正在进行的那一夜：同时只会有一条 invited / later / open */
    getActive: async (charId: string): Promise<DeepTalkNight | null> => {
        const nights = await nightsOf(charId);
        const active = [...nights].reverse().find(n => isActiveStatus(n.status)) || null;
        activeCache.set(charId, active);
        return active;
    },

    saveNight: async (night: DeepTalkNight): Promise<void> => {
        await putNights([night]);
        if (isActiveStatus(night.status)) activeCache.set(night.charId, night);
        else if (activeCache.get(night.charId)?.id === night.id) activeCache.set(night.charId, null);
        const matter = new Set(matterCache.get(night.charId) || []);
        if (isMatterNight(night)) matter.add(night.id); else matter.delete(night.id);
        matterCache.set(night.charId, matter);
        announce(night.charId);
    },

    /** 已经结束的那些夜，新的在前（「所有夜晚」用） */
    listClosed: async (charId: string): Promise<DeepTalkNight[]> =>
        (await nightsOf(charId)).filter(n => n.status === 'closed').sort((a, b) => (b.nightNo || 0) - (a.nightNo || 0)),

    exportAll: getAllNights,

    importAll: async (nights: DeepTalkNight[] | undefined): Promise<void> => {
        if (!Array.isArray(nights)) return;
        await putNights(nights.filter(n => n && typeof n.id === 'string' && typeof n.charId === 'string'));
        activeCache.clear();
        matterCache.clear();
    },
};

/**
 * 给 mini 心跳快照的那一段：深谈正开着、而且没放着不管超过 3 小时，才算「别插话」。
 * 读不出来（没有 IndexedDB 的环境）就当没开。
 */
export const loadDeepTalkForSnapshot = async (
    charId: string,
    lastSegmentAt: number | null,
    now = Date.now(),
): Promise<{ open: true; since: string } | null> => {
    try {
        const night = await DeepTalkDB.getActive(charId);
        if (!night || night.status !== 'open' || isDeepTalkIdle(night, lastSegmentAt, now)) return null;
        return { open: true, since: new Date(Math.max(night.startedAt || 0, lastSegmentAt || 0) || now).toISOString() };
    } catch {
        return null;
    }
};
// [EM-END: deep-talk]
