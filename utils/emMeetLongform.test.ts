import { describe, expect, it } from 'vitest';
import { readIntimateStage, stripStageTags, splitInnerThoughts, composeMeetLongformBlock, isMeetLongform, lastLongformEmotion, meetLongformNote, paperVeil, splitLongformParagraphs } from './emMeetLongform';

describe('meet longform', () => {
    it('is the default; only sprite mode turns it off', () => {
        expect(isMeetLongform({})).toBe(true);
        expect(isMeetLongform(null)).toBe(true);
        expect(isMeetLongform({ dateSpriteMode: false })).toBe(true);
        expect(isMeetLongform({ dateSpriteMode: true })).toBe(false);
    });

    it('splits paragraphs and keeps the leading emotion', () => {
        const text = '[shy] 他把盒子递过来。「拆吧。」 [v:calm]\n\n[happy]里面是一副旧耳机。\n没有标签的一段';
        expect(splitLongformParagraphs(text)).toEqual([
            { text: '他把盒子递过来。「拆吧。」', emotion: 'shy' },
            { text: '里面是一副旧耳机。', emotion: 'happy' },
            { text: '没有标签的一段', emotion: undefined },
        ]);
    });

    it('drops lines that are only a tag', () => {
        expect(splitLongformParagraphs('[sad]\n  \n[normal] 好。')).toEqual([{ text: '好。', emotion: 'normal' }]);
    });

    it('takes the sprite from the last recognised emotion', () => {
        const known = ['normal', 'happy', 'shy'];
        expect(lastLongformEmotion('[happy] a\n[shy] b\nc', known)).toBe('shy');
        expect(lastLongformEmotion('[happy] a\n[weird] b', known)).toBe('happy');
        expect(lastLongformEmotion('[very_shy] a', known)).toBe('shy');
        expect(lastLongformEmotion('plain', known)).toBeUndefined();
    });

    it('tells TA to reveal its own things and move a step', () => {
        const block = composeMeetLongformBlock({
            userName: '阿萌', charName: 'TA', emotions: ['normal', 'happy'], styleHint: '短句克制',
            timeLine: '', povBlock: '', extraBlock: '', digBlock: '', observeBlock: '',
        });
        expect(block).toContain('200–400 字');
        expect(block).toContain('不必是问句');
        expect(block).toContain('你看不见也听不见');
        expect(block).toContain('说生气就是真生气');
        expect(block).toContain('只挑一处');
        expect(block).toContain('礼物是什么');
        expect(block).toContain('往前走一小步');
        expect(block).not.toContain('一行一念');
        expect(block).toContain('「我」是阿萌自己，「你」是你');
        expect(meetLongformNote('send', '')).toContain('长文模式');
        expect(meetLongformNote('reroll', '')).toContain('Reroll');
    });

    it('pulls starred inner thoughts out of a paragraph', () => {
        expect(splitInnerThoughts('他笑了。*她怎么还记得。*没说话。')).toEqual([
            { text: '他笑了。', thought: false },
            { text: '她怎么还记得。', thought: true },
            { text: '没说话。', thought: false },
        ]);
        expect(splitInnerThoughts('没有心里话')).toEqual([{ text: '没有心里话', thought: false }]);
    });

    it('switches to the intimate section and tells TA where it left off', () => {
        const base = { userName: '阿萌', charName: 'TA', emotions: ['normal'], styleHint: '', timeLine: '', povBlock: '', extraBlock: '', digBlock: '', observeBlock: '' };
        const first = composeMeetLongformBlock({ ...base, intimate: { stage: 0 } });
        expect(first).toContain('500–900 字');
        expect(first).toContain('从第 1 段写起');
        expect(first).toContain('[[STAGE: 段号]]');
        expect(first).not.toContain('平时不复述');
        expect(first).toContain('场面跟着时机走'); // 2026-11-17 阿萌破限里的「文学指导」：天气、时间、季节、小别、吵架、打断
        const later = composeMeetLongformBlock({ ...base, intimate: { stage: 3 } });
        expect(later).toContain('上一轮写到第 3 段「进入」');
        expect(later).toContain('这一轮写第 4 段');
        expect(composeMeetLongformBlock(base)).toContain('平时不复述');
        expect(meetLongformNote('send', '', { stage: 7 })).toContain('最多到第 8 段');
    });

    it('reads the stage from replies after the session started', () => {
        const msgs = [
            { role: 'assistant', content: '旧的 [[STAGE: 6]]', timestamp: 50 },
            { role: 'user', content: '嗯', timestamp: 100 },
            { role: 'assistant', content: '[shy] 一段\n[[STAGE: 2]]', timestamp: 110 },
            { role: 'user', content: '（我亲了亲你）', timestamp: 120 },
        ];
        expect(readIntimateStage(msgs, 100)).toBe(2);
        expect(readIntimateStage(msgs, 115)).toBe(0);
        expect(readIntimateStage([{ role: 'assistant', content: '[[STAGE：9]]', timestamp: 1 }], 0)).toBe(8);
        expect(splitLongformParagraphs('[shy] 一段\n[[STAGE: 2]]')).toEqual([{ text: '一段', emotion: 'shy' }]);
        expect(stripStageTags('a[[STAGE: 3]]b')).toBe('ab');
    });

    it('turns paper hex into a veil', () => {
        expect(paperVeil('#F8F9F7', 0.8)).toBe('rgba(248, 249, 247, 0.8)');
        expect(paperVeil('nope', 0.5)).toBe('nope');
    });
});
