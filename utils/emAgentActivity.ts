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

import { AgentBackend, isAgentPaired, type AgentModelRun } from './emAgentBackend';

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
    /** 心声：TA 这么判断的依据。原本只在设置页的试跑记录里，其实是这一页最好看的部分。 */
    reason?: string | null;
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

/** 后端一条动脑记录 → 起居注条目。起居注页和聊天注入共用这一份映射。 */
export const runToChronicleEntry = (run: AgentModelRun): ChronicleEntry => ({
    id: run.id,
    charId: run.charId,
    activity: run.activity,
    outcome: run.outcome,
    skipGate: run.skipGate,
    proposedText: run.proposedText,
    reason: run.reason,
    shadow: run.shadow,
    at: run.startedAt,
});

/**
 * 一次把所有角色的起居注拉回本地。
 *
 * 聊天注入读的是本地副本（发消息时不能再等一趟网络），所以打开 App / 回前台时
 * 顺手刷一遍。静默失败：mini 不在线时就用上次那份。
 */
export const refreshAllChronicles = async (limit = 200): Promise<void> => {
    if (!isAgentPaired()) return;
    let runs: AgentModelRun[];
    try {
        runs = await AgentBackend.audit(undefined, limit);
    } catch {
        return;
    }
    const byChar = new Map<string, ChronicleEntry[]>();
    for (const run of runs) {
        const list = byChar.get(run.charId) ?? [];
        list.push(runToChronicleEntry(run));
        byChar.set(run.charId, list);
    }
    for (const [charId, entries] of byChar) mergeChronicle(charId, entries);
};

/** 聊天里回看多久、最多几条。更早的，聊天本身多半已经盖过去了。 */
export const CHRONICLE_INJECT_WINDOW_MS = 12 * 60 * 60 * 1000;
const CHRONICLE_INJECT_MAX = 6;

/**
 * 给聊天用的「你不在聊天时的样子」。
 *
 * 心跳里想过的事原本只存在 mini 的库里，聊天那边的 TA 完全不知道——上一跳刚想过
 * 「等会儿忙完哄她」，一聊起来却像什么都没想过。这段让聊天里的 TA 接得上自己。
 * 只取真正动过脑的条目；被闸门拦下的没有内容。说出口的那句已经在聊天记录里，不重复。
 */
export const buildChronicleInjection = (
    charId: string,
    { now = Date.now(), timeZone }: { now?: number; timeZone?: string } = {},
): string => {
    const recent = loadChronicle(charId)
        .filter(entry => (entry.outcome === 'noop' || entry.outcome === 'message') && (entry.activity || entry.reason))
        .filter(entry => {
            const at = Date.parse(entry.at);
            return at <= now && now - at <= CHRONICLE_INJECT_WINDOW_MS;
        })
        .slice(0, CHRONICLE_INJECT_MAX)
        .reverse();
    if (recent.length === 0) return '';
    const clock = (iso: string) => {
        try {
            return new Intl.DateTimeFormat('zh-CN', {
                timeZone, hour12: true, hour: 'numeric', minute: '2-digit',
            }).format(new Date(iso));
        } catch {
            return new Date(iso).toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit' });
        }
    };
    const lines = recent.map(entry => `- ${clock(entry.at)}：${entry.activity || ''}`
        + (entry.reason ? `（心里想：${entry.reason}）` : ''));
    return '\n### 你刚才自己待着的时候\n'
        + '以下是你没在聊天时真实经历过的片刻和当时的心思，对方看不到这些。'
        + '聊天时自然地接着这些往下走：想过要找 ta、要哄 ta、要问 ta 的事，现在就是时候；不必逐条复述。\n'
        + `${lines.join('\n')}\n`;
};

/**
 * 闸门名字翻成人话。
 *
 * 注意别把后台的「唤醒」写成角色在睡觉——角色大部分时候是醒着的，
 * 在上班、逛街、打游戏。只有 sleeping 这一道才真的是 TA 睡着了。
 */
export const GATE_LABELS: Record<string, string> = {
    paused: '被按了暂停',
    no_snapshot: '还不知道你最近怎么样',
    sleeping: '在睡觉',
    active_chat: '正和你说着话',
    message_cooldown: '刚说过话',
    daily_budget: '今天已经想了很多次',
};

/** 时间轴上的一段：要么是一次真的活动，要么是「醒了几次又睡回去」。 */
export type ChronicleSegment =
    | { kind: 'entry'; entry: ChronicleEntry }
    | { kind: 'quiet'; count: number; gates: string[]; at: string };

/**
 * 把条目折成时间轴的段落。
 *
 * 连着被拦下的几次合成一段：这些时刻 TA 没有要对阿萌说的话，一次占一格的话，
 * 平常的一天会刷满「没出声」，真正做过的事反而被埋掉。理由去重后最多留两个。
 */
export const toSegments = (entries: ChronicleEntry[]): ChronicleSegment[] => {
    const segments: ChronicleSegment[] = [];
    for (const entry of entries) {
        const quiet = entry.outcome === 'skipped' || entry.outcome === 'error';
        if (!quiet) {
            segments.push({ kind: 'entry', entry });
            continue;
        }
        const gate = entry.outcome === 'error' ? '出了点岔子' : GATE_LABELS[entry.skipGate || ''] || '没动静';
        const last = segments[segments.length - 1];
        if (last?.kind === 'quiet') {
            last.count += 1;
            if (!last.gates.includes(gate) && last.gates.length < 2) last.gates.push(gate);
            continue;
        }
        segments.push({ kind: 'quiet', count: 1, gates: [gate], at: entry.at });
    }
    return segments;
};

/**
 * 「一次翻看」的合并窗口。
 *
 * 刷一次淘宝会一口气生成三四条记录，时间戳几乎挨在一起——轴上就成了连着三行「逛了逛淘宝」。
 * 对起居注来说那只是一次翻看，所以同一个 App、挨得够近的几条合成一行。
 */
export const PHONE_FOLD_WINDOW_MS = 15 * 60 * 1000;

export interface FoldablePhoneEvent {
    id: string;
    at: number;
    label: string;
}

/**
 * 把挨在一起、同一个 App 的几条合成一条。传入按时间倒序，返回也是倒序。
 * 时间取这一簇里最晚的那条——「那会儿在刷淘宝」，不必精确到第一条。
 */
export const foldPhoneEvents = <T extends FoldablePhoneEvent>(
    events: T[],
    windowMs = PHONE_FOLD_WINDOW_MS,
): T[] => {
    const sorted = [...events].sort((a, b) => b.at - a.at);
    const folded: T[] = [];
    for (const event of sorted) {
        const last = folded[folded.length - 1];
        if (last && last.label === event.label && last.at - event.at <= windowMs) continue;
        folded.push(event);
    }
    return folded;
};

export const clearChronicle = (charId: string): void => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(keyFor(charId)); } catch { /* ignore */ }
};
// [EM-END: agent-backend-chronicle]
