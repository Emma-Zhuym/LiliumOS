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
                rgb_color: [12, 34, 56], supported_color_modes: ['color_temp', 'hs'],
                min_color_temp_kelvin: 2500, max_color_temp_kelvin: 6500,
            },
        })).toMatchObject({
            kind: 'light', name: '床头灯', brightness: 50, colorTempKelvin: 3000,
            rgbColor: [12, 34, 56], supportedColorModes: ['color_temp', 'hs'],
            minColorTempKelvin: 2500, maxColorTempKelvin: 6500, available: true,
        });
        expect(stateToSmartHomeDevice({
            entity_id: 'fan.core_200s',
            state: 'unavailable',
            attributes: { percentage: 25, percentage_step: 25, preset_modes: ['manual', 'sleep'] },
        })).toMatchObject({ kind: 'fan', percentage: 25, speedCount: 4, available: false });
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

    it('joins purifier readings and useful switches without exposing display lock', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
            {
                entity_id: 'fan.vital_200s',
                state: 'on',
                attributes: {
                    friendly_name: 'Vital 200S', percentage: 50, percentage_step: 25,
                    preset_mode: 'auto', preset_modes: ['auto', 'sleep', 'pet', 'manual', 'diy'],
                },
            },
            { entity_id: 'sensor.vital_200s_pm2_5', state: '7', attributes: { device_class: 'pm25' } },
            { entity_id: 'sensor.vital_200s_filter_life', state: '100', attributes: { unit_of_measurement: '%' } },
            { entity_id: 'sensor.vital_200s_air_quality', state: 'very_good' },
            { entity_id: 'switch.vital_200s_display', state: 'on' },
            { entity_id: 'switch.vital_200s_light_detection', state: 'on' },
            { entity_id: 'switch.vital_200s_display_lock', state: 'off' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const devices = await fetchSmartHomeDevices(config);
        expect(devices).toHaveLength(1);
        expect(devices[0]).toMatchObject({
            entityId: 'fan.vital_200s',
            speedCount: 4,
            pm25: 7,
            filterLife: 100,
            airQuality: 'very_good',
            displayOn: true,
            displayEntityId: 'switch.vital_200s_display',
            nightAutoDisplayOff: true,
            nightAutoDisplayOffEntityId: 'switch.vital_200s_light_detection',
        });
        expect(devices[0]).not.toHaveProperty('displayLockEntityId');
        fetchMock.mockRestore();
    });

    it('groups Home Assistant air readings into one environment monitor', async () => {
        const states = [
            ['temperature', '24.1', 'temperature', '°C', '青萍空气监测器 温度'],
            ['humidity', '46', 'humidity', '%', '青萍空气监测器 湿度'],
            ['co2', '618', 'carbon_dioxide', 'ppm', '青萍空气监测器 CO₂'],
            ['pm2_5', '7', 'pm25', 'µg/m³', '青萍空气监测器 PM2.5'],
            ['pm10', '12', 'pm10', 'µg/m³', '青萍空气监测器 PM10'],
        ].map(([suffix, state, deviceClass, unit, friendlyName]) => ({
            entity_id: `sensor.qingping_air_monitor_lite_${suffix}`,
            state,
            attributes: {
                device_class: deviceClass,
                unit_of_measurement: unit,
                friendly_name: friendlyName,
            },
        }));
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(states), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        const devices = await fetchSmartHomeDevices(config);
        expect(devices).toHaveLength(1);
        expect(devices[0]).toMatchObject({
            entityId: 'monitor.qingping_air_monitor_lite',
            name: '青萍空气监测器',
            kind: 'monitor',
            available: true,
        });
        expect(devices[0].metrics).toEqual([
            expect.objectContaining({ key: 'temperature', value: 24.1, unit: '°C' }),
            expect.objectContaining({ key: 'humidity', value: 46, unit: '%' }),
            expect.objectContaining({ key: 'co2', value: 618, unit: 'ppm' }),
            expect.objectContaining({ key: 'pm25', value: 7, unit: 'µg/m³' }),
            expect.objectContaining({ key: 'pm10', value: 12, unit: 'µg/m³' }),
        ]);
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

        await sendSmartHomeCommand(config, {
            entityId: 'light.bedside', kind: 'light', action: 'set_rgb', value: [110, 72, 255],
        });
        expect(fetchMock.mock.calls[2][1]?.body).toBe(JSON.stringify({ entity_id: 'light.bedside', rgb_color: [110, 72, 255] }));

        await sendSmartHomeCommand(config, {
            entityId: 'switch.vital_200s_display', kind: 'switch', action: 'turn_off',
        });
        expect(fetchMock.mock.calls[3][0]).toBe('https://ha.example.com/api/services/switch/turn_off');
        expect(fetchMock.mock.calls[3][1]?.body).toBe(JSON.stringify({ entity_id: 'switch.vital_200s_display' }));
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
