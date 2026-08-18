import type { APIConfig, ApiPreset, CharacterProfile } from '../types';
import { normalizeApiConfig } from './apiConfigNormalize';

export const API_PRESETS_STORAGE_KEY = 'os_api_presets';

export interface CharacterApiResolution {
  apiConfig: APIConfig;
  source: 'global' | 'preset';
  preset?: ApiPreset;
  /** 角色仍指向一个已不存在的预设；运行时已经安全回退主 API。 */
  missingPresetId?: string;
}

/**
 * 深层运行路径（主动消息、后台凭据刷新）拿不到 React state 时，从同一份持久化来源读取。
 * 解析失败只等于“暂时看不到预设”，调用方会安全回退主 API。
 */
export const loadApiPresetsFromStorage = (): ApiPreset[] => {
  try {
    const raw = localStorage.getItem(API_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * 解析一个角色本轮真正使用的主聊天 API。
 *
 * 预设只接管聊天请求自己的五项（URL / Key / 模型 / 流式 / 温度）；视觉、TTS、音乐等
 * 全局辅助服务仍沿用主配置，避免切换角色时把整套本地能力一起换掉。
 */
export const resolveCharacterApiConfig = (
  char: Pick<CharacterProfile, 'chatApiPresetId'> | null | undefined,
  globalApiConfig: APIConfig,
  apiPresets: ApiPreset[] = loadApiPresetsFromStorage(),
): CharacterApiResolution => {
  const presetId = char?.chatApiPresetId?.trim();
  if (!presetId) {
    return { apiConfig: globalApiConfig, source: 'global' };
  }

  const preset = apiPresets.find((item) => item.id === presetId);
  if (!preset) {
    return {
      apiConfig: globalApiConfig,
      source: 'global',
      missingPresetId: presetId,
    };
  }

  return {
    apiConfig: normalizeApiConfig({
      ...globalApiConfig,
      baseUrl: preset.config.baseUrl,
      apiKey: preset.config.apiKey,
      model: preset.config.model,
      stream: preset.config.stream,
      temperature: preset.config.temperature,
    }),
    source: 'preset',
    preset,
  };
};
