import { describe, expect, it } from 'vitest';
import {
    MEET_EXTRA_FULL_ROUNDS, buildMeetExtraTask, countExtraChars, joinExtraParts, meetExtraCardContent, meetExtraHistoryText,
    needsExtraContinue, rollMeetExtraSynopsis, splitExtraThinking, splitExtraTitle,
} from './meetExtra';

describe('meet extra prompt', () => {
    const base = { charName: '陆时', userName: '阿萌', synopsis: '民国，他是报社主笔，她是来投稿的女学生。', length: 'medium' as const, pov: 'third' as const };

    it('always names both leads and keeps the synopsis', () => {
        const p = buildMeetExtraTask({ ...base, memory: 'persona' });
        expect(p).toContain('你（陆时）和阿萌');
        expect(p).toContain('报社主笔');
        expect(p).toContain('3500–5000 字');
        expect(p).toContain('AU 番外');
        expect(p).not.toContain('补的要求');
    });

    it('together mode tells TA to use what they share; extra and pov go in', () => {
        const p = buildMeetExtraTask({ ...base, memory: 'together', pov: 'first', extra: '往虐里写' });
        expect(p).toContain('你们俩现在的样子');
        expect(p).toContain('你自己是「我」，阿萌是「你」');
        expect(p).toContain('往虐里写');
    });
});

describe('meet extra parsing', () => {
    it('splits a markdown title', () => {
        expect(splitExtraTitle('# 雨夜来信\n\n他抬头。', '梗概')).toEqual({ title: '雨夜来信', body: '他抬头。' });
        expect(splitExtraTitle('《雨夜》\n正文', '梗概').title).toBe('雨夜');
    });

    it('falls back to the synopsis opening', () => {
        expect(splitExtraTitle('他抬头。', '民国，他是报社主笔，她是来投稿的女学生。')).toEqual({ title: '民国，他是报社主笔，她是…', body: '他抬头。' });
    });

    it('counts characters without whitespace', () => {
        expect(countExtraChars('一 二\n三')).toBe(3);
    });
});

describe('continuing', () => {
    it('continues when cut by length, at most twice', () => {
        expect(needsExtraContinue('完整的一句。', 'length', 'short', 0)).toBe(true);
        expect(needsExtraContinue('完整的一句。', 'length', 'short', 2)).toBe(false);
    });

    it('continues when much too short and stopped mid-sentence', () => {
        expect(needsExtraContinue('他推开门，看见', 'stop', 'medium', 0)).toBe(true);
        expect(needsExtraContinue('他推开门。', 'stop', 'medium', 0)).toBe(false);
        expect(needsExtraContinue('字'.repeat(3000) + '看见', 'stop', 'medium', 0)).toBe(false);
    });

    it('joins parts without the repeated title', () => {
        expect(joinExtraParts('他推开门，看见', '# 雨夜\n她站在那里。')).toBe('他推开门，看见她站在那里。');
        expect(joinExtraParts('他推开门。', '她站在那里。')).toBe('他推开门。\n\n她站在那里。');
    });
});

describe('chat card', () => {
    const card = { id: 'x', title: '雨夜', synopsis: '梗概', body: '全文'.repeat(300), summary: '总结' };

    it('card content line carries no full text', () => {
        expect(meetExtraCardContent('雨夜')).toBe('[分享了一篇番外《雨夜》（虚构的故事）]');
    });

    it('full text inside the window, summary after', () => {
        const early = meetExtraHistoryText(card, MEET_EXTRA_FULL_ROUNDS - 1, true);
        expect(early).toContain('全文：');
        expect(early).toContain('虚构的故事');
        const late = meetExtraHistoryText(card, MEET_EXTRA_FULL_ROUNDS, true);
        expect(late).not.toContain('全文：');
        expect(late).toContain('总结');
    });

    it('without a summary yet, falls back to the opening', () => {
        const late = meetExtraHistoryText({ ...card, summary: undefined }, 9, true);
        expect(late).toContain('（开头）');
        expect(late.length).toBeLessThan(600);
    });
});

describe('thinking, style, AU roll', () => {
    const base = { charName: '陆时', userName: '阿萌', synopsis: '梗概', length: 'short' as const, pov: 'third' as const };

    it('asks to think first; together mode adds the real-life step', () => {
        expect(buildMeetExtraTask({ ...base, memory: 'persona' })).toContain('<thinking></thinking>');
        expect(buildMeetExtraTask({ ...base, memory: 'persona' })).not.toContain('现实里的你们');
        expect(buildMeetExtraTask({ ...base, memory: 'together' })).toContain('现实里的你们');
    });

    it('style text only comes from what is passed in (stored on the device)', () => {
        expect(buildMeetExtraTask({ ...base, memory: 'persona' })).not.toContain('### 文风');
        const p = buildMeetExtraTask({ ...base, memory: 'persona', style: { name: '我的文风', text: '短句，冷一点。' } });
        expect(p).toContain('### 文风：我的文风');
        expect(p).toContain('短句，冷一点。');
    });

    it('splits thinking out, also while it is still open', () => {
        expect(splitExtraThinking('<thinking>想想</thinking>\n# 标题\n正文')).toEqual({ thinking: '想想', rest: '\n# 标题\n正文', open: false });
        expect(splitExtraThinking('<thinking>还在想')).toEqual({ thinking: '还在想', rest: '', open: true });
        expect(splitExtraThinking('# 标题\n正文')).toEqual({ thinking: '', rest: '# 标题\n正文', open: false });
    });

    it('rolls a three-part AU synopsis', () => {
        const s = rollMeetExtraSynopsis(() => 0);
        expect(s.startsWith('AU：')).toBe(true);
        expect(s).toContain('故事从');
    });
});
