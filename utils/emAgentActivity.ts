// [EM-START: agent-backend-chronicle]
/**
 * 起居注的本地缓存。
 *
 * 动态条目本身住在 Mac mini 的 model_runs 里，这边只留一份副本，为的是：
 * mini 每天 4–7 点休眠、Tailscale 没开、人在外面没网时，这一页照样能翻。
 *
 * 存在 localStorage 而不是 IndexedDB：一条几十个字、按角色最多留 200 条，
 * 量级跟一次聊天草稿差不多，犯不着为它开一个库。
 */

const KEY_PREFIX = 'em_agent_chronicle_v1:';
/** 每个角色最多留多少条。后端那边按 30 天清，这里只管别把 localStorage 撑爆。 */
const MAX_PER_CHAR = 200;

export interface ChronicleEntry {
    /** 后端 model_runs.id，用来去重。 */
    id: number;
    charId: string;
    /** 角色第一人称那句「这次醒来我做了什么」。被闸门拦下的没有这句。 */
    activity: string | null;
    /** 这次的判断结果。 */
    outcome: 'noop' | 'message' | 'task' | 'skipped' | 'error' | null;
    /** 命中的是哪道闸（outcome=skipped 时才有）。 */
    skipGate: string | null;
    /** 这次是不是也（打算）给阿萌发了消息。 */
    proposedText: string | null;
    /** true = 试跑，没有真的执行。 */
    shadow: boolean;
    at: string;
}

const keyFor = (charId: string) => `${KEY_PREFIX}${charId}`;

export const loadChronicle = (charId: string): ChronicleEntry[] => {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(keyFor(charId));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

/**
 * 合并新取到的条目。按 id 去重，新的在前。
 *
 * 后端重装过库时 id 会从头开始，可能跟旧副本撞号；所以同一个 id 以**新取到的**为准，
 * 而不是保留旧的——服务端永远是事实来源，本地只是副本。
 */
export const mergeChronicle = (charId: string, incoming: ChronicleEntry[]): ChronicleEntry[] => {
    const byId = new Map<number, ChronicleEntry>();
    for (const entry of loadChronicle(charId)) byId.set(entry.id, entry);
    for (const entry of incoming) byId.set(entry.id, entry);
    const merged = [...byId.values()]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, MAX_PER_CHAR);
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(keyFor(charId), JSON.stringify(merged));
        } catch {
            // 存不下就算了：这一页下次联网还能重新拉，不值得为它清别人的数据。
        }
    }
    return merged;
};

export const clearChronicle = (charId: string): void => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(keyFor(charId)); } catch { /* ignore */ }
};
// [EM-END: agent-backend-chronicle]
