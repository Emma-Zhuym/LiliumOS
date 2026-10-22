// [EM-START: settings-ios-list]
/**
 * 系统设置改成苹果式分组列表（2026-10-21 阿萌定）：首页一列短行、右边直接写状态，
 * 点一行推进子页；原来那一大块一大块的内容原样搬进子页，不再原地展开。
 *
 * 这里只放纯逻辑：有哪些子页、标题、首页右侧那几句状态怎么说、什么时候冒提醒行。
 * 不带依赖，方便单测。
 */

export type SettingsPageId =
    | 'profile'
    | 'api-main' | 'api-vision' | 'api-image' | 'voice'
    | 'mcp' | 'realtime' | 'web-fetch' | 'intiface' | 'proxy'
    | 'backup' | 'storage' | 'external-images'
    | 'mini' | 'amsg' | 'push'
    | 'appearance' | 'about';

export const SETTINGS_PAGE_TITLES: Record<SettingsPageId, string> = {
    profile: '个人档案',
    'api-main': '主 API',
    'api-vision': '识图',
    'api-image': '生图',
    voice: '语音与写歌',
    mcp: 'MCP 工具',
    realtime: '实时感知',
    'web-fetch': '网页抓取',
    intiface: 'Intiface 硬件',
    proxy: 'Worker 代理',
    backup: '备份与恢复',
    storage: '存储空间',
    'external-images': '外链图片',
    mini: 'Mac mini',
    amsg: '主动消息 2.0',
    push: '推送',
    appearance: '外观急救',
    about: '关于',
};

/** 一页里放了不止一块原内容时，每块要露出自己的小标题，不然分不清。 */
export const MULTI_SECTION_PAGES: ReadonlySet<SettingsPageId> = new Set<SettingsPageId>(['backup', 'push']);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 「刚刚 / 12 分钟前 / 3 小时前 / 4 天前」。未来的时间（钟不准）也算刚刚。 */
export function relativeAgo(ts: number, now: number): string {
    const diff = now - ts;
    if (!Number.isFinite(diff) || diff < MINUTE) return '刚刚';
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
    return `${Math.floor(diff / DAY)} 天前`;
}

export interface McpCheckResult {
    id: string;
    name: string;
    ok: boolean;
    message: string;
    toolCount: number;
}

export interface McpHealth {
    checkedAt: number;
    results: McpCheckResult[];
}

/** 首页 MCP 那一行：没配 / 测试中 / 「4/5 在线」。bad = 有连不上的。 */
export function mcpRowValue(health: McpHealth | null, configuredCount: number, checking: boolean): { text: string; bad: boolean; dot: boolean } {
    if (!configuredCount) return { text: '未设置', bad: false, dot: false };
    if (!health) return { text: checking ? '正在测…' : `${configuredCount} 台`, bad: false, dot: false };
    const online = health.results.filter(r => r.ok).length;
    const total = health.results.length;
    if (!total) return { text: '都关着', bad: false, dot: false };
    return { text: `${online}/${total} 在线`, bad: online < total, dot: true };
}

export type MiniState = 'unpaired' | 'online' | 'resting' | 'revoked' | 'blocked' | 'unknown';

export function miniRowValue(state: MiniState): { text: string; dot: 'ok' | 'bad' | null } {
    switch (state) {
        case 'unpaired': return { text: '没配对', dot: null };
        case 'online': return { text: '在线', dot: 'ok' };
        case 'resting': return { text: '休息中', dot: null };
        case 'revoked': return { text: '要重新配对', dot: 'bad' };
        case 'blocked': return { text: '被浏览器拦了', dot: 'bad' };
        default: return { text: '…', dot: null };
    }
}

export interface SettingsAlert {
    id: 'backup-stale' | 'instant-push-on' | 'mini-revoked';
    title: string;
    detail?: string;
    page: SettingsPageId;
}

/**
 * 提醒行只在有事要管时出现（借苹果「iPhone 尚未备份」那一行）。
 * staleBackupDays 沿用 autoCloudBackup 的口径：null = 不用提醒；Infinity = 从没成功过。
 */
export function settingsAlerts(input: {
    staleBackupDays: number | null;
    instantPushOn: boolean;
    miniState: MiniState;
}): SettingsAlert[] {
    const alerts: SettingsAlert[] = [];
    if (input.staleBackupDays !== null) {
        alerts.push({
            id: 'backup-stale',
            title: input.staleBackupDays === Infinity ? '云端备份还没成功过' : `已经 ${input.staleBackupDays} 天没备份`,
            page: 'backup',
        });
    }
    if (input.instantPushOn) {
        alerts.push({
            id: 'instant-push-on',
            title: 'Instant Push 还开着',
            detail: '它已经停用了，还会抢在 mini 前面接走聊天',
            page: 'push',
        });
    }
    if (input.miniState === 'revoked') {
        alerts.push({ id: 'mini-revoked', title: 'Mac mini 要重新配对', page: 'mini' });
    }
    return alerts;
}
// [EM-END: settings-ios-list]
