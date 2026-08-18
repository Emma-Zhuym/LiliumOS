import {
    createMcpServer,
    loadMcpServers,
    saveMcpServers,
    testMcpConnection,
    type McpServerConfig,
} from './mcpClient';

export type SmartHomeDeviceKind = 'light' | 'fan' | 'scene';
export type SmartHomeConnectionState = 'online' | 'offline' | 'demo';

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
    colorTempKelvin?: number;
    minColorTempKelvin?: number;
    maxColorTempKelvin?: number;
    percentage?: number;
    presetMode?: string;
    presetModes?: string[];
    lastUpdated?: string;
}

export interface SmartHomeCommand {
    entityId: string;
    kind: SmartHomeDeviceKind;
    action: 'turn_on' | 'turn_off' | 'activate' | 'set_brightness' | 'set_color_temp' | 'set_percentage' | 'set_preset';
    value?: number | string;
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

export const stateToSmartHomeDevice = (entity: HomeAssistantState): SmartHomeDevice | null => {
    const [domain] = entity.entity_id.split('.');
    if (domain !== 'light' && domain !== 'fan' && domain !== 'scene') return null;
    const attributes = entity.attributes || {};
    const rawBrightness = asNumber(attributes.brightness);
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
        colorTempKelvin: asNumber(attributes.color_temp_kelvin),
        minColorTempKelvin: asNumber(attributes.min_color_temp_kelvin),
        maxColorTempKelvin: asNumber(attributes.max_color_temp_kelvin),
        percentage: asNumber(attributes.percentage),
        presetMode: typeof attributes.preset_mode === 'string' ? attributes.preset_mode : undefined,
        presetModes: asStringList(attributes.preset_modes),
        lastUpdated: entity.last_updated,
    };
};

export const testHomeAssistantConnection = async (config: SmartHomeConfig): Promise<string> => {
    const data = await requestJson<{ message?: string }>(config, '/api/');
    return data.message || 'API running.';
};

export const fetchSmartHomeDevices = async (config: SmartHomeConfig): Promise<SmartHomeDevice[]> => {
    const states = await requestJson<HomeAssistantState[]>(config, '/api/states');
    return states
        .map(stateToSmartHomeDevice)
        .filter((device): device is SmartHomeDevice => device !== null)
        .sort((a, b) => {
            const order: Record<SmartHomeDeviceKind, number> = { light: 0, fan: 1, scene: 2 };
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
        state: 'on', available: true, brightness: 38, colorTempKelvin: 3000,
        minColorTempKelvin: 2500, maxColorTempKelvin: 6500,
    },
    {
        id: 'light.floor', entityId: 'light.floor', name: '落地灯', kind: 'light',
        state: 'off', available: true, brightness: 70, colorTempKelvin: 4000,
        minColorTempKelvin: 2500, maxColorTempKelvin: 6500,
    },
    {
        id: 'fan.air_purifier', entityId: 'fan.air_purifier', name: '空气净化器', kind: 'fan',
        state: 'on', available: true, percentage: 33, presetMode: 'manual', presetModes: ['manual', 'sleep'],
    },
    {
        id: 'scene.good_night', entityId: 'scene.good_night', name: '晚安', kind: 'scene',
        state: 'scening', available: true,
    },
];
