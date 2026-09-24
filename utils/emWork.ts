// [EM-START: work-app]
/**
 * 「工作」App 的数据：TA 在工作群里、和同事私聊、邮件里说了什么，以及手头正在推进的事。
 *
 * 数据由 Mac mini 上的心跳产出，送到手机后落进 `phoneState.work`。这里全是纯函数，
 * 只做两件事：把一段新往来并进去（幂等、有上限），以及把它整理成界面要的样子。
 *
 * 和「联系人 / 短信」是**两条独立的线**：工作里的往来只在这个 App 里，不写进短信、不自动进通讯录——
 * 否则工作群聊和私人短信就混在一起分不开了。同事要不要进通讯录，是用户自己的决定。
 */

import type { CharacterWorkState, WorkMessage, WorkThread } from '../types';

/** 每个会话最多留多少句、整个 App 最多留多少句。再旧的翻不到也不会有人想翻。 */
export const MAX_MESSAGES_PER_CHANNEL = 120;
export const MAX_MESSAGES_TOTAL = 500;
export const MAX_THREADS = 40;
export const MAX_THREAD_HISTORY = 20;

export interface WorkEpisodeLine { who: string; text: string }
export interface WorkEpisodePayload {
    channel: 'group' | 'dm' | 'email';
    with: string;
    subject?: string;
    lines: WorkEpisodeLine[];
}
export interface WorkThreadPayload { id: string; title: string; summary: string; status: 'open' | 'done' }

/** 后端信箱里 work_episode 那条消息的内容，加上信箱给的 messageId。 */
export interface WorkEvent {
    messageId: string;
    createdAt: string;
    episode: WorkEpisodePayload;
    thread?: WorkThreadPayload | null;
}

export const emptyWorkState = (): CharacterWorkState => ({ messages: [], threads: [] });

const MINE = '我';

const channelOf = (episode: WorkEpisodePayload): { key: string; title: string } => {
    if (episode.channel === 'group') return { key: `g:${episode.with}`, title: episode.with };
    if (episode.channel === 'email') {
        const title = episode.subject?.trim() || episode.with;
        return { key: `e:${title}`, title };
    }
    return { key: `d:${episode.with}`, title: episode.with };
};

/** 已经并进去过的 messageId（一次往来至少有一句，每句的 sourceId 都是它）。 */
const hasEvent = (state: CharacterWorkState, messageId: string): boolean =>
    state.messages.some(message => message.sourceId === messageId);

/**
 * 把一段新往来并进状态。不可变，返回新状态。
 *
 * 幂等靠 messageId：取回来的消息 ack 失败会再来一遍，同一段往来不能变成两段。
 */
export const applyWorkEpisode = (
    state: CharacterWorkState | undefined,
    event: WorkEvent,
): CharacterWorkState => {
    const base = state ?? emptyWorkState();
    if (hasEvent(base, event.messageId)) return base;

    const at = Date.parse(event.createdAt) || Date.now();
    const { key, title } = channelOf(event.episode);
    // 一段往来里的几句话，时间上挨着排开（每句差 1 秒），保证按顺序读出来还是原来的顺序。
    const added: WorkMessage[] = event.episode.lines.map((line, index) => ({
        id: `${event.messageId}#${index}`,
        sourceId: event.messageId,
        at: at + index * 1000,
        channel: key,
        channelTitle: title,
        kind: event.episode.channel,
        from: line.who,
        mine: line.who === MINE,
        text: line.text,
        ...(event.episode.channel === 'email' && event.episode.subject ? { subject: event.episode.subject } : {}),
    }));

    let messages = [...base.messages, ...added];
    // 单个会话超上限：只砍这个会话最旧的。
    const inChannel = messages.filter(message => message.channel === key);
    if (inChannel.length > MAX_MESSAGES_PER_CHANNEL) {
        const drop = new Set(inChannel.slice(0, inChannel.length - MAX_MESSAGES_PER_CHANNEL).map(message => message.id));
        messages = messages.filter(message => !drop.has(message.id));
    }
    if (messages.length > MAX_MESSAGES_TOTAL) messages = messages.slice(messages.length - MAX_MESSAGES_TOTAL);

    let threads = base.threads;
    if (event.thread?.id && event.thread.title) {
        const incoming = event.thread;
        const existing = threads.find(thread => thread.id === incoming.id);
        const entry = { at, text: incoming.summary };
        const merged: WorkThread = existing
            ? {
                ...existing,
                title: incoming.title,
                summary: incoming.summary || existing.summary,
                status: incoming.status,
                updatedAt: at,
                history: incoming.summary ? [...existing.history, entry].slice(-MAX_THREAD_HISTORY) : existing.history,
            }
            : {
                id: incoming.id,
                title: incoming.title,
                summary: incoming.summary,
                status: incoming.status,
                updatedAt: at,
                history: incoming.summary ? [entry] : [],
            };
        threads = existing ? threads.map(thread => (thread.id === incoming.id ? merged : thread)) : [...threads, merged];
        if (threads.length > MAX_THREADS) {
            // 先丢已经做完的、最旧的；都没做完才丢最旧的未完成。
            const ranked = [...threads].sort((a, b) =>
                (a.status === b.status ? a.updatedAt - b.updatedAt : a.status === 'done' ? -1 : 1));
            const drop = new Set(ranked.slice(0, threads.length - MAX_THREADS).map(thread => thread.id));
            threads = threads.filter(thread => !drop.has(thread.id));
        }
    }
    return { messages, threads };
};

export interface WorkChannelSummary {
    key: string;
    title: string;
    kind: WorkMessage['kind'];
    last: WorkMessage;
    count: number;
}

/** 会话列表：按最近一句排，最新的在最上面。 */
export const listChannels = (state: CharacterWorkState | undefined): WorkChannelSummary[] => {
    const byKey = new Map<string, WorkChannelSummary>();
    for (const message of state?.messages ?? []) {
        const found = byKey.get(message.channel);
        if (!found) {
            byKey.set(message.channel, { key: message.channel, title: message.channelTitle, kind: message.kind, last: message, count: 1 });
        } else {
            found.count += 1;
            if (message.at >= found.last.at) found.last = message;
        }
    }
    return [...byKey.values()].sort((a, b) => b.last.at - a.last.at);
};

/** 一个会话里的所有句子，按时间从旧到新。 */
export const channelMessages = (state: CharacterWorkState | undefined, key: string): WorkMessage[] =>
    (state?.messages ?? []).filter(message => message.channel === key).sort((a, b) => a.at - b.at);

/** 事项列表：没做完的在前，各自按最近进展排。 */
export const listThreads = (state: CharacterWorkState | undefined): WorkThread[] =>
    [...(state?.threads ?? [])].sort((a, b) =>
        (a.status === b.status ? b.updatedAt - a.updatedAt : a.status === 'open' ? -1 : 1));

/** 列表里的时间：今天显示钟点，昨天写「昨天」，更早写月日。 */
export const formatWorkTime = (at: number, now = Date.now()): string => {
    const date = new Date(at);
    const today = new Date(now);
    if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit', hour12: false });
    }
    if (date.toDateString() === new Date(now - 86_400_000).toDateString()) return '昨天';
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};
// [EM-END: work-app]
