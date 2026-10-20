/**
 * 停止回复（EM 版）。私聊回复有三条路，停法各不一样：
 *
 * - 本地生成：掐掉模型请求，逐条上屏也停下；已经显示出来的留着，没显示的丢掉。
 * - 交给 Mac mini：告诉 mini 取消 / 掐掉这一轮（跑完也不推），本机记下 turnId，
 *   万一推送已经在路上，收件箱见到这一轮就丢掉。
 * - amsg 即时对话：尽力取消云端任务；同样记下 uuid，晚到的回复丢掉。
 *
 * 「记下」存 localStorage：回复可能在关掉页面之后才到，重开时也得认得出来。
 */
import { AgentBackend } from './emAgentBackend';
import { ActiveMsgClient } from './activeMsgClient';
import { cloudApiCallLogId, settleCloudApiCall } from './apiCallLog';
import { announceEmotionDone } from './chatGenEvents';
import { clearInstantChatPending, discardInstantChatExpiredNotices, getInstantChatPending } from './amsgInstantChat';

const STOPPED_KEY = 'em_stopped_reply_turns_v1';
/** 只记最近这么多轮；够覆盖「停了以后推送还在路上」的窗口。 */
const MAX_STOPPED = 50;

const localRuns = new Map<string, AbortController>();

export const replyStoppedError = (): DOMException => new DOMException('回复已停止', 'AbortError');

/** 这一轮出的错是不是用户点了停止造成的（而不是网络或解析出错）：看这一轮的信号有没有被掐。 */
export const isReplyStopError = (signal?: AbortSignal): boolean => !!signal?.aborted;

/** 本地生成开始时登记一下，拿到这一轮的中止信号；同一角色只留最新一轮。 */
export const beginLocalReply = (charId: string): { signal: AbortSignal; end: () => void } => {
    localRuns.get(charId)?.abort(replyStoppedError());
    const controller = new AbortController();
    localRuns.set(charId, controller);
    return {
        signal: controller.signal,
        end: () => { if (localRuns.get(charId) === controller) localRuns.delete(charId); },
    };
};

const readStopped = (): string[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(STOPPED_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch { return []; }
};

const rememberStopped = (turnId: string): void => {
    try {
        const next = [...readStopped().filter(item => item !== turnId), turnId].slice(-MAX_STOPPED);
        localStorage.setItem(STOPPED_KEY, JSON.stringify(next));
    } catch { /* 存不进去也照停，只是晚到的回复认不出来 */ }
};

/** 收件箱用：这一轮是不是被停掉过（是的话回复直接丢掉）。 */
export const isReplyTurnStopped = (turnId: string | null | undefined): boolean =>
    !!turnId && readStopped().includes(turnId);

export interface StopReplyResult {
    /** 停掉了本机正在跑的生成。 */
    local: boolean;
    /** 停掉了交给云端（mini / amsg）的那一轮。 */
    cloud: 'mini' | 'amsg' | null;
}

/** 点了「停止」。本机在生成就掐掉；有欠着的云端回复就作废那一轮。 */
export const stopReply = (charId: string): StopReplyResult => {
    const run = localRuns.get(charId);
    const local = !!run && !run.signal.aborted;
    run?.abort(replyStoppedError());

    const pending = getInstantChatPending(charId);
    let cloud: StopReplyResult['cloud'] = null;
    if (pending) {
        cloud = pending.via === 'mini' ? 'mini' : 'amsg';
        rememberStopped(pending.uuid);
        clearInstantChatPending(charId);
        // 跟这一轮失败时的收尾一样，只是不落「没回成」的系统消息
        discardInstantChatExpiredNotices(charId, pending.uuid);
        announceEmotionDone(charId);
        settleCloudApiCall({ id: cloudApiCallLogId(pending.uuid), ok: false });
        const cancel = cloud === 'mini'
            ? AgentBackend.cancelChatTurn(pending.uuid)
            : ActiveMsgClient.cancelTask(pending.uuid);
        // 尽力而为：取消不掉（已经跑完 / 旧版后端没有这个接口），晚到的回复也会被收件箱丢掉
        void cancel.catch(error => console.warn('[停止回复] 云端取消没成功，晚到的回复会被丢掉', error));
    }
    return { local, cloud };
};
