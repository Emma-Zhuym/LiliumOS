import { describe, expect, it } from 'vitest';
import { composeMeetLongformBlock, isMeetLongform, lastLongformEmotion, meetLongformNote, paperVeil, splitLongformParagraphs } from './emMeetLongform';

describe('meet longform', () => {
    it('only turns on when the character opted in', () => {
        expect(isMeetLongform({ dateLongform: true })).toBe(true);
        expect(isMeetLongform({})).toBe(false);
        expect(isMeetLongform(null)).toBe(false);
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
        expect(block).toContain('300–500 字');
        expect(block).toContain('礼物是什么');
        expect(block).toContain('往前走一小步');
        expect(block).not.toContain('一行一念');
        expect(block).toContain('「我」是阿萌自己，「你」是你');
        expect(meetLongformNote('send', '')).toContain('长文模式');
        expect(meetLongformNote('reroll', '')).toContain('Reroll');
    });

    it('turns paper hex into a veil', () => {
        expect(paperVeil('#F8F9F7', 0.8)).toBe('rgba(248, 249, 247, 0.8)');
        expect(paperVeil('nope', 0.5)).toBe('nope');
    });
});
