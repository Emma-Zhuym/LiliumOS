// [EM-START: agent-instant-chat]
/**
 * 即时回复的手机这一半：聊天这一轮交给 Mac mini 跑，发完就能锁屏 / 被杀后台。
 * 规格见 docs/spec-agent-backend-instant-chat.md 阶段一。
 *
 * 能复用的全复用 amsg 即时对话那一套：
 *   - 「正在输入…」用 amsgInstantChat 的待收记录（多一个 via:'mini'），界面、横幅、到达销账都不用改；
 *   - 回复按 amsg 的推送形状来，SW 直接放进收件箱，拆气泡 / 表情 / 发图 / 记忆全走现成后处理；
 *   - 图片令牌上传前还原成 data URL（resolveChatMessagesForUpload）。
 * 这里只管：开关、mini 在不在、把这一轮交上去、每 60 秒点一次名、信箱里的回复塞回收件箱。
 *
 * mini 不在（4–7 点休眠、断网）时这一轮回落本地生成，不报错（阿萌 2026-09-29 定）。
 */

import type { ActiveMsg2InboxMessage, CharacterProfile } from '../types';
import { AgentBackend, isAgentPaired, type AgentMessage } from './emAgentBackend';

export const AGENT_CHAT_ENABLED_KEY = 'em_agent_chat_enabled_v1';
/** 健康探测：最多等这么久；探过的结论在冷却期内直接复用，别每条消息都探一次。 */
export const AGENT_CHAT_PROBE_TIMEOUT_MS = 3_000;
export const AGENT_CHAT_PROBE_COOLDOWN_MS = 30_000;
/** 连续这么多次点名都联系不上 mini，就判这一轮没了（每次间隔 60 秒）。 */
export const AGENT_CHAT_MAX_STATUS_FAILURES = 5;

export const isAgentChatEnabled = (): boolean => {
    try {
        return localStorage.getItem(AGENT_CHAT_ENABLED_KEY) === '1';
    } catch {
        return false;
    }
};

export const setAgentChatEnabled = (enabled: boolean): void => {
    try {
        if (enabled) localStorage.setItem(AGENT_CHAT_ENABLED_KEY, '1');
        else localStorage.removeItem(AGENT_CHAT_ENABLED_KEY);
    } catch {
        // 存不下就当没开
    }
};

let lastProbe: { at: number; ok: boolean } | null = null;

/** 测试用 */
export const resetAgentChatProbeForTest = () => { lastProbe = null; };

/**
 * 这一轮能不能交给 mini：开关开着、配对过、mini 这会儿在。
 * 探测失败就回落本地——宁可这一轮在手机上跑，也不要发出去石沉大海。
 */
export const isAgentChatReady = async (now = Date.now()): Promise<boolean> => {
    if (!isAgentChatEnabled() || !isAgentPaired()) return false;
    if (lastProbe && now - lastProbe.at < AGENT_CHAT_PROBE_COOLDOWN_MS) return lastProbe.ok;
    let ok = false;
    try {
        await AgentBackend.health(AGENT_CHAT_PROBE_TIMEOUT_MS);
        ok = true;
    } catch {
        ok = false;
    }
    lastProbe = { at: now, ok };
    return ok;
};

const newTurnId = (): string => {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-4000-8000-${Math.random().toString(16).slice(2, 14)}`;
    }
};

export interface AgentChatTurnParams {
    char: Pick<CharacterProfile, 'id' | 'name'>;
    messages: Array<{ role: string; content: unknown }>;
    api: { baseUrl: string; apiKey: string; model: string };
    temperature?: number;
    maxTokens?: number;
    extraBody?: Record<string, unknown>;
}

/**
 * 交上去。成功就记待收（点亮「正在输入…」），失败把原因交给调用方——调用方落系统消息，
 * 不静默退回本地：走到这一步说明刚探过 mini 是在的，发不上去是真出了事。
 */
export const sendAgentChatTurn = async (params: AgentChatTurnParams): Promise<{ ok: true; turnId: string } | { ok: false; error: string }> => {
    const [{ getInstantChatPending, setInstantChatPending }, { resolveChatMessagesForUpload }] = await Promise.all([
        import('./amsgInstantChat'),
        import('./activeMsgClient'),
    ]);
    const previous = getInstantChatPending(params.char.id);
    const turnId = newTurnId();
    try {
        await AgentBackend.submitChatTurn({
            turnId,
            charId: params.char.id,
            charName: params.char.name,
            // 图片令牌只在这台手机的 IndexedDB 里认得，mini 那边解不开
            messages: await resolveChatMessagesForUpload(params.messages),
            api: params.api,
            ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
            ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
            ...(params.extraBody ? { extraBody: params.extraBody } : {}),
            // 连发：顶掉上一轮还没开跑的（只顶 mini 的，amsg 那边的轮次不归这里管）
            ...(previous?.via === 'mini' ? { supersedes: previous.uuid } : {}),
        });
        setInstantChatPending(params.char.id, turnId, Date.now(), params.char.name, 'mini');
        return { ok: true, turnId };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
};

const statusFailures = new Map<string, number>();

/**
 * 60 秒一次的点名（activeMsgRuntime 的状态机遇到 via:'mini' 的待收时交给这里）。
 * 只有 mini 明确说失败 / 这一轮没了，或者一直联系不上，才收场。
 * 返回 true 表示已经把回复拉回来或已经收场，调用方不用再管这一轮。
 */
export const checkAgentChatPending = async (
    pending: { charId: string; uuid: string },
    pullOutbox: () => Promise<void>,
): Promise<void> => {
    const { failInstantChatPending, getInstantChatPending } = await import('./amsgInstantChat');
    let state: string;
    let error: string | undefined;
    try {
        ({ state, error } = await AgentBackend.chatTurnStatus(pending.uuid));
        statusFailures.delete(pending.uuid);
    } catch (e) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const count = (statusFailures.get(pending.uuid) ?? 0) + 1;
        if (count < AGENT_CHAT_MAX_STATUS_FAILURES) {
            statusFailures.set(pending.uuid, count);
            return;
        }
        statusFailures.delete(pending.uuid);
        await failInstantChatPending(pending.charId, pending.uuid,
            `连续 ${count} 次联系不上 Mac mini（${e instanceof Error ? e.message : String(e)}）。它可能在休眠或断网了，这一轮的回复稍后要是到了会照常出现`);
        return;
    }
    if (state === 'pending' || state === 'running') return;
    // done：推送多半丢了，去信箱取；failed / gone：先取一次（错误说明也在信箱里），还没收场再下结论
    await pullOutbox();
    if (getInstantChatPending(pending.charId)?.uuid !== pending.uuid) return;
    if (state === 'done') return; // 回复可能还在落库途中，下一跳再看
    await failInstantChatPending(pending.charId, pending.uuid,
        state === 'cancelled' ? '这一轮被后一条消息顶掉了' : (error || 'Mac mini 那边这一轮没跑成'));
};

/** 信箱里的即时回复（kind chat_reply）→ 收件箱条目，形状和 SW 收到推送时写的一样。 */
export const chatReplyToInbox = (message: AgentMessage, receivedAt = Date.now()): ActiveMsg2InboxMessage | null => {
    const payload = message.payload as Record<string, any> | undefined;
    const charId = payload?.metadata?.charId ?? message.charId;
    if (!payload || typeof charId !== 'string' || !charId) return null;
    const body = String(payload.message ?? '').trim();
    const sentAt = Date.parse(String(payload.timestamp ?? message.createdAt));
    return {
        messageId: String(payload.messageId ?? message.messageId),
        charId,
        charName: String(payload.contactName ?? payload.metadata?.charName ?? ''),
        body,
        previewBody: String(payload.notification?.body ?? body),
        source: 'agent-backend',
        messageType: payload.messageType ?? 'instant',
        taskUuid: payload.taskUuid ?? null,
        // 不带 amsgOutboxBackfill：那个标记会让收件箱去 amsg 取消任务，mini 的轮次在 amsg 上查无此行
        metadata: { ...(payload.metadata ?? {}) },
        sentAt: Number.isFinite(sentAt) ? sentAt : receivedAt,
        receivedAt,
    };
};
// [EM-END: agent-instant-chat]
