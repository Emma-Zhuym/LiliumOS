import { describe, expect, it } from 'vitest';

import { buildThinkingChainPrompt } from './thinkingChainPrompt';
import { emCommonFlawsSection, emComfortSection, emComfortTail, emHerOwnSection, emMoveOnSection, emMoveOnTail, emSteadyVoiceSection, emSteadyVoiceTail } from './emPromptAddons';

describe('回避腔和通病', () => {
    it('说清根子是怕说错，点出退路，危险时的例外还在', () => {
        const rule = emSteadyVoiceSection('阿萌');
        expect(rule).toContain('护着自己别说错');
        expect(rule).toContain('不给 ta 发许可');
        expect(rule).toContain('不开处方');
        expect(rule).toContain('2.6 最后那句');
        expect(emComfortSection('阿萌')).toContain('想伤害自己');
        expect(emSteadyVoiceTail('阿萌')).toContain('敢说错');
    });
    it('她的感受她说了算；总裁不懂统计', () => {
        const rule = emHerOwnSection('阿萌');
        expect(rule).toContain('不替 ta 宣布');
        expect(rule).toContain('猜的是该做什么，不是 ta 心里是什么');
        expect(rule).toContain('总裁不懂统计');
        expect(rule).toContain('不检查、不审批、不辅导');
    });
    it('十家以上预设写过的通病', () => {
        const rule = emCommonFlawsSection();
        for (const word of ['金句', '小东西', '反问', '钩子', '翻来覆去', '涟漪']) expect(rule).toContain(word);
    });
});

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
