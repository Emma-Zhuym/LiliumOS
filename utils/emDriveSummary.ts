// [EM-START: char-drives-cue]
/**
 * 契机池按劲儿加权要的那一小份：mini 劲儿系统此刻最强的一两股 + 档位（`GET /drives`，见 feat/char-drives-engine）。
 *
 * - 先读本机缓存（跟查手机状态小组件同一个键），抽中了念头才去 mini 拉一份新的，最多等 1.5 秒
 * - mini 还没装劲儿系统（404）、不在线、没配对：都当作空——契机池退回固定权重，不报错
 * 自己发请求、不往 emAgentBackend 里加方法，免得跟劲儿系统那个分支撞在同一处。
 */

import { isAgentPaired, loadAgentConfig } from './emAgentBackend';

export type DriveSummaryItem = { drive: string; level: 'mid' | 'high' };

const cacheKey = (charId: string) => `em_drive_status_v1:${charId}`;

export const readDriveSummaryCache = (charId: string): DriveSummaryItem[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(cacheKey(charId)) || '[]');
        return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.drive === 'string') : [];
    } catch {
        return [];
    }
};

export const fetchDriveSummary = async (charId: string, timeoutMs = 1500): Promise<DriveSummaryItem[]> => {
    if (!isAgentPaired()) return readDriveSummaryCache(charId);
    const config = loadAgentConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${config.baseUrl}/agent/v1/drives?charId=${encodeURIComponent(charId)}`, {
            headers: { Authorization: `Bearer ${config.deviceToken}` },
            signal: controller.signal,
        });
        if (!response.ok) return readDriveSummaryCache(charId);
        const body = await response.json();
        const drives = Array.isArray(body?.data?.drives) ? body.data.drives : Array.isArray(body?.drives) ? body.drives : [];
        try { localStorage.setItem(cacheKey(charId), JSON.stringify(drives)); } catch { /* 存不下就算了 */ }
        return drives;
    } catch {
        return readDriveSummaryCache(charId);
    } finally {
        clearTimeout(timer);
    }
};
// [EM-END: char-drives-cue]
