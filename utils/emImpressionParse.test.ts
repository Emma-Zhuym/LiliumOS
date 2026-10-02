// [EM-START: impression-json-tolerant]
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseImpressionReply } from './emImpressionParse';
import { normalizeUserImpression } from './impression';

const full = (toneStyle = '"说话直接"') => `{
  "version": 3.0,
  "lastUpdated": 1790900000000,
  "value_map": { "likes": ["星巴克加奶盖", "被哄"], "dislikes": ["被敷衍"], "core_values": "我觉得她最看重被认真对待。" },
  "behavior_profile": { "tone_style": ${toneStyle}, "emotion_summary": "最近心情不错。", "response_patterns": "先嘴硬再服软。" },
  "emotion_schema": { "triggers": { "positive": ["被记住"], "negative": ["被记错"] }, "comfort_zone": "被照顾", "stress_signals": ["不回消息"] },
  "personality_core": { "observed_traits": ["嘴硬心软"], "interaction_style": "撒娇", "summary": "她是我放在心尖上的人。" },
  "mbti_analysis": { "type": "INFP", "reasoning": "……", "dimensions": { "e_i": 70, "s_n": 60, "t_f": 80, "j_p": 65 } },
  "observed_changes": ["最近更愿意主动分享日常"]
}`;

describe('印象档案回包解析', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { errorSpy.mockRestore(); });

    it('规矩的 JSON 原样通过', () => {
        const parsed = parseImpressionReply(full());
        expect(normalizeUserImpression(parsed)?.value_map.likes).toEqual(['星巴克加奶盖', '被哄']);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('模型先用角色口吻说了一句「哼」再给 JSON：照样读得出来', () => {
        const raw = `哼，又让我写这个。\n\n\`\`\`json\n${full()}\n\`\`\`\n写完了，不许偷看。`;
        expect(() => JSON.parse(raw)).toThrow();
        const impression = normalizeUserImpression(parseImpressionReply(raw));
        expect(impression?.personality_core.summary).toBe('她是我放在心尖上的人。');
    });

    it('字符串里用英文双引号引了「哼」：补上转义，原话保留', () => {
        const raw = full('"不高兴的时候爱说"哼"，然后等我去哄"');
        expect(() => JSON.parse(raw)).toThrow();
        const impression = normalizeUserImpression(parseImpressionReply(raw));
        expect(impression?.behavior_profile.tone_style).toBe('不高兴的时候爱说"哼"，然后等我去哄');
        expect(impression?.value_map.likes).toContain('星巴克加奶盖');
    });

    it('回包被截断：整次作废，不拿半份档案去覆盖旧的', () => {
        const truncated = full().slice(0, full().indexOf('"emotion_schema"'));
        expect(() => parseImpressionReply(truncated)).toThrow(/旧档案没有改动/);
    });

    it('只抠得出一小块（缺核心小节）：整次作废', () => {
        const fragment = '好的。{"value_map": {"likes": ["奶盖"], "dislikes": [], "core_values": "……"}}';
        // 不拦的话 normalizeUserImpression 会把其余几节补成空白
        expect(normalizeUserImpression(JSON.parse(fragment.slice(3)))?.personality_core.summary).toBe('');
        expect(() => parseImpressionReply(fragment)).toThrow(/不完整/);
    });

    it('通篇是角色在说话、没有 JSON：给出看得懂的报错，并把开头记进日志', () => {
        expect(() => parseImpressionReply('哼，我才不要写什么档案。')).toThrow(/没有按格式返回/);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(String(errorSpy.mock.calls[0][1])).toContain('哼，我才不要写');
    });
});
// [EM-END: impression-json-tolerant]
