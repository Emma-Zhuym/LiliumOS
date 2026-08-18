import { describe, expect, it } from 'vitest';
import type { APIConfig, ApiPreset } from '../types';
import { resolveCharacterApiConfig } from './characterApi';

const GLOBAL: APIConfig = {
  baseUrl: 'https://global.example/v1',
  apiKey: 'global-key',
  model: 'global-model',
  stream: false,
  temperature: 0.85,
  minimaxApiKey: 'voice-key',
  visionApi: {
    enabled: true,
    baseUrl: 'https://vision.example/v1',
    apiKey: 'vision-key',
    model: 'vision-model',
  },
};

const PRESET: ApiPreset = {
  id: 'elias-api',
  name: '哥哥专属',
  config: {
    baseUrl: 'https://role.example/v1/',
    apiKey: 'role-key',
    model: 'role-model',
    stream: true,
    temperature: 0.4,
  },
};

describe('resolveCharacterApiConfig', () => {
  it('未绑定的旧角色继续跟随主 API', () => {
    const result = resolveCharacterApiConfig({}, GLOBAL, [PRESET]);
    expect(result.source).toBe('global');
    expect(result.apiConfig).toBe(GLOBAL);
  });

  it('绑定后只替换聊天 API，保留全局视觉与语音能力', () => {
    const result = resolveCharacterApiConfig({ chatApiPresetId: PRESET.id }, GLOBAL, [PRESET]);
    expect(result.source).toBe('preset');
    expect(result.preset?.name).toBe('哥哥专属');
    expect(result.apiConfig).toMatchObject({
      baseUrl: 'https://role.example/v1',
      apiKey: 'role-key',
      model: 'role-model',
      stream: true,
      temperature: 0.4,
      minimaxApiKey: 'voice-key',
      visionApi: GLOBAL.visionApi,
    });
  });

  it('预设被删后回退主 API，并留下可供界面提示的标记', () => {
    const result = resolveCharacterApiConfig({ chatApiPresetId: 'deleted' }, GLOBAL, [PRESET]);
    expect(result.source).toBe('global');
    expect(result.apiConfig).toBe(GLOBAL);
    expect(result.missingPresetId).toBe('deleted');
  });
});
