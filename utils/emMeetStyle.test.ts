import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { DATE_WRITING_STYLE_PRESETS } from './dateWritingStyle';
import { DatePrompts } from './datePrompts';
import {
    longformStyleText, meetExtraPatch, meetExtraText, meetLongformLength, meetStyleKey, meetStylePatch, peekStyleText,
} from './emMeetStyle';

const char = (o: Partial<CharacterProfile> = {}) => ({ id: 'c1', name: '陆时', avatar: '', description: '', systemPrompt: '', memories: [], ...o } as CharacterProfile);

describe('meet style merge', () => {
    it('reads the EM key first, then maps the upstream style; plain default stays default', () => {
        expect(meetStyleKey({ dateWritingStyle: 'quiet', dateStyleConfig: { style: 'plain' } })).toBe('quiet');
        expect(meetStyleKey({ dateStyleConfig: { style: 'lyrical' } })).toBe('immersive');
        expect(meetStyleKey({ dateStyleConfig: { style: 'cinematic' } })).toBe('cinematic');
        expect(meetStyleKey({})).toBeUndefined();
        expect(meetStyleKey({ dateWritingStyle: 'natural' })).toBe('cozy'); // 旧别名
    });

    it('a custom writing style string becomes part of the extra text', () => {
        const c = { dateWritingStyle: '民国白话，短句', dateStyleConfig: { extra: '多写对话' } };
        expect(meetStyleKey(c)).toBeUndefined();
        expect(meetExtraText(c)).toBe('多写对话\n民国白话，短句');
    });

    it('picking a style clears the upstream one and keeps the old custom text', () => {
        const c = { dateWritingStyle: '民国白话', dateStyleConfig: { style: 'plain', pov: 'first-you' as const } };
        expect(meetStylePatch(c, 'banter')).toEqual({
            dateWritingStyle: 'banter',
            dateStyleConfig: { style: undefined, pov: 'first-you', extra: '民国白话' },
        });
    });

    it('editing the extra text drops the custom style but keeps a mapped key', () => {
        expect(meetExtraPatch({ dateWritingStyle: '民国白话', dateStyleConfig: { style: 'plain' } }, '民国白话，多写环境'))
            .toEqual({ dateStyleConfig: { style: 'plain', extra: '民国白话，多写环境' }, dateWritingStyle: 'minimal' });
        expect(meetExtraPatch({ dateWritingStyle: 'quiet' }, '  ')).toEqual({ dateStyleConfig: { extra: undefined } });
    });

    it('long-form style text never carries the one-line examples or line wording', () => {
        for (const preset of DATE_WRITING_STYLE_PRESETS) {
            const text = longformStyleText(preset);
            expect(text).toContain(preset.label);
            expect(text).not.toMatch(/例[:：]|\[normal\]|一行|每行|几行/);
        }
        expect(longformStyleText(null)).toContain('沉浸');
        expect(peekStyleText(null)).toBe('电影感，沉浸式，细节丰富');
    });

    it('length defaults to medium', () => {
        expect(meetLongformLength({})).toBe('medium');
        expect(meetLongformLength({ dateLongformLength: 'long' })).toBe('long');
    });
});

describe('long-form prompt (the default)', () => {
    const payload = (c: CharacterProfile) => DatePrompts.buildSessionPayload({
        char: c, userProfile: { name: '阿萌' } as any, emojis: [], userText: '你好', variant: 'send',
        allMsgs: [{ id: 1, charId: 'c1', role: 'user', type: 'text', content: '你好', timestamp: Date.now() } as any],
    });
    const sys = (r: Awaited<ReturnType<typeof payload>>) => r.messages.find(m => m.role === 'system')!.content as string;

    it('uses one style, no VN block, no one-line examples', async () => {
        const r = await payload(char({ dateWritingStyle: 'minimal' }));
        const s = sys(r);
        expect(s).toContain('[见面 · 长文模式]');
        expect(s).not.toContain('Visual Novel Mode');
        expect(s).toContain('「极简快切」');
        expect(s).not.toContain('【文风：极简快切】');
        expect(s).toContain('五禁区');
    });

    it('length setting reaches the block and the note', async () => {
        const r = await payload(char({ dateLongformLength: 'short' }));
        expect(sys(r)).toContain('120–250 字，分一到两段');
        expect(String(r.messages[r.messages.length - 1].content)).toContain('120–250 字、一到两段');
    });
});
