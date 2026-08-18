import {
    createMcpServer,
    loadMcpServers,
    saveMcpServers,
    testMcpConnection,
    type McpServerConfig,
} from './mcpClient';

export type SmartHomeDeviceKind = 'light' | 'fan' | 'monitor' | 'scene';
export type SmartHomeConnectionState = 'online' | 'offline' | 'demo';
export type SmartHomeRgbColor = [number, number, number];
export type SmartHomeEnvironmentMetricKey = 'temperature' | 'humidity' | 'co2' | 'pm25' | 'pm10';

export interface SmartHomeEnvironmentMetric {
    key: SmartHomeEnvironmentMetricKey;
    label: string;
    value?: number;
    unit: string;
    entityId: string;
    available: boolean;
}

export interface SmartHomeConfig {
    baseUrl: string;
    token: string;
    proxyUrl: string;
    proxyKey: string;
    demoMode: boolean;
    mcpServerId?: string;
}

export interface HomeAssistantState {
    entity_id: string;
    state: string;
    attributes?: Record<string, unknown>;
    last_changed?: string;
    last_updated?: string;
}

export interface SmartHomeDevice {
    id: string;
    entityId: string;
    name: string;
    kind: SmartHomeDeviceKind;
    state: string;
    available: boolean;
    brightness?: number;
    rgbColor?: SmartHomeRgbColor;
    supportedColorModes?: string[];
    colorTempKelvin?: number;
    minColorTempKelvin?: number;
    maxColorTempKelvin?: number;
    percentage?: number;
    speedCount?: number;
    presetMode?: string;
    presetModes?: string[];
    airQuality?: string;
    pm25?: number;
    filterLife?: number;
    displayOn?: boolean;
    displayEntityId?: string;
    nightAutoDisplayOff?: boolean;
    nightAutoDisplayOffEntityId?: string;
    metrics?: SmartHomeEnvironmentMetric[];
    lastUpdated?: string;
}

export interface SmartHomeCommand {
    entityId: string;
    kind: SmartHomeDeviceKind | 'switch';
    action: 'turn_on' | 'turn_off' | 'activate' | 'set_brightness' | 'set_rgb' | 'set_color_temp' | 'set_percentage' | 'set_preset';
    value?: number | string | SmartHomeRgbColor;
}

const SMART_HOME_CONFIG_KEY = 'liliumos.smart_home.config';

export const DEFAULT_SMART_HOME_CONFIG: SmartHomeConfig = {
    baseUrl: '',
    token: '',
    proxyUrl: '',
    proxyKey: '',
    demoMode: true,
};

const trimTrailingSlash = (value: string): string => value.trim().replace(/\/+$/, '');

export const normalizeHomeAssistantBaseUrl = (value: string): string => {
    const trimmed = trimTrailingSlash(value);
    return trimmed.replace(/\/api(?:\/mcp(?:\/assist)?)?$/i, '');
};

export const loadSmartHomeConfig = (): SmartHomeConfig => {
    try {
        const raw = localStorage.getItem(SMART_HOME_CONFIG_KEY);
        if (!raw) return { ...DEFAULT_SMART_HOME_CONFIG };
        const parsed = JSON.parse(raw) as Partial<SmartHomeConfig>;
        return {
            ...DEFAULT_SMART_HOME_CONFIG,
            ...parsed,
            baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
            token: typeof parsed.token === 'string' ? parsed.token : '',
            proxyUrl: typeof parsed.proxyUrl === 'string' ? parsed.proxyUrl : '',
            proxyKey: typeof parsed.proxyKey === 'string' ? parsed.proxyKey : '',
            demoMode: parsed.demoMode !== false,
        };
    } catch {
        return { ...DEFAULT_SMART_HOME_CONFIG };
    }
};

export const saveSmartHomeConfig = (config: SmartHomeConfig): void => {
    const normalized = {
        ...config,
        baseUrl: normalizeHomeAssistantBaseUrl(config.baseUrl),
        proxyUrl: trimTrailingSlash(config.proxyUrl),
    };
    localStorage.setItem(SMART_HOME_CONFIG_KEY, JSON.stringify(normalized));
};

export const exportSmartHomeLocal = (): Record<string, string> | undefined => {
    try {
        const config = localStorage.getItem(SMART_HOME_CONFIG_KEY);
        return config ? { [SMART_HOME_CONFIG_KEY]: config } : undefined;
    } catch {
        return undefined;
    }
};

export const importSmartHomeLocal = (data: Record<string, string> | null | undefined): void => {
    if (!data || typeof data !== 'object') return;
    const value = data[SMART_HOME_CONFIG_KEY];
    if (typeof value !== 'string') return;
    try {
        const parsed = JSON.parse(value) as Partial<SmartHomeConfig>;
        saveSmartHomeConfig({ ...DEFAULT_SMART_HOME_CONFIG, ...parsed });
    } catch {
        // Ignore malformed optional settings while restoring the rest of a backup.
    }
};

const buildTargetUrl = (config: SmartHomeConfig, path: string): string => {
    const baseUrl = normalizeHomeAssistantBaseUrl(config.baseUrl);
    if (!baseUrl) throw new Error('请先填写 Home Assistant 地址');
    const target = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const proxy = trimTrailingSlash(config.proxyUrl);
    if (!proxy) return target;
    return `${proxy}${proxy.includes('?') ? '&' : '?'}target=${encodeURIComponent(target)}`;
};

const buildHeaders = (config: SmartHomeConfig, hasBody = false): Headers => {
    const headers = new Headers({ Accept: 'application/json' });
    if (hasBody) headers.set('Content-Type', 'application/json');
    if (config.token.trim()) headers.set('Authorization', `Bearer ${config.token.trim()}`);
    if (config.proxyUrl && config.proxyKey.trim()) headers.set('X-Proxy-Key', config.proxyKey.trim());
    return headers;
};

const requestJson = async <T>(config: SmartHomeConfig, path: string, init?: RequestInit): Promise<T> => {
    const hasBody = init?.body !== undefined;
    let response: Response;
    try {
        response = await fetch(buildTargetUrl(config, path), {
            ...init,
            headers: buildHeaders(config, hasBody),
        });
    } catch {
        throw new Error(config.proxyUrl
            ? '连接失败，请检查 Home Assistant 和代理地址'
            : '连接失败，可能需要在 Home Assistant 允许跨域，或填写代理地址');
    }
    if (response.status === 401) throw new Error('访问令牌无效或权限不足');
    if (!response.ok) throw new Error(`Home Assistant 返回 ${response.status}`);
    return response.json() as Promise<T>;
};

const asNumber = (value: unknown): number | undefined => {
    const result = Number(value);
    return Number.isFinite(result) ? result : undefined;
};

const asStringList = (value: unknown): string[] | undefined =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

const asRgbColor = (value: unknown): SmartHomeRgbColor | undefined => {
    if (!Array.isArray(value) || value.length < 3) return undefined;
    const channels = value.slice(0, 3).map(asNumber);
    if (channels.some(channel => channel === undefined)) return undefined;
    return channels.map(channel => Math.max(0, Math.min(255, Math.round(channel!)))) as SmartHomeRgbColor;
};

const ENVIRONMENT_METRIC_ORDER: SmartHomeEnvironmentMetricKey[] = ['temperature', 'humidity', 'co2', 'pm25', 'pm10'];

const ENVIRONMENT_METRIC_META: Record<SmartHomeEnvironmentMetricKey, { label: string; unit: string }> = {
    temperature: { label: '温度', unit: '°C' },
    humidity: { label: '湿度', unit: '%' },
    co2: { label: 'CO₂', unit: 'ppm' },
    pm25: { label: 'PM2.5', unit: 'µg/m³' },
    pm10: { label: 'PM10', unit: 'µg/m³' },
};

const metricKeyForState = (entity: HomeAssistantState): SmartHomeEnvironmentMetricKey | null => {
    if (!entity.entity_id.startsWith('sensor.')) return null;
    const attributes = entity.attributes || {};
    const deviceClass = typeof attributes.device_class === 'string' ? attributes.device_class.toLowerCase() : '';
    const friendlyName = typeof attributes.friendly_name === 'string' ? attributes.friendly_name.toLowerCase() : '';
    const searchable = `${entity.entity_id.toLowerCase()} ${deviceClass} ${friendlyName}`;
    if (/pm(?:_|\s)?2(?:_|\.|\s)?5/.test(searchable) || deviceClass === 'pm25') return 'pm25';
    if (/pm(?:_|\s)?10/.test(searchable) || deviceClass === 'pm10') return 'pm10';
    if (/carbon[_\s-]?dioxide|\bco2\b|co₂/.test(searchable) || deviceClass === 'carbon_dioxide') return 'co2';
    if (/temperature|温度/.test(searchable) || deviceClass === 'temperature') return 'temperature';
    if (/humidity|湿度/.test(searchable) || deviceClass === 'humidity') return 'humidity';
    return null;
};

const stripMetricSuffix = (value: string): string => value
    .replace(/(?:[_\s-]+)(?:temperature|humidity|carbon[_\s-]?dioxide|co2|pm(?:[_\s.]?2[_\s.]?5)|pm(?:[_\s.]?10))$/i, '')
    .replace(/(?:\s*)(?:温度|湿度|二氧化碳|CO₂|PM2\.5|PM10)$/i, '')
    .trim();

const buildEnvironmentMonitors = (states: HomeAssistantState[]): SmartHomeDevice[] => {
    const groups = new Map<string, { name: string; metrics: SmartHomeEnvironmentMetric[]; lastUpdated?: string }>();
    states.forEach(entity => {
        const key = metricKeyForState(entity);
        if (!key) return;
        const objectId = entity.entity_id.split('.').slice(1).join('.');
        const groupId = stripMetricSuffix(objectId) || objectId;
        const attributes = entity.attributes || {};
        const friendlyName = typeof attributes.friendly_name === 'string' ? attributes.friendly_name : '';
        const groupName = stripMetricSuffix(friendlyName)
            || groupId.replace(/[_.-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
        const meta = ENVIRONMENT_METRIC_META[key];
        const unit = typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement : meta.unit;
        const value = asNumber(entity.state);
        const available = entity.state !== 'unavailable' && entity.state !== 'unknown' && value !== undefined;
        const group = groups.get(groupId) || { name: groupName, metrics: [], lastUpdated: entity.last_updated };
        group.metrics = group.metrics.filter(metric => metric.key !== key);
        group.metrics.push({ key, label: meta.label, value, unit, entityId: entity.entity_id, available });
        if (entity.last_updated && (!group.lastUpdated || entity.last_updated > group.lastUpdated)) {
            group.lastUpdated = entity.last_updated;
        }
        groups.set(groupId, group);
    });

    return Array.from(groups.entries())
        .filter(([, group]) => group.metrics.length >= 2)
        .map(([groupId, group]) => {
            const metrics = [...group.metrics].sort(
                (a, b) => ENVIRONMENT_METRIC_ORDER.indexOf(a.key) - ENVIRONMENT_METRIC_ORDER.indexOf(b.key),
            );
            const available = metrics.some(metric => metric.available);
            return {
                id: `monitor.${groupId}`,
                entityId: `monitor.${groupId}`,
                name: group.name,
                kind: 'monitor' as const,
                state: available ? 'measuring' : 'unavailable',
                available,
                metrics,
                lastUpdated: group.lastUpdated,
            };
        });
};

const entityObjectId = (entityId: string): string => entityId.split('.').slice(1).join('.').toLowerCase();

const stateBoolean = (entity: HomeAssistantState | undefined): boolean | undefined => {
    if (!entity) return undefined;
    if (entity.state === 'on') return true;
    if (entity.state === 'off') return false;
    return undefined;
};

const enrichFanDevice = (device: SmartHomeDevice, states: HomeAssistantState[]): SmartHomeDevice => {
    const fanObjectId = entityObjectId(device.entityId);
    const related = states.filter(entity => {
        const objectId = entityObjectId(entity.entity_id);
        return objectId.startsWith(`${fanObjectId}_`);
    });
    const findRelated = (domain: string, patterns: RegExp[]): HomeAssistantState | undefined => related.find(entity => {
        if (!entity.entity_id.startsWith(`${domain}.`)) return false;
        const objectId = entityObjectId(entity.entity_id);
        return patterns.some(pattern => pattern.test(objectId));
    });
    const filterLifeState = findRelated('sensor', [/filter[_-]?(?:life|remaining)/i]);
    const pm25State = findRelated('sensor', [/pm(?:_|\.)?2(?:_|\.)?5/i, /pm25/i]);
    const airQualityState = findRelated('sensor', [/air[_-]?quality/i]);
    const displayState = findRelated('switch', [/(?:^|_)display$/i, /screen$/i]);
    const nightAutoDisplayState = findRelated('switch', [
        /light[_-]?detection/i,
        /auto(?:matic)?[_-]?(?:display|screen)/i,
        /night[_-]?(?:display|screen)/i,
    ]);
    const filterLife = asNumber(filterLifeState?.state);
    const pm25 = asNumber(pm25State?.state);
    const airQuality = airQualityState
        && airQualityState.state !== 'unknown'
        && airQualityState.state !== 'unavailable'
        ? airQualityState.state
        : undefined;
    return {
        ...device,
        filterLife: filterLife ?? device.filterLife,
        pm25: pm25 ?? device.pm25,
        airQuality: airQuality ?? device.airQuality,
        displayOn: stateBoolean(displayState) ?? device.displayOn,
        displayEntityId: displayState?.entity_id ?? device.displayEntityId,
        nightAutoDisplayOff: stateBoolean(nightAutoDisplayState) ?? device.nightAutoDisplayOff,
        nightAutoDisplayOffEntityId: nightAutoDisplayState?.entity_id ?? device.nightAutoDisplayOffEntityId,
    };
};

export const stateToSmartHomeDevice = (entity: HomeAssistantState): SmartHomeDevice | null => {
    const [domain] = entity.entity_id.split('.');
    if (domain !== 'light' && domain !== 'fan' && domain !== 'scene') return null;
    const attributes = entity.attributes || {};
    const rawBrightness = asNumber(attributes.brightness);
    const percentageStep = asNumber(attributes.percentage_step);
    const name = typeof attributes.friendly_name === 'string'
        ? attributes.friendly_name
        : entity.entity_id.split('.').slice(1).join(' ').replace(/_/g, ' ');
    return {
        id: entity.entity_id,
        entityId: entity.entity_id,
        name,
        kind: domain,
        state: entity.state,
        available: entity.state !== 'unavailable' && entity.state !== 'unknown',
        brightness: rawBrightness === undefined ? undefined : Math.round((rawBrightness / 255) * 100),
        rgbColor: asRgbColor(attributes.rgb_color),
        supportedColorModes: asStringList(attributes.supported_color_modes),
        colorTempKelvin: asNumber(attributes.color_temp_kelvin),
        minColorTempKelvin: asNumber(attributes.min_color_temp_kelvin),
        maxColorTempKelvin: asNumber(attributes.max_color_temp_kelvin),
        percentage: asNumber(attributes.percentage),
        speedCount: asNumber(attributes.speed_count)
            ?? (percentageStep ? Math.max(1, Math.round(100 / percentageStep)) : undefined),
        presetMode: typeof attributes.preset_mode === 'string' ? attributes.preset_mode : undefined,
        presetModes: asStringList(attributes.preset_modes),
        airQuality: typeof attributes.air_quality === 'string' ? attributes.air_quality : undefined,
        pm25: asNumber(attributes.pm2_5) ?? asNumber(attributes.pm25),
        filterLife: asNumber(attributes.filter_life),
        lastUpdated: entity.last_updated,
    };
};

export const testHomeAssistantConnection = async (config: SmartHomeConfig): Promise<string> => {
    const data = await requestJson<{ message?: string }>(config, '/api/');
    return data.message || 'API running.';
};

export const fetchSmartHomeDevices = async (config: SmartHomeConfig): Promise<SmartHomeDevice[]> => {
    const states = await requestJson<HomeAssistantState[]>(config, '/api/states');
    const controllableDevices = states
        .map(stateToSmartHomeDevice)
        .filter((device): device is SmartHomeDevice => device !== null)
        .map(device => device.kind === 'fan' ? enrichFanDevice(device, states) : device);
    return [...controllableDevices, ...buildEnvironmentMonitors(states)]
        .sort((a, b) => {
            const order: Record<SmartHomeDeviceKind, number> = { light: 0, fan: 1, monitor: 2, scene: 3 };
            return order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, 'zh-CN');
        });
};

const serviceForCommand = (command: SmartHomeCommand): { domain: string; service: string; data: Record<string, unknown> } => {
    const data: Record<string, unknown> = { entity_id: command.entityId };
    if (command.action === 'activate') return { domain: 'scene', service: 'turn_on', data };
    if (command.action === 'turn_on' || command.action === 'turn_off') {
        return { domain: command.kind, service: command.action, data };
    }
    if (command.action === 'set_brightness') {
        data.brightness_pct = Number(command.value);
        return { domain: 'light', service: 'turn_on', data };
    }
    if (command.action === 'set_rgb') {
        const rgbColor = asRgbColor(command.value);
        if (!rgbColor) throw new Error('RGB 颜色格式无效');
        data.rgb_color = rgbColor;
        return { domain: 'light', service: 'turn_on', data };
    }
    if (command.action === 'set_color_temp') {
        data.color_temp_kelvin = Number(command.value);
        return { domain: 'light', service: 'turn_on', data };
    }
    if (command.action === 'set_percentage') {
        data.percentage = Number(command.value);
        return { domain: 'fan', service: 'set_percentage', data };
    }
    data.preset_mode = String(command.value || '');
    return { domain: 'fan', service: 'set_preset_mode', data };
};

export const sendSmartHomeCommand = async (config: SmartHomeConfig, command: SmartHomeCommand): Promise<void> => {
    const { domain, service, data } = serviceForCommand(command);
    await requestJson<unknown[]>(config, `/api/services/${domain}/${service}`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
};

export const buildHomeAssistantMcpUrl = (baseUrl: string): string =>
    `${normalizeHomeAssistantBaseUrl(baseUrl)}/api/mcp/assist`;

export const enableHomeAssistantMcp = async (
    config: SmartHomeConfig,
): Promise<{ config: SmartHomeConfig; message: string }> => {
    const url = buildHomeAssistantMcpUrl(config.baseUrl);
    const servers = loadMcpServers();
    const existing = servers.find(server => server.id === config.mcpServerId)
        || servers.find(server => server.url === url);
    const base: McpServerConfig = existing || createMcpServer('Home Assistant', url);
    const server: McpServerConfig = {
        ...base,
        name: base.name || 'Home Assistant',
        url,
        token: config.token.trim(),
        proxyUrl: trimTrailingSlash(config.proxyUrl) || undefined,
        proxyKey: config.proxyKey.trim() || undefined,
        enabled: false,
        updatedAt: Date.now(),
    };
    const result = await testMcpConnection(server);
    if (!result.ok) throw new Error(result.message);
    const connected = { ...server, enabled: true, tools: result.tools || [], updatedAt: Date.now() };
    const nextServers = existing
        ? servers.map(item => item.id === existing.id ? connected : item)
        : [...servers, connected];
    saveMcpServers(nextServers);
    const nextConfig = { ...config, mcpServerId: connected.id };
    saveSmartHomeConfig(nextConfig);
    return { config: nextConfig, message: result.message };
};

export const createDemoSmartHomeDevices = (): SmartHomeDevice[] => [
    {
        id: 'light.bedside', entityId: 'light.bedside', name: '床头灯', kind: 'light',
        state: 'on', available: true, brightness: 38, rgbColor: [255, 238, 210],
        supportedColorModes: ['color_temp', 'hs'], colorTempKelvin: 3000,
        minColorTempKelvin: 2500, maxColorTempKelvin: 6500,
    },
    {
        id: 'light.floor', entityId: 'light.floor', name: '落地灯', kind: 'light',
        state: 'off', available: true, brightness: 70, rgbColor: [255, 255, 255],
        supportedColorModes: ['color_temp', 'hs'], colorTempKelvin: 4000,
        minColorTempKelvin: 2500, maxColorTempKelvin: 6500,
    },
    {
        id: 'fan.air_purifier', entityId: 'fan.air_purifier', name: '空气净化器', kind: 'fan',
        state: 'on', available: true, percentage: 50, speedCount: 4,
        presetMode: 'auto', presetModes: ['auto', 'sleep', 'pet', 'manual'],
        airQuality: 'very_good', pm25: 7, filterLife: 100,
        displayOn: true, displayEntityId: 'switch.air_purifier_display',
        nightAutoDisplayOff: true, nightAutoDisplayOffEntityId: 'switch.air_purifier_light_detection',
    },
    {
        id: 'monitor.air_station', entityId: 'monitor.air_station', name: '空气监测器', kind: 'monitor',
        state: 'measuring', available: true,
        metrics: [
            { key: 'temperature', label: '温度', value: 24.1, unit: '°C', entityId: 'sensor.air_station_temperature', available: true },
            { key: 'humidity', label: '湿度', value: 46, unit: '%', entityId: 'sensor.air_station_humidity', available: true },
            { key: 'co2', label: 'CO₂', value: 618, unit: 'ppm', entityId: 'sensor.air_station_co2', available: true },
            { key: 'pm25', label: 'PM2.5', value: 7, unit: 'µg/m³', entityId: 'sensor.air_station_pm25', available: true },
            { key: 'pm10', label: 'PM10', value: 12, unit: 'µg/m³', entityId: 'sensor.air_station_pm10', available: true },
        ],
    },
    {
        id: 'scene.good_night', entityId: 'scene.good_night', name: '晚安', kind: 'scene',
        state: 'scening', available: true,
    },
];
