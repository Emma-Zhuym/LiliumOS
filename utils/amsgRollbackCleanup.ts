import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { amsgStateNamespace } from './amsgFirePack';

/** 回滚心跳后只执行一次；值保存执行时对应的 Worker 地址，换后端会重新检查。 */
export const AMSG_HEARTBEAT_ROLLBACK_MARKER = 'liliumos_amsg_heartbeat_rollback_v1';
const REMOVED_HEARTBEAT_SUBTYPE = 'heartbeat';
const REMOVED_HEARTBEAT_CONTROL_KEY = 'heartbeat_control';

export const isRemovedHeartbeatTask = (task: unknown): boolean => {
  if (!task || typeof task !== 'object') return false;
  const row = task as Record<string, any>;
  return row.messageSubtype === REMOVED_HEARTBEAT_SUBTYPE
    || row.metadata?.messageSubtype === REMOVED_HEARTBEAT_SUBTYPE
    || row.metadata?.amsgHeartbeat === true;
};

/**
 * 心跳功能从 App 删除后，清掉它已经留在云端的控制行和隐藏任务。
 *
 * 这是回滚清理，不会碰普通主动消息、即时聊天、角色上下文、API 凭据或推送订阅。
 * 任一步失败都不写完成标记，下次启动继续尝试；取消任务与清空控制行本身都是幂等的。
 */
export const cleanupRemovedAmsgHeartbeats = async (
  currentCharIds: string[],
): Promise<{ skipped: boolean; cancelled: number; failed: number }> => {
  const config = await ActiveMsgStore.getGlobalConfig();
  const workerKey = config.workerUrl?.trim();
  if (!workerKey || localStorage.getItem(AMSG_HEARTBEAT_ROLLBACK_MARKER) === workerKey) {
    return { skipped: true, cancelled: 0, failed: 0 };
  }

  let firstPass: any[];
  try {
    firstPass = await ActiveMsgClient.listAllTasks();
  } catch {
    return { skipped: false, cancelled: 0, failed: 1 };
  }

  const heartbeatRows = firstPass.filter(isRemovedHeartbeatTask);
  const charIds = new Set(
    [...currentCharIds, ...heartbeatRows.map((row) => row?.charId)]
      .filter((id): id is string => typeof id === 'string' && Boolean(id)),
  );

  let failed = 0;
  for (const charId of charIds) {
    try {
      await ActiveMsgClient.clearClientStateValue(
        amsgStateNamespace(charId),
        REMOVED_HEARTBEAT_CONTROL_KEY,
      );
    } catch {
      failed += 1;
    }
  }

  const cancelled = new Set<string>();
  const cancelRows = async (rows: any[]) => {
    for (const row of rows.filter(isRemovedHeartbeatTask)) {
      if (typeof row?.uuid !== 'string' || cancelled.has(row.uuid)) continue;
      try {
        await ActiveMsgClient.cancelTask(row.uuid);
        cancelled.add(row.uuid);
      } catch {
        failed += 1;
      }
    }
  };

  await cancelRows(firstPass);
  try {
    // 再读一次，收掉第一次清单之后刚好由在途 fire 续排出来的最后一跳。
    await cancelRows(await ActiveMsgClient.listAllTasks());
  } catch {
    failed += 1;
  }

  if (failed === 0) localStorage.setItem(AMSG_HEARTBEAT_ROLLBACK_MARKER, workerKey);
  return { skipped: false, cancelled: cancelled.size, failed };
};
