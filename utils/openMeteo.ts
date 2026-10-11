/**
 * [EM: weather-openmeteo] Open-Meteo 天气服务（免 API key）
 *
 * 两个端点：
 * - 天气: api.open-meteo.com/v1/forecast（坐标 → 当前天气）
 * - 城市搜索: geocoding-api.open-meteo.com/v1/search（Settings 选城市用，
 *   候选带 admin1/country 三段显示，根治 Birmingham 美/英重名歧义）
 *
 * 定位模式由 RealtimeConfig.weatherMode 决定：
 * - 'geo'（默认）: getCurrentPositionSmart() 实时坐标；失败降级已存 weatherLocation
 * - 'city': 只用 Settings 里选定并持久化的 weatherLocation 坐标
 */

import { safeResponseJson } from './safeApi';
import { getCurrentPositionSmart } from './geo';

/** Settings 城市搜索选定后持久化的位置（此后查天气只用坐标，name 仅做显示） */
export interface WeatherLocation {
    name: string;
    admin1?: string;   // 一级行政区（州/省），如 "Alabama"
    country?: string;
    latitude: number;
    longitude: number;
}

/** Open-Meteo 返回的当前天气（字段已映射为项目内命名） */
export interface OpenMeteoCurrent {
    temp: number;
    feelsLike: number;
    humidity: number;
    description: string;
}

// WMO weather code → 中文描述。
// generateWeatherAdvice() 靠关键词（雨/雪/晴/云/雾）匹配，描述里必须含这些字。
const WMO_CODE_ZH: Record<number, string> = {
    0: '晴',
    1: '基本晴朗',
    2: '多云',
    3: '阴天',
    45: '雾',
    48: '雾凇',
    51: '毛毛雨',
    53: '毛毛雨',
    55: '毛毛雨',
    56: '冻毛毛雨',
    57: '冻毛毛雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    66: '冻雨',
    67: '冻雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    77: '雪粒',
    80: '小阵雨',
    81: '阵雨',
    82: '强阵雨',
    85: '阵雪',
    86: '阵雪',
    95: '雷阵雨',
    96: '雷阵雨伴冰雹',
    99: '雷阵雨伴冰雹',
};

export const wmoCodeToZh = (code: number | undefined | null): string =>
    (code != null && WMO_CODE_ZH[code]) || '未知';

/** 按坐标查当前天气。失败返回 null（不抛，不挡聊天）。 */
export const fetchOpenMeteoCurrent = async (latitude: number, longitude: number): Promise<OpenMeteoCurrent | null> => {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}`
            + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code&timezone=auto`;
        const response = await fetch(url);
        if (!response.ok) {
            console.error('Open-Meteo API error:', response.status);
            return null;
        }
        const data = await safeResponseJson(response);
        const cur = data?.current;
        if (!cur || typeof cur.temperature_2m !== 'number') {
            console.error('Open-Meteo: unexpected response shape', data);
            return null;
        }
        return {
            temp: Math.round(cur.temperature_2m),
            feelsLike: Math.round(cur.apparent_temperature ?? cur.temperature_2m),
            humidity: Math.round(cur.relative_humidity_2m ?? 0),
            description: wmoCodeToZh(cur.weather_code),
        };
    } catch (e) {
        console.error('Failed to fetch Open-Meteo weather:', e);
        return null;
    }
};

/** 城市搜索（Settings 用）。返回候选列表，每项带 admin1/country 供三段显示。失败返回 []。 */
export const searchCities = async (query: string): Promise<WeatherLocation[]> => {
    const q = query.trim();
    if (!q) return [];
    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`;
        const response = await fetch(url);
        if (!response.ok) {
            console.error('Open-Meteo geocoding error:', response.status);
            return [];
        }
        const data = await safeResponseJson(response);
        const results = Array.isArray(data?.results) ? data.results : [];
        return results
            .filter((r: any) => typeof r?.latitude === 'number' && typeof r?.longitude === 'number' && r?.name)
            .map((r: any) => ({
                name: String(r.name),
                admin1: r.admin1 ? String(r.admin1) : undefined,
                country: r.country ? String(r.country) : undefined,
                latitude: r.latitude,
                longitude: r.longitude,
            }));
    } catch (e) {
        console.error('Failed to search cities:', e);
        return [];
    }
};

/** 候选项/已选城市的三段显示名："Birmingham · Alabama · 美国" */
export const formatLocationLabel = (loc: WeatherLocation): string =>
    [loc.name, loc.admin1, loc.country].filter(Boolean).join(' · ');

/**
 * 按模式解析本轮查天气用的坐标 + 显示名。
 * - geo: 实时定位；拒权/超时降级已存 weatherLocation；都没有 → null（本轮静默跳过天气）
 * - city: 已存 weatherLocation；未选 → null
 * 显示名：有 weatherLocation 用其 name，geo 模式无存城市时用「你所在地」（prompt 里不需要精确城市名）。
 */
/**
 * 给提示词看的地名：城市 + 州/省 + 国家。只写「伯明翰」的话，模型会默认是英国那个，
 * 连带着把钱按英镑算（美国阿拉巴马州也有一个伯明翰）。
 */
export const placeName = (loc: Pick<WeatherLocation, 'name' | 'admin1' | 'country'>): string =>
    [loc.name, loc.admin1, loc.country]
        .map(part => (part ?? '').trim())
        .filter((part, index, all) => part && all.indexOf(part) === index)
        .join('，');

export const resolveWeatherCoords = async (
    mode: 'geo' | 'city',
    savedLocation?: WeatherLocation,
): Promise<{ latitude: number; longitude: number; displayName: string } | null> => {
    if (mode === 'geo') {
        try {
            const pos = await getCurrentPositionSmart();
            return { latitude: pos.latitude, longitude: pos.longitude, displayName: savedLocation ? placeName(savedLocation) : '你所在地' };
        } catch (e: any) {
            console.warn('[weather] 定位失败，尝试降级已存城市:', e?.message || e);
            if (savedLocation) {
                return { latitude: savedLocation.latitude, longitude: savedLocation.longitude, displayName: placeName(savedLocation) };
            }
            return null;
        }
    }
    // city 模式
    if (savedLocation) {
        return { latitude: savedLocation.latitude, longitude: savedLocation.longitude, displayName: placeName(savedLocation) };
    }
    return null;
};
