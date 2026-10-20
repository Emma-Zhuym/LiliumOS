import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cancelChatTurn, cancelTask } = vi.hoisted(() => ({
    cancelChatTurn: vi.fn(async () => ({ state: 'stopping' })),
    cancelTask: vi.fn(async () => ({ uuid: 'x', alreadyGone: false })),
}));
vi.mock('./emAgentBackend', () => ({ AgentBackend: { cancelChatTurn } }));
vi.mock('./activeMsgClient', () => ({ ActiveMsgClient: { cancelTask } }));

import { beginLocalReply, isReplyStopError, isReplyTurnStopped, stopReply } from './emReplyStop';
import { getInstantChatPending, setInstantChatPending } from './amsgInstantChat';

beforeEach(() => {
    localStorage.clear();
    cancelChatTurn.mockClear();
    cancelTask.mockClear();
});

describe('停止回复', () => {
    it('本地生成：掐掉这一轮的信号，结束后再停是空操作', () => {
        const run = beginLocalReply('sully');
        expect(stopReply('sully')).toEqual({ local: true, cloud: null });
        expect(run.signal.aborted).toBe(true);
        expect(isReplyStopError(run.signal)).toBe(true);
        run.end();
        expect(stopReply('sully')).toEqual({ local: false, cloud: null });
    });

    it('同一角色开新一轮会顶掉旧的，旧的 end 不会注销新的', () => {
        const first = beginLocalReply('sully');
        const second = beginLocalReply('sully');
        expect(first.signal.aborted).toBe(true);
        first.end();
        expect(stopReply('sully').local).toBe(true);
        expect(second.signal.aborted).toBe(true);
    });

    it('交给 mini 的那一轮：熄掉「正在输入」，记下 turnId，叫 mini 取消', () => {
        setInstantChatPending('sully', 'turn-mini-1', Date.now(), 'Sully', 'mini');
        expect(stopReply('sully')).toEqual({ local: false, cloud: 'mini' });
        expect(getInstantChatPending('sully')).toBeNull();
        expect(isReplyTurnStopped('turn-mini-1')).toBe(true);
        expect(cancelChatTurn).toHaveBeenCalledWith('turn-mini-1');
        expect(cancelTask).not.toHaveBeenCalled();
    });

    it('amsg 即时对话：同样作废，取消走 amsg', () => {
        setInstantChatPending('sully', 'amsg-uuid-1', Date.now(), 'Sully');
        expect(stopReply('sully').cloud).toBe('amsg');
        expect(cancelTask).toHaveBeenCalledWith('amsg-uuid-1');
        expect(isReplyTurnStopped('amsg-uuid-1')).toBe(true);
    });

    it('别的轮次不受影响；记录只留最近 50 轮', () => {
        for (let i = 0; i < 55; i++) {
            setInstantChatPending('sully', `turn-${i}`, Date.now(), 'Sully', 'mini');
            stopReply('sully');
        }
        expect(isReplyTurnStopped('turn-54')).toBe(true);
        expect(isReplyTurnStopped('turn-0')).toBe(false);
        expect(isReplyTurnStopped('never-stopped')).toBe(false);
        expect(isReplyTurnStopped(undefined)).toBe(false);
    });
});
