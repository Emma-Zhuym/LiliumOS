// [EM-START: api-preset-group]
/**
 * API 预设分组：同一个中转站底下挂好几个模型时，平铺的列表不好找。
 *
 * 分组名完全由用户手填（阿萌明确要求：不写自动判定逻辑，不按 URL 猜）。
 * 没填分组的预设排在最前面、不带组标题；有分组的按「第一次出现的顺序」排，组内保持原顺序。
 */
import type { ApiPreset } from '../types';

export interface ApiPresetSection<T extends Pick<ApiPreset, 'group'> = ApiPreset> {
    /** 空字符串 = 未分组 */
    group: string;
    presets: T[];
}

export const presetGroupOf = (preset: Pick<ApiPreset, 'group'>): string => String(preset.group ?? '').trim();

export const groupApiPresets = <T extends Pick<ApiPreset, 'group'>>(presets: T[]): ApiPresetSection<T>[] => {
    const sections = new Map<string, T[]>([['', []]]);
    for (const preset of presets) {
        const group = presetGroupOf(preset);
        if (!sections.has(group)) sections.set(group, []);
        sections.get(group)!.push(preset);
    }
    return [...sections.entries()]
        .filter(([, list]) => list.length > 0)
        .map(([group, list]) => ({ group, presets: list }));
};

/** 已经用过的分组名，给编辑框做候选。 */
export const listPresetGroups = (presets: Pick<ApiPreset, 'group'>[]): string[] =>
    [...new Set(presets.map(presetGroupOf).filter(Boolean))];
// [EM-END: api-preset-group]
