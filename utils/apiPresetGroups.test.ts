// [EM-START: api-preset-group]
import { describe, expect, it } from 'vitest';

import { normalizeApiPreset } from './apiConfigNormalize';
import { groupApiPresets, listPresetGroups } from './apiPresetGroups';

const p = (id: string, group?: string) => ({ id, group });

describe('API 预设分组', () => {
    it('未分组的在最前、不带组名；有分组的按第一次出现的顺序，组内保持原顺序', () => {
        const sections = groupApiPresets([p('a', '中转A'), p('b'), p('c', '官方'), p('d', '中转A'), p('e', '  ')]);
        expect(sections).toEqual([
            { group: '', presets: [p('b'), p('e', '  ')] },
            { group: '中转A', presets: [p('a', '中转A'), p('d', '中转A')] },
            { group: '官方', presets: [p('c', '官方')] },
        ]);
    });

    it('一个都没分组时只有一段', () => {
        expect(groupApiPresets([p('a'), p('b')])).toEqual([{ group: '', presets: [p('a'), p('b')] }]);
    });

    it('候选分组名去重、去空', () => {
        expect(listPresetGroups([p('a', '中转A'), p('b', ' '), p('c', '中转A'), p('d', '官方')])).toEqual(['中转A', '官方']);
    });

    it('保存时去掉首尾空格，清空就不留这个字段', () => {
        const config = { baseUrl: 'https://x', apiKey: 'k', model: 'm' };
        expect(normalizeApiPreset({ id: '1', name: 'n', config, group: ' 中转A ' }).group).toBe('中转A');
        expect('group' in normalizeApiPreset({ id: '1', name: 'n', config, group: '   ' })).toBe(false);
    });
});
// [EM-END: api-preset-group]
