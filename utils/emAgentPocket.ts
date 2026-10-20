// [EM-START: char-drives-pocket]
/**
 * 话兜在手机上的缓存：TA 攒着还没跟阿萌说的话，查手机的草稿箱读这里。
 * 规格见 docs/spec-character-drives.md 4.2、第 6 节。
 *
 * 跟约定（emAgentPlans.ts）一样：打开时拉一份存进 localStorage，mini 不在线就显示上次那份。
 */

import { AgentBackend, isAgentPaired, type AgentPocketItem } from './emAgentBackend';

const CACHE_KEY = 'em_agent_pocket_v1';

interface PocketCache {
    fetchedAt: number;
    items: AgentPocketItem[];
}

const isItem = (value: unknown): value is AgentPocketItem => {
    const item = value as AgentPocketItem;
    return Boolean(item) && typeof item.charId === 'string' && typeof item.text === 'string' && typeof item.createdAt === 'string';
};

export const loadPocketCache = (): PocketCache => {
    if (typeof localStorage === 'undefined') return { fetchedAt: 0, items: [] };
    try {
        const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (!parsed || !Array.isArray(parsed.items)) return { fetchedAt: 0, items: [] };
        return { fetchedAt: Number(parsed.fetchedAt) || 0, items: parsed.items.filter(isItem) };
    } catch {
        return { fetchedAt: 0, items: [] };
    }
};

const savePocketCache = (cache: PocketCache) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
        // 存不下就算了，下次再拉
    }
};

/** 拉一份新的（所有角色）。静默失败：mini 不在线就用上次那份。 */
export const refreshPocketCache = async (now = Date.now()): Promise<PocketCache> => {
    if (!isAgentPaired()) return loadPocketCache();
    try {
        const items = (await AgentBackend.pocket()).filter(isItem);
        const cache = { fetchedAt: now, items };
        savePocketCache(cache);
        return cache;
    } catch {
        return loadPocketCache();
    }
};

/**
 * 这个角色还没说的，最新的在前。缓存里已经过了保质期的不显示——mini 不在线时缓存不会刷新，
 * 不能让「待会儿喝」那种话一直挂着（阿萌 2026-10-19：草稿箱里一堆过时了也没说的话）。
 * 旧后端没给保质期的按两天算。
 */
export const pocketItemsFor = (items: AgentPocketItem[], charId: string, now = Date.now()): AgentPocketItem[] =>
    items
        .filter(item => item.charId === charId)
        .filter(item => {
            const at = Date.parse(item.createdAt);
            if (!Number.isFinite(at)) return false;
            const expires = item.expiresAt ? Date.parse(item.expiresAt) : at + 48 * 60 * 60 * 1000;
            return Number.isFinite(expires) && now < expires;
        })
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
// [EM-END: char-drives-pocket]
