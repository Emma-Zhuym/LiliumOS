// [EM-START: preset-library] 用的都是自己编的样例，不放任何真预设的原文
import { beforeEach, describe, expect, it } from 'vitest';
import {
    addPresetItems, cleanPresetName, exportPresetLibrary, findPresetItem, importPresetLibrary, listPresetItems, meetToneBlock,
    parseTavernPreset, removePresetItem, renderPresetText, savePresetItem, stripPresetPlumbing,
} from './presetLibrary';

const mem = new Map<string, string>();
beforeEach(() => {
    mem.clear();
    (globalThis as any).localStorage = {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => { mem.set(k, v); },
        removeItem: (k: string) => { mem.delete(k); },
    };
});

const sample = JSON.stringify({
    prompts: [
        { identifier: 'h1', name: '┌─文风·点小铅笔查看说明─┐', content: '这里是给人看的说明，挺长的一段文字文字文字文字' },
        { identifier: 'a', name: '│📝笔法·样例甲', content: '写得朴素一些，句子短，名词动词说话，少用形容词。\n{{setvar::叙事风格1::- 如何落实{{getvar::x}}？}}' },
        { identifier: 'b', name: '│💞氛围·样例乙', content: '两个人慢慢靠近，靠一次次出现攒下信任，{{user}}和{{char}}都会笨拙。' },
        { identifier: 'c', name: 'Chat History', marker: true, content: '' },
        { identifier: 'd', name: '去某某', content: '一条普通规则，长度够二十个字的一条普通规则。' },
    ],
    prompt_order: [{ character_id: 1, order: [{ identifier: 'h1', enabled: true }, { identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }, { identifier: 'd', enabled: true }] }],
});

describe('reading a tavern preset', () => {
    it('lists entries in order, strips plumbing, guesses style / tone, skips markers and instructions', () => {
        const rows = parseTavernPreset(sample);
        expect(rows.map(r => r.name)).toEqual(['点小铅笔查看说明', '样例甲', '样例乙', '去某某']);
        const [header, a, b, d] = rows;
        expect(header.guess).toBeNull();
        expect(a.guess).toBe('style');
        expect(a.enabled).toBe(true);
        expect(a.text).not.toContain('setvar');
        expect(a.text.endsWith('少用形容词。')).toBe(true);
        expect(b.guess).toBe('tone');
        expect(b.enabled).toBe(false);
        expect(d.guess).toBeNull();
    });

    it("an entry's own name beats its section's name", () => {
        const rows = parseTavernPreset(JSON.stringify({ prompts: [
            { identifier: 'h', name: '┌─文风区─┐', content: '' },
            { identifier: 'x', name: '│💞氛围·样例', content: '一条基调样例，长度够二十个字的一条基调样例。' },
        ] }));
        expect(rows.find(r => r.name === '样例')?.guess).toBe('tone');
    });

    it('rejects files that are not presets', () => {
        expect(() => parseTavernPreset('nope')).toThrow('JSON');
        expect(() => parseTavernPreset('{}')).toThrow('没有预设条目');
    });

    it('strips nested setvar across lines and comments', () => {
        expect(stripPresetPlumbing('前\n{{setvar::k::多行\n里面{{getvar::y}}还有}}\n{{// 注释}}后')).toBe('前\n\n后');
        expect(cleanPresetName('│🎼基调·样例')).toBe('样例');
    });
});

describe('rendering', () => {
    it('fills names, rolls random, drops unknown macros', () => {
        expect(renderPresetText('{{user}}和{{char}}，{{random::甲::乙}}{{getvar::z}}', { user: '阿萌', char: '陆时' }, () => 0)).toBe('阿萌和陆时，甲');
    });
});

describe('library storage', () => {
    it('adds, updates on re-import, removes, backs up', () => {
        addPresetItems([{ kind: 'style', name: '甲', text: '一', source: 'x.json' }]);
        addPresetItems([{ kind: 'style', name: '甲', text: '二', source: 'x.json' }]);
        expect(listPresetItems('style')).toHaveLength(1);
        expect(listPresetItems('style')[0].text).toBe('二');
        const tone = savePresetItem({ kind: 'tone', name: '慢慢来', text: '{{char}}不急' });
        expect(findPresetItem(tone.id)?.name).toBe('慢慢来');
        expect(meetToneBlock({ meetToneId: tone.id, name: '陆时' }, '阿萌')).toContain('陆时不急');
        const backup = exportPresetLibrary();
        removePresetItem(tone.id);
        expect(meetToneBlock({ meetToneId: tone.id, name: '陆时' }, '阿萌')).toBe('');
        importPresetLibrary(backup);
        expect(listPresetItems()).toHaveLength(2);
    });

    it('folds the old pasted 番外 styles in once', () => {
        mem.set('em_meet_extra_styles_v1', JSON.stringify([{ name: '旧文风', text: '旧的' }]));
        expect(listPresetItems('style').map(r => r.name)).toEqual(['旧文风']);
        expect(mem.has('em_meet_extra_styles_v1')).toBe(false);
    });
});
// [EM-END: preset-library]
