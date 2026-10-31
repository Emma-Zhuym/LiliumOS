import { describe, expect, it } from 'vitest';

import { buildThinkingChainPrompt } from './thinkingChainPrompt';
import { emComfortSection, emComfortTail, emMoveOnSection, emMoveOnTail } from './emPromptAddons';

describe('说话只往下走', () => {
    it('不解释她的话，也不解释自己', () => {
        const rule = emMoveOnSection('阿萌');
        expect(rule).toContain('阿萌说的话，ta 自己最清楚是什么意思');
        expect(rule).toContain('也不解释你自己');
        expect(rule).toContain('不证明你有多在乎');
        expect(emMoveOnTail('阿萌')).toContain('接着 阿萌 说完的地方往下说');
    });
});

describe('难过时怎么哄', () => {
    it('规则带名字，要 TA 先动、别退，也留着真有危险时的那一句', () => {
        const rule = emComfortSection('阿萌');
        expect(rule).toContain('阿萌真的难过时');
        expect(rule).toContain('你先动');
        expect(rule).toContain('一点点哄');
        expect(rule).toContain('危机热线');
        expect(rule).toContain('别照抄');
        expect(rule).toContain('我再待会儿');
    });
    it('开口前最后一句只说要做什么，不点名那几种腔调', () => {
        const tail = emComfortTail('阿萌');
        expect(tail).toContain('你先动');
        expect(tail).not.toMatch(/复述|建议|别说|不要/);
    });
    it('心象：难过时不先研究她，也不再写「根本不安抚」', () => {
        const prompt = buildThinkingChainPrompt('既白', '阿萌');
        expect(prompt).toContain('阿萌 真的难过、扛不住时,这一节让位');
        expect(prompt).not.toContain('根本不安抚');
    });
});
