import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import {
  AMSG_HEARTBEAT_ROLLBACK_MARKER,
  cleanupRemovedAmsgHeartbeats,
  isRemovedHeartbeatTask,
} from './amsgRollbackCleanup';

const storage = new Map<string, string>();

describe('心跳回滚的一次性云端清理', () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.spyOn(ActiveMsgStore, 'getGlobalConfig').mockResolvedValue({
      workerUrl: 'https://amsg.example.workers.dev',
    } as any);
    vi.spyOn(ActiveMsgClient, 'clearClientStateValue').mockResolvedValue(undefined);
    vi.spyOn(ActiveMsgClient, 'cancelTask').mockImplementation(async (uuid: string) => ({
      uuid,
      alreadyGone: false,
    }));
  });

  it('只认心跳任务，不会误删普通排程或即时聊天', () => {
    expect(isRemovedHeartbeatTask({ messageSubtype: 'heartbeat' })).toBe(true);
    expect(isRemovedHeartbeatTask({ metadata: { amsgHeartbeat: true } })).toBe(true);
    expect(isRemovedHeartbeatTask({ messageSubtype: 'instant-chat' })).toBe(false);
    expect(isRemovedHeartbeatTask({ messageSubtype: 'chat' })).toBe(false);
  });

  it('先关控制行，再做两遍清单收尾；普通任务一个不碰', async () => {
    vi.spyOn(ActiveMsgClient, 'listAllTasks')
      .mockResolvedValueOnce([
        { uuid: 'heartbeat-1', charId: 'char-1', messageSubtype: 'heartbeat' },
        { uuid: 'normal-1', charId: 'char-1', messageSubtype: 'chat' },
      ])
      .mockResolvedValueOnce([
        { uuid: 'heartbeat-2', charId: 'char-1', metadata: { amsgHeartbeat: true } },
      ]);

    const result = await cleanupRemovedAmsgHeartbeats(['char-1']);

    expect(result).toEqual({ skipped: false, cancelled: 2, failed: 0 });
    expect(ActiveMsgClient.clearClientStateValue).toHaveBeenCalledWith(
      'amsg:char:char-1',
      'heartbeat_control',
    );
    expect(vi.mocked(ActiveMsgClient.cancelTask).mock.calls.map(([uuid]) => uuid))
      .toEqual(['heartbeat-1', 'heartbeat-2']);
    expect(storage.get(AMSG_HEARTBEAT_ROLLBACK_MARKER))
      .toBe('https://amsg.example.workers.dev');
  });

  it('网络失败不写完成标记，下次启动仍会重试', async () => {
    vi.spyOn(ActiveMsgClient, 'listAllTasks').mockRejectedValue(new Error('offline'));

    const result = await cleanupRemovedAmsgHeartbeats(['char-1']);

    expect(result.failed).toBe(1);
    expect(storage.has(AMSG_HEARTBEAT_ROLLBACK_MARKER)).toBe(false);
  });
});
