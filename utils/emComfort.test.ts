import { describe, expect, it } from 'vitest';

import { buildThinkingChainPrompt } from './thinkingChainPrompt';
import { emComfortSection, emComfortTail } from './emPromptAddons';

describe('难过时怎么哄', () => {
    it('规则带名字，要 TA 先动、别退，也留着真有危险时的那一句', () => {
        const rule = emComfortSection('阿萌');
        expect(rule).toContain('阿萌真的难过时');
        expect(rule).toContain('你先动');
        expect(rule).toContain('一点点哄');
        expect(rule).toContain('危机热线');
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
