import { describe, expect, it } from 'vitest';
import { HEARTBEAT_API_CHAT, resolveHeartbeatApi } from './emHeartbeatApi';
import type { APIConfig, ApiPreset } from '../types';

const globalApi = { baseUrl: 'https://main.example/v1', apiKey: 'k-main', model: 'main-model' } as APIConfig;
const presets: ApiPreset[] = [
    { id: 'p-cheap', name: '便宜的', config: { baseUrl: 'https://cheap.example/v1', apiKey: 'k-cheap', model: 'cheap-model' } as APIConfig },
];
const secondary = { baseUrl: 'https://second.example/v1', apiKey: 'k-2', model: 'second-model' };

describe('心跳用哪套 API', () => {
    it('没选：副 API 优先，没有就跟聊天 API', () => {
        expect(resolveHeartbeatApi({ proactiveConfig: { secondaryApi: secondary } } as any, globalApi, presets).label).toBe('副 API');
        const noSecondary = resolveHeartbeatApi({} as any, globalApi, presets);
        expect(noSecondary.label).toBe('聊天 API');
        expect(noSecondary.model).toBe('main-model');
    });

    it('选「跟聊天 API」：有副 API 也不用它', () => {
        const out = resolveHeartbeatApi({ heartbeatApiPresetId: HEARTBEAT_API_CHAT, proactiveConfig: { secondaryApi: secondary } } as any, globalApi, presets);
        expect(out.model).toBe('main-model');
    });

    it('选某个预设就用它；下拉里刚选的优先于角色身上存的', () => {
        expect(resolveHeartbeatApi({ heartbeatApiPresetId: 'p-cheap' } as any, globalApi, presets)).toMatchObject({ model: 'cheap-model', label: '便宜的' });
        expect(resolveHeartbeatApi({ heartbeatApiPresetId: HEARTBEAT_API_CHAT } as any, globalApi, presets, 'p-cheap').model).toBe('cheap-model');
    });

    it('选的预设删掉了：退回自动并说出来', () => {
        const out = resolveHeartbeatApi({ heartbeatApiPresetId: 'gone', proactiveConfig: { secondaryApi: secondary } } as any, globalApi, presets);
        expect(out.label).toBe('副 API');
        expect(out.missingPresetId).toBe('gone');
    });
});
