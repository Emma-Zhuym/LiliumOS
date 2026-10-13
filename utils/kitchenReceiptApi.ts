/**
 * 小厨房读小票用哪个 API：从「设置 → API」的预设里自己挑一个（阿萌 2026-10-13 定），
 * 跟聊天、设置里的独立识图都不相干。只存预设 id，Key 和地址照旧在预设里；预设删了就要重新挑。
 * 存在本机 localStorage：换一台设备重挑一次就好，不进备份。
 */
import type { ApiPreset, VisionApiConfig } from '../types';
import { visionApiConfigFromPreset } from './visionApi';

const KEY = 'lilium.kitchen.receiptPresetId';

export const readKitchenReceiptPresetId = (): string | null => {
  try { return localStorage.getItem(KEY); } catch { return null; }
};

export const saveKitchenReceiptPresetId = (id: string | null) => {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* 存不了就这次用 */ }
};

export const kitchenReceiptApi = (presets: ApiPreset[], id: string | null): { preset: ApiPreset; config: VisionApiConfig } | null => {
  const preset = id ? presets.find(item => item.id === id) : undefined;
  return preset ? { preset, config: visionApiConfigFromPreset(preset) } : null;
};
