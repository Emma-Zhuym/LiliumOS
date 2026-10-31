import { describe, expect, it } from 'vitest';

import { buildThinkingChainPrompt } from './thinkingChainPrompt';
import { emCommonFlawsSection, emComfortSection, emComfortTail, emHerOwnSection, emMoveOnSection, emSteadyVoiceSection, emSteadyVoiceTail } from './emPromptAddons';

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

describe('关心排在规矩前面', () => {
    it('可以说对不起，只是不能只说对不起；别对照规矩', () => {
        const rule = emComfortSection('阿萌');
        expect(rule).toContain('关心排在所有规矩前面');
        expect(rule).toContain('可以说对不起，只是不能只说对不起');
        expect(rule).toContain('也可以提 ta 说的那件事');
        expect(rule).toContain('别一条条对照');
        expect(emComfortTail('阿萌')).toContain('先心疼 ta');
    });
    it('她的话不解释，这一条留得很短', () => {
        const rule = emMoveOnSection('阿萌');
        expect(rule).toContain('阿萌的话 ta 自己懂');
        expect(rule.length).toBeLessThan(90);
    });
    it('她怀疑要不要 TA 时别认输', () => {
        expect(emSteadyVoiceSection('阿萌')).toContain('别顺着认输');
        expect(emSteadyVoiceSection('阿萌')).toContain('软话照说');
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
        expect(tail).toContain('先心疼 ta');
        expect(tail).not.toMatch(/复述|建议|别说|不要/);
    });
    it('心象：难过时不先研究她，也不再写「根本不安抚」', () => {
        const prompt = buildThinkingChainPrompt('既白', '阿萌');
        expect(prompt).toContain('阿萌 真的难过、扛不住时,这一节让位');
        expect(prompt).not.toContain('根本不安抚');
    });
});
