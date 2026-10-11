// [EM-START: agent-backend-snapshot-refresh]
/**
 * 打开 App / 回到前台时，给开了心跳的角色补传近况快照。
 *
 * 快照原来只在阿萌发消息时才传：一整天没发消息，后端手里那份「今天的安排」就还是昨天的，
 * TA 第二天醒来照着昨天的日程过。这里在打开 App 时补一份，日程、情绪、聊天一起刷新。
 * 后端那边也会丢掉不是今天的日程（heartbeat.mjs 的 withTodaySchedule），这里只是让它更常是新的。
 *
 * 同一个角色 30 分钟内最多补一次（阿萌刚发了朋友圈时 force 立刻补）；全程静默，后端不在线是常态。
 */

import type { CharacterProfile } from '../types';
import { DB } from './db';
import { AgentBackend, flushSnapshotUpload, isAgentPaired } from './emAgentBackend';
import { buildCharacterSnapshot } from './emAgentSnapshot';

export const SNAPSHOT_REFRESH_MIN_GAP_MS = 30 * 60_000;
const lastRefreshAt = new Map<string, number>();

export const refreshHeartbeatSnapshots = async (
    characters: CharacterProfile[],
    userName: string | undefined,
    { now = Date.now(), force = false }: { now?: number; force?: boolean } = {},
): Promise<void> => {
    if (!isAgentPaired()) return;
    let enabled: Set<string>;
    try {
        enabled = new Set((await AgentBackend.characters()).filter(c => c.heartbeatEnabled).map(c => c.charId));
    } catch {
        return;
    }
    for (const char of characters) {
        if (!enabled.has(char.id)) continue;
        if (!force && now - (lastRefreshAt.get(char.id) ?? 0) < SNAPSHOT_REFRESH_MIN_GAP_MS) continue;
        try {
            const messages = await DB.getMessagesByCharId(char.id);
            if (await flushSnapshotUpload(await buildCharacterSnapshot(char, messages, { userName }))) {
                lastRefreshAt.set(char.id, now);
            }
        } catch {
            // 单个角色拼不出来不影响别人
        }
    }
};

/** 测试用：清掉节流记录。 */
export const resetSnapshotRefreshForTest = () => lastRefreshAt.clear();
// [EM-END: agent-backend-snapshot-refresh]
