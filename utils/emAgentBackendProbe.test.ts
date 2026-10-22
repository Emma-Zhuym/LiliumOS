// [EM-START: agent-backend-cors-probe]
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentBackend, resetBackendProbeForTest, saveAgentConfig } from './emAgentBackend';
import { resetReachabilityProbeCooldown } from './networkFailureDiagnosis';

const failThen = (probe: 'ok' | 'fail') => vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.mode === 'no-cors') {
        if (probe === 'ok') return { ok: false, status: 0, type: 'opaque' } as unknown as Response;
        throw new TypeError('Load failed');
    }
    throw new TypeError('Failed to fetch');
});

beforeEach(() => {
    localStorage.clear();
    resetBackendProbeForTest();
    resetReachabilityProbeCooldown();
    saveAgentConfig({ baseUrl: 'https://mini.example', deviceToken: 'tok', deviceId: 'd1' });
});

describe('连不上 mini 时分清是不在线还是被浏览器拦', () => {
    it('连 mini 的请求和探测都不点亮 SYSTEM ERROR（界面自己显示休息中）', async () => {
        const fetchMock = failThen('fail');
        vi.stubGlobal('fetch', fetchMock);
        await expect(AgentBackend.status()).rejects.toMatchObject({ code: 'UNREACHABLE' });
        expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
        for (const [, init] of fetchMock.mock.calls) {
            expect((init as { __sullySuppressNetworkFailureLog?: boolean }).__sullySuppressNetworkFailureLog).toBe(true);
        }
    });

    it('no-cors 碰得到：mini 在线，报 BLOCKED（多半是 CORS）', async () => {
        vi.stubGlobal('fetch', failThen('ok'));
        await expect(AgentBackend.status()).rejects.toMatchObject({ code: 'BLOCKED' });
    });

    it('no-cors 也碰不到：真的连不上，仍是 UNREACHABLE（界面显示休息中）', async () => {
        vi.stubGlobal('fetch', failThen('fail'));
        await expect(AgentBackend.status()).rejects.toMatchObject({ code: 'UNREACHABLE' });
    });

    it('30 秒内同一个地址只探一次', async () => {
        const fetchMock = failThen('ok');
        vi.stubGlobal('fetch', fetchMock);
        await expect(AgentBackend.status()).rejects.toMatchObject({ code: 'BLOCKED' });
        await expect(AgentBackend.status()).rejects.toMatchObject({ code: 'BLOCKED' });
        const probes = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.mode === 'no-cors');
        expect(probes).toHaveLength(1);
    });
});
// [EM-END: agent-backend-cors-probe]
