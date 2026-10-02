// [EM-START: agent-backend-inbox]
/**
 * 把 Mac mini 后端信箱里的消息接进 LiliumOS。
 *
 * 心跳真实执行（1d）之后，角色在 App 关着时说的话会落在后端信箱里，并推一条通知。
 * 但推送只是「按门铃」——**送达保证在信箱**，所以打开 App 时必须来这里取一次，
 * 否则你会收到通知、聊天里却什么都没有。
 *
 * 取回来的话以 assistant 消息写进那个角色的聊天。过了保质期的不写（设计 4.3.1）：
 * 三天前那句「突然想到你」原样冒出来，比没收到更糟。
 */

import { DB } from './db';
import type { WorkEvent } from './emWork';
import type { LifeEvent } from './emLife';
import {
    AgentBackend,
    isAgentPaired,
    routeInboxMessages,
    type AgentMessage,
} from './emAgentBackend';
import { applyHeartbeatMomentReactions } from './emMomentsContext'; // [EM: moments-heartbeat]
import { ChatParser } from './chatParser';
import { chatReplyToInbox } from './emAgentChat'; // [EM: agent-instant-chat]

export interface InboxSyncResult {
    /** 真正写进聊天的条数。 */
    delivered: number;
    /** 过了保质期、只留在起居注里的条数。 */
    stale: number;
    /** 交给「工作」App 落地的工作往来条数。 */
    work: number;
    /** 落进查手机（联系人 / 外卖 / 淘宝 / 朋友圈）的生活小事条数。 */
    life: number;
    /** 写进聊天的那些属于哪些角色，供调用方刷新界面 / 提示。 */
    charIds: string[];
    /** 写进聊天的每一句（角色 + 正文），供调用方做「角色名 + 内容预览」的通知，和上游主动消息一个样子。 */
    lines: { charId: string; text: string }[];
    /** [EM: agent-instant-chat] 塞进 ActiveMsg 收件箱的即时回复条数：调用方见到 >0 就冲刷收件箱。 */
    chatReplies: number;
}

const EMPTY: InboxSyncResult = { delivered: 0, stale: 0, work: 0, life: 0, charIds: [], lines: [], chatReplies: 0 };

export interface InboxSyncOptions {
    /**
     * 落地一段工作往来（写进那个角色的 phoneState.work）。
     * 这里只管取信、去重、ack，不认识角色数据放在哪——由调用方（OSContext）接手。
     * 没给的话工作往来原样留在信箱里不 ack，等能接手的调用方来取，不会被悄悄吞掉。
     */
    onWorkEvent?: (event: { charId: string } & WorkEvent) => void | Promise<void>;
    /** 落地一件私人生活里的小事（写进那个角色的 phoneState.records / contacts）。规则同上。 */
    onLifeEvent?: (event: { charId: string } & LifeEvent) => void | Promise<void>;
}

/**
 * 已经落进聊天的 messageId。
 *
 * ack 可能失败（网断在写库和 ack 之间），那条下次还会被取回来。而 DB.saveMessage
 * 只管 append、不认 messageId，再写一遍就是两条一模一样的消息。所以这层去重必须有。
 * 只留最近 200 条：后端信箱本身 28 天就清了，再旧的不可能回来。
 */
const DELIVERED_KEY = 'em_agent_inbox_delivered_v1';
const DELIVERED_MAX = 200;

const loadDelivered = (): string[] => {
    if (typeof localStorage === 'undefined') return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(DELIVERED_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
};

const rememberDelivered = (ids: string[]): void => {
    if (typeof localStorage === 'undefined' || ids.length === 0) return;
    try {
        const merged = [...loadDelivered(), ...ids].slice(-DELIVERED_MAX);
        localStorage.setItem(DELIVERED_KEY, JSON.stringify(merged));
    } catch {
        // 存不下最多是重复一条，不值得为它清别人的数据。
    }
};

/**
 * 取一次信箱并落地。
 *
 * 全程静默失败：mini 每天 4–7 点休眠、Tailscale 没开都属于正常状态，不该弹错。
 * ack 放在写库之后——先确认存下来了再告诉后端「我收到了」，否则这条就永远丢了。
 */
export const syncAgentMessagesIntoChat = (
    now = Date.now(),
    options: InboxSyncOptions = {},
): Promise<InboxSyncResult> => {
    // 一次只跑一趟。取信箱有两处会触发（回到前台、即时回复的点名 / 推送叫取），撞在一起时两趟
    // 都在对方记账、销账之前取到同一批，每条就落两遍——2026-10-02 卫斯理的晚安和清蒸鲈鱼都是这么重复的。
    // 排队之后，后一趟等前一趟销完账再去取，取到的就只剩真正没收过的。
    const run = syncQueue.then(() => syncAgentMessagesOnce(now, options));
    syncQueue = run.then(() => undefined, () => undefined);
    return run;
};

let syncQueue: Promise<void> = Promise.resolve();

const syncAgentMessagesOnce = async (
    now: number,
    options: InboxSyncOptions,
): Promise<InboxSyncResult> => {
    if (!isAgentPaired()) return EMPTY;

    let messages: AgentMessage[];
    try {
        messages = await AgentBackend.inbox();
    } catch {
        return EMPTY;
    }
    if (messages.length === 0) return EMPTY;

    const result: InboxSyncResult = { delivered: 0, stale: 0, work: 0, life: 0, charIds: [], lines: [], chatReplies: 0 };
    const acked: string[] = [];
    const landed: string[] = [];
    const alreadyDelivered = new Set(loadDelivered());

    for (const { message, route } of routeInboxMessages(messages, now)) {
        const text = String(message.payload?.text ?? '').trim();
        if (alreadyDelivered.has(message.messageId)) {
            // 上次写进去了但 ack 没成功，这次只补 ack，别再写一条。
            acked.push(message.messageId);
            continue;
        }
        if (route === 'chat' && message.charId && text) {
            try {
                // 用后端写下的时刻，而不是取回来的这一刻——它本来就是那会儿说的。
                const sentAt = Date.parse(String(message.payload?.createdAt ?? message.createdAt)) || now;
                // 按换行拆成几个气泡，跟聊天里本地生成的回复同一个拆法（ChatParser.chunkText）。
                // 原来整段存成一条，「会开完了\n你下课了没」挤在一个气泡里。
                const chunks = ChatParser.chunkText(text).map(chunk => chunk.trim()).filter(Boolean);
                for (const [index, chunk] of (chunks.length ? chunks : [text]).entries()) {
                    await DB.saveMessage({
                        charId: message.charId,
                        role: 'assistant',
                        type: 'text',
                        content: chunk,
                        timestamp: sentAt + index,
                        metadata: { fromAgentBackend: true, source: message.payload?.source ?? 'heartbeat' },
                    } as never);
                }
                // [EM-START: heartbeat-xhs] 逛小红书时转发给阿萌的那条：话后面接一张卡片（跟聊天里 [[XHS_SHARE]] 同一种）
                const xhsNote = message.payload?.xhsNote as { noteId?: string; title?: string } | undefined;
                if (xhsNote?.noteId && xhsNote.title) {
                    await DB.saveMessage({
                        charId: message.charId,
                        role: 'assistant',
                        type: 'xhs_card',
                        content: xhsNote.title,
                        timestamp: sentAt + Math.max(chunks.length, 1),
                        metadata: { xhsNote, fromAgentBackend: true, source: 'heartbeat' },
                    } as never);
                }
                // [EM-END: heartbeat-xhs]
                result.delivered += 1;
                result.lines.push({ charId: message.charId, text });
                landed.push(message.messageId);
                if (!result.charIds.includes(message.charId)) result.charIds.push(message.charId);
            } catch {
                // 写不进去就别 ack，下次打开再试一遍。
                continue;
            }
        } else if (route === 'work') {
            const episode = message.payload?.episode as WorkEvent['episode'] | undefined;
            if (!options.onWorkEvent || !message.charId || !episode) {
                // 没人接手就别 ack：留在信箱里，比悄悄丢了强。episode 缺了则是坏数据，也别卡住后面的。
                if (options.onWorkEvent && message.charId && !episode) acked.push(message.messageId);
                continue;
            }
            try {
                await options.onWorkEvent({
                    charId: message.charId,
                    messageId: message.messageId,
                    createdAt: String(message.payload?.createdAt ?? message.createdAt),
                    episode,
                    thread: (message.payload?.thread as WorkEvent['thread']) ?? null,
                });
                result.work += 1;
                landed.push(message.messageId);
            } catch {
                // 落不进去就别 ack，下次打开再试；幂等键在 applyWorkEpisode 里，重来不会重复。
                continue;
            }
        } else if (route === 'life') {
            const life = message.payload?.life as LifeEvent['life'] | undefined;
            if (!options.onLifeEvent || !message.charId || !life) {
                if (options.onLifeEvent && message.charId && !life) acked.push(message.messageId);
                continue;
            }
            try {
                await options.onLifeEvent({
                    charId: message.charId,
                    messageId: message.messageId,
                    createdAt: String(message.payload?.createdAt ?? message.createdAt),
                    life,
                });
                result.life += 1;
                landed.push(message.messageId);
            } catch {
                continue;
            }
        } else if (route === 'moments') {
            // [EM: moments-heartbeat] 朋友圈库就在本机，不用调用方接手，直接写
            if (message.charId) {
                try {
                    await applyHeartbeatMomentReactions(message.charId, message.messageId, message.payload?.reactions,
                        Date.parse(String(message.payload?.createdAt ?? message.createdAt)) || now);
                    landed.push(message.messageId);
                } catch {
                    continue;
                }
            }
        // [EM-START: agent-instant-chat]
        } else if (route === 'reply') {
            // 即时回复：放进 ActiveMsg 收件箱，由调用方冲刷，拆气泡 / 表情 / 发图 / 记忆走现成后处理。
            // SW 可能已经按推送放过一份：收件箱落库前按 messageId 查近史去重，不会出两条。
            const entry = chatReplyToInbox(message, now);
            if (entry) {
                try {
                    const { ActiveMsgStore } = await import('./activeMsgStore');
                    await ActiveMsgStore.saveInboxMessage(entry);
                    result.chatReplies += 1;
                    landed.push(message.messageId);
                } catch {
                    continue;
                }
            }
        } else if (route === 'reply-error') {
            // 这一轮在 mini 上没跑成：还在等它的话当场收场（落系统消息、熄灯、可重发）
            const turnId = String(message.payload?.turnId ?? '');
            if (message.charId && turnId) {
                try {
                    const { failInstantChatPending } = await import('./amsgInstantChat');
                    await failInstantChatPending(message.charId, turnId, String(message.payload?.reason ?? 'Mac mini 那边这一轮没跑成'));
                } catch {
                    continue;
                }
            }
        // [EM-END: agent-instant-chat]
        } else if (route === 'stale') {
            result.stale += 1;
        }
        acked.push(message.messageId);
    }

    // 先记住「已经落地」，再去 ack：顺序反了的话，网断在中间就会重复一条。
    rememberDelivered(landed);
    if (acked.length > 0) {
        try {
            await AgentBackend.ackInbox(acked);
        } catch {
            // ack 失败没关系：下次取回来会被上面那层去重挡住，只补 ack。
        }
    }
    return result;
};

/**
 * [EM: agent-instant-chat] 推送送到的即时回复落进聊天之后，立刻记账并告诉 mini「收到了」。
 *
 * 原来只有「从信箱取回来」那条路会销账。推送送到的回复当场显示了，mini 那边却一直挂着「没人收」，
 * 下次打开 App 取信箱又把它们领回来一遍，只靠聊天记录里的去重挡——2026-10-02 没挡住：
 * 卫斯理前一晚 22:18 的晚安，第二天 8:12 又出现了一次。
 * 这里补上：本机记一笔（取信箱时见到就只补销账、不再落库），再向 mini 销账（下次根本不会再发回来）。
 */
export const settleLandedAgentReplies = async (messageIds: string[]): Promise<void> => {
    const ids = messageIds.filter(id => typeof id === 'string' && id.startsWith('mini:'));
    if (ids.length === 0) return;
    rememberDelivered(ids);
    try {
        await AgentBackend.ackInbox(ids);
    } catch {
        // 销账失败没关系：本机已经记了账，下次取回来只补销账。
    }
};
// [EM-END: agent-backend-inbox]
