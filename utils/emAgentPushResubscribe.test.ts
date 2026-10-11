// [EM-START: agent-push-resubscribe]
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./proactivePushConfig', () => ({
    getOrCreateSubscription: vi.fn(async () => ({ sub: { endpoint: currentEndpoint, p256dh: 'p', auth: 'a' } })),
}));
vi.mock('./pushVapid', () => ({ loadPushVapid: () => ({ vapidPublicKey: 'vapid' }) }));

let currentEndpoint = 'https://web.push.apple.com/new';
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { ok: true } }) }));

import { ensureAgentPushRegistered, resetAgentPushCheckForTest, saveAgentConfig } from './emAgentBackend';

beforeEach(() => {
    localStorage.clear();
    resetAgentPushCheckForTest();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Notification', { permission: 'granted' });
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
        configurable: true,
        value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => ({ endpoint: currentEndpoint }) } }) },
    });
    saveAgentConfig({ baseUrl: 'https://mini.example', deviceToken: 'tok', deviceId: 'd1' });
});

describe('手机换了推送订阅就重新登记给 mini', () => {
    it('从没登记过（或换过）：登记一次，记住地址', async () => {
        expect(await ensureAgentPushRegistered(1_000_000)).toBe('registered');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/devices/push');
    });

    it('地址没变：不打扰后端；10 分钟内不重复检查', async () => {
        await ensureAgentPushRegistered(1_000_000);
        fetchMock.mockClear();
        resetAgentPushCheckForTest();
        expect(await ensureAgentPushRegistered(2_000_000)).toBe('unchanged');
        expect(await ensureAgentPushRegistered(2_000_001)).toBe('skipped');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('订阅被换掉了：重新登记', async () => {
        await ensureAgentPushRegistered(1_000_000);
        currentEndpoint = 'https://web.push.apple.com/replaced';
        resetAgentPushCheckForTest();
        expect(await ensureAgentPushRegistered(3_000_000)).toBe('registered');
    });

    it('订阅被系统收回了（以前登记过）：重新订一份并登记；从没登记过的不替用户订', async () => {
        const noSub = { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) };
        Object.defineProperty(globalThis.navigator, 'serviceWorker', { configurable: true, value: noSub });
        expect(await ensureAgentPushRegistered(1_000_000)).toBe('skipped');
        expect(fetchMock).not.toHaveBeenCalled();
        localStorage.setItem('em_agent_push_endpoint_v1', 'https://web.push.apple.com/old');
        resetAgentPushCheckForTest();
        expect(await ensureAgentPushRegistered(2_000_000)).toBe('registered');
        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/devices/push');
    });

    it('没授权通知就什么都不做（绝不弹权限框）', async () => {
        vi.stubGlobal('Notification', { permission: 'default' });
        expect(await ensureAgentPushRegistered(1_000_000)).toBe('skipped');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
// [EM-END: agent-push-resubscribe]
