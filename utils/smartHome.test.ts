import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_SMART_HOME_CONFIG,
    buildHomeAssistantMcpUrl,
    exportSmartHomeLocal,
    fetchSmartHomeDevices,
    importSmartHomeLocal,
    loadSmartHomeConfig,
    normalizeHomeAssistantBaseUrl,
    saveSmartHomeConfig,
    sendSmartHomeCommand,
    stateToSmartHomeDevice,
} from './smartHome';

describe('smartHome config', () => {
    beforeEach(() => localStorage.clear());

    it('normalizes regular and MCP Home Assistant URLs', () => {
        expect(normalizeHomeAssistantBaseUrl(' https://ha.example.com/ ')).toBe('https://ha.example.com');
        expect(normalizeHomeAssistantBaseUrl('https://ha.example.com/api/mcp/assist')).toBe('https://ha.example.com');
        expect(buildHomeAssistantMcpUrl('https://ha.example.com/api')).toBe('https://ha.example.com/api/mcp/assist');
    });

    it('round-trips local backup settings', () => {
        saveSmartHomeConfig({
            ...DEFAULT_SMART_HOME_CONFIG,
            baseUrl: 'https://ha.example.com/',
            token: 'secret',
            demoMode: false,
        });
        const backup = exportSmartHomeLocal();
        localStorage.clear();
        importSmartHomeLocal(backup);
        expect(loadSmartHomeConfig()).toMatchObject({
            baseUrl: 'https://ha.example.com',
            token: 'secret',
            demoMode: false,
        });
    });
});

describe('smartHome Home Assistant adapter', () => {
    const config = {
        ...DEFAULT_SMART_HOME_CONFIG,
        baseUrl: 'https://ha.example.com',
        token: 'token',
        demoMode: false,
    };

    it('maps light and fan states while ignoring unrelated entities', () => {
        expect(stateToSmartHomeDevice({
            entity_id: 'light.bedside',
            state: 'on',
            attributes: {
                friendly_name: '床头灯', brightness: 128, color_temp_kelvin: 3000,
                min_color_temp_kelvin: 2500, max_color_temp_kelvin: 6500,
            },
        })).toMatchObject({
            kind: 'light', name: '床头灯', brightness: 50, colorTempKelvin: 3000,
            minColorTempKelvin: 2500, maxColorTempKelvin: 6500, available: true,
        });
        expect(stateToSmartHomeDevice({
            entity_id: 'fan.core_200s',
            state: 'unavailable',
            attributes: { percentage: 33, preset_modes: ['manual', 'sleep'] },
        })).toMatchObject({ kind: 'fan', percentage: 33, available: false });
        expect(stateToSmartHomeDevice({ entity_id: 'sensor.temperature', state: '22' })).toBeNull();
    });

    it('discovers supported entities with Bearer auth', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
            { entity_id: 'sensor.temperature', state: '22' },
            { entity_id: 'fan.core_200s', state: 'on', attributes: { friendly_name: '净化器', percentage: 66 } },
            { entity_id: 'light.floor', state: 'off', attributes: { friendly_name: '落地灯' } },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const devices = await fetchSmartHomeDevices(config);
        expect(devices.map(device => device.entityId)).toEqual(['light.floor', 'fan.core_200s']);
        expect((fetchMock.mock.calls[0][1]?.headers as Headers).get('Authorization')).toBe('Bearer token');
        fetchMock.mockRestore();
    });

    it('uses service endpoints for device control', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        await sendSmartHomeCommand(config, {
            entityId: 'light.bedside', kind: 'light', action: 'set_brightness', value: 60,
        });
        expect(fetchMock.mock.calls[0][0]).toBe('https://ha.example.com/api/services/light/turn_on');
        expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ entity_id: 'light.bedside', brightness_pct: 60 }));

        await sendSmartHomeCommand(config, {
            entityId: 'light.bedside', kind: 'light', action: 'set_color_temp', value: 3200,
        });
        expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ entity_id: 'light.bedside', color_temp_kelvin: 3200 }));
        fetchMock.mockRestore();
    });

    it('wraps REST targets with the configured proxy', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        await fetchSmartHomeDevices({ ...config, proxyUrl: 'https://proxy.example.com/' });
        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://proxy.example.com?target=https%3A%2F%2Fha.example.com%2Fapi%2Fstates',
        );
        fetchMock.mockRestore();
    });
});
