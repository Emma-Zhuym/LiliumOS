// [EM-START: agent-backend-client]
/**
 * Mac mini 私人 Agent 后端（server/agent-backend）的前端客户端。
 *
 * 与主动消息 2.0（amsg）**完全无关**：不同地址、不同凭据、不同协议版本。这个后端连不上时
 * 一切照旧——聊天、amsg 定时主动消息都不受影响（契约见 docs/agent-backend-design.md）。
 *
 * 设备钥匙只存本机 localStorage，**不进完整备份**：它是「这台设备」的凭据，跟着备份跑到
 * 另一台机器上就成了两台共用一把钥匙，想单独吊销都做不到。
 */

import { getOrCreateSubscription } from './proactivePushConfig';
import { loadPushVapid } from './pushVapid';

const STORAGE_KEY = 'em_agent_backend_v1';

export interface AgentBackendConfig {
    /** 形如 https://<device>.<tailnet>.ts.net，不带 /agent/v1 */
    baseUrl: string;
    deviceId: string;
    deviceToken: string;
    deviceName: string;
    updatedAt?: number;
}

const EMPTY: AgentBackendConfig = { baseUrl: '', deviceId: '', deviceToken: '', deviceName: '' };

export const loadAgentConfig = (): AgentBackendConfig => {
    if (typeof localStorage === 'undefined') return { ...EMPTY };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<AgentBackendConfig>) };
    } catch { /* 读不出来按没配处理 */ }
    return { ...EMPTY };
};

export const saveAgentConfig = (next: Partial<AgentBackendConfig>): AgentBackendConfig => {
    const merged: AgentBackendConfig = { ...loadAgentConfig(), ...next, updatedAt: Date.now() };
    merged.baseUrl = merged.baseUrl.trim().replace(/\/+$/, '');
    if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch { /* 存不下就下次再说 */ }
    }
    return merged;
};

/** 解除本机与后端的绑定。只清本机凭据，后端那边的设备行要在设置页里单独作废。 */
export const clearAgentConfig = (): void => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
};

export const isAgentPaired = (config = loadAgentConfig()): boolean =>
    Boolean(config.baseUrl && config.deviceToken);

export interface AgentDependency { ok: boolean; detail?: string; activeDevices?: number }

export interface AgentStatus {
    version: string;
    apiVersion: number;
    now: string;
    quiet: { active: boolean; start: string; end: string; timezone: string };
    deps: Record<string, AgentDependency>;
    capabilities: string[];
}

export interface AgentDevice {
    id: string;
    name: string;
    pushStatus: 'none' | 'active' | 'gone';
    createdAt: string;
    lastSeenAt: string | null;
    revokedAt: string | null;
}

export interface AgentMessage {
    id: number;
    messageId: string;
    charId: string | null;
    jobUuid: string | null;
    kind: 'chat_message' | 'job_result' | 'system_notice';
    payload: Record<string, unknown> & { text?: string; detail?: string };
    createdAt: string;
}

export class AgentBackendError extends Error {
    constructor(message: string, readonly code: string, readonly status: number) {
        super(message);
        this.name = 'AgentBackendError';
    }
}

const REQUEST_TIMEOUT_MS = 15_000;

const request = async <T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; config?: AgentBackendConfig; auth?: boolean } = {},
): Promise<T> => {
    const config = init.config ?? loadAgentConfig();
    if (!config.baseUrl) throw new AgentBackendError('还没填后端地址', 'NO_BASE_URL', 0);
    const needsAuth = init.auth !== false;
    if (needsAuth && !config.deviceToken) throw new AgentBackendError('这台设备还没配对', 'NOT_PAIRED', 0);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(`${config.baseUrl}/agent/v1${path}`, {
            method: init.method ?? 'GET',
            headers: {
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                ...(needsAuth ? { Authorization: `Bearer ${config.deviceToken}` } : {}),
            },
            body: init.body ? JSON.stringify(init.body) : undefined,
            signal: controller.signal,
        });
    } catch (cause) {
        // 后端休眠、Tailscale 没开、地址填错，浏览器给的都是同一句 "Failed to fetch"。
        // 这里统一成一个可识别的 code，上层据此显示「后台休息中」而不是报错。
        const reason = controller.signal.aborted ? '超时没响应' : (cause as Error)?.message || '连不上';
        throw new AgentBackendError(`连不上 Mac mini 后端（${reason}）`, 'UNREACHABLE', 0);
    } finally {
        clearTimeout(timer);
    }

    let parsed: { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } = {};
    try { parsed = await response.json(); } catch { /* 非 JSON 响应按下面的状态码处理 */ }
    if (!response.ok || parsed.ok === false) {
        throw new AgentBackendError(
            parsed.error?.message || `后端返回 ${response.status}`,
            parsed.error?.code || 'HTTP_ERROR',
            response.status,
        );
    }
    return parsed.data as T;
};

export const AgentBackend = {
    /** 配对：拿 6 位码换这台设备的钥匙，成功后写入本机配置。 */
    async pair(baseUrl: string, code: string, deviceName: string): Promise<AgentBackendConfig> {
        const config = { ...loadAgentConfig(), baseUrl: baseUrl.trim().replace(/\/+$/, '') };
        const data = await request<{ deviceId: string; deviceToken: string }>('/pair', {
            method: 'POST', body: { code, deviceName }, config, auth: false,
        });
        return saveAgentConfig({ ...config, deviceId: data.deviceId, deviceToken: data.deviceToken, deviceName });
    },

    status: () => request<AgentStatus>('/status'),
    devices: () => request<{ devices: AgentDevice[] }>('/devices').then(data => data.devices),
    revokeDevice: (deviceId: string) => request<{ ok: true }>('/devices/revoke', { method: 'POST', body: { deviceId } }),

    /**
     * 把本机的推送订阅登记到后端。
     *
     * 复用站点现有的那份订阅（同一对 VAPID）：一个浏览器只有一份订阅，用别的密钥去订阅会把
     * amsg 那份顶掉，推送就全断了——8-18 事故的同款坑。所以密钥没配时直接拒绝，不自作主张。
     */
    async registerPush(): Promise<{ ok: boolean; reason?: string }> {
        const vapid = loadPushVapid();
        if (!vapid.vapidPublicKey) {
            return { ok: false, reason: '还没配置推送凭据（VAPID），先在主动消息设置里生成或填入' };
        }
        const attempt = await getOrCreateSubscription(vapid.vapidPublicKey);
        if (!attempt.sub) return { ok: false, reason: attempt.reason || '浏览器没有给出推送订阅' };
        await request<{ ok: true }>('/devices/push', {
            method: 'POST',
            body: { subscription: { endpoint: attempt.sub.endpoint, keys: { p256dh: attempt.sub.p256dh, auth: attempt.sub.auth } } },
        });
        return { ok: true };
    },

    /** 排一个连通测试任务（后端目前只允许客户端建这一种）。 */
    testPing: () => request<{ job: { uuid: string } }>('/jobs', {
        method: 'POST',
        body: {
            kind: 'test.ping',
            runAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        },
    }),

    inbox: () => request<{ messages: AgentMessage[] }>('/outbox').then(data => data.messages),
    ackInbox: (messageIds: string[]) => request<{ acked: number }>('/outbox/ack', {
        method: 'POST', body: { messageIds },
    }),
};

/**
 * 打开 App 时补收一次。
 *
 * 全程静默：没配对、后端休眠、网络不通都直接返回，不弹错、不打日志噪音——后台服务不在线
 * 是正常状态，不是故障。返回收到的消息供调用方展示。
 */
export const syncAgentInbox = async (): Promise<AgentMessage[]> => {
    if (!isAgentPaired()) return [];
    try {
        const messages = await AgentBackend.inbox();
        if (messages.length > 0) {
            await AgentBackend.ackInbox(messages.map(message => message.messageId));
        }
        return messages;
    } catch {
        return [];
    }
};
// [EM-END: agent-backend-client]
