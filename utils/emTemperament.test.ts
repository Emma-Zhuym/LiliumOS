import { describe, expect, it, vi } from 'vitest';
import { buildTemperamentPrompt, editTemperament, generateTemperament, parseTemperament } from './emTemperament';

describe('脾气读数', () => {
    it('提示词带人设和已有的反刍倾向；意识系角色提示没有身体', () => {
        const text = buildTemperamentPrompt({ name: '陈照', systemPrompt: '游戏主策，嘴硬心软', ruminationTendency: 0.6 } as any);
        expect(text).toContain('游戏主策');
        expect(text).toContain('反刍倾向 0.6');
        expect(buildTemperamentPrompt({ name: 'x', systemPrompt: '', scheduleStyle: 'mindful' } as any)).toContain('没有物理身体');
    });

    it('解析：只收认识的档位，乱写的退回默认；一项都认不出就是 null', () => {
        const t = parseTemperament('好的```json\n{"baseline":{"miss":"high","sulk":"超高"},"sensitivity":{"sulk":"low"},"recovery":"slow","stressOutlet":"user","disabled":["desire","nope"],"reasoning":"黏人但不记仇"}\n```', 1)!;
        expect(t.baseline).toEqual({ miss: 'high' });
        expect(t.sensitivity).toEqual({ sulk: 'low' });
        expect(t.recovery).toBe('slow');
        expect(t.stressOutlet).toBe('user');
        expect(t.disabled).toEqual(['desire']);
        expect(t.source).toBe('auto');
        expect(parseTemperament('{"recovery":"fast"}')).toBeNull();
        expect(parseTemperament('抱歉')).toBeNull();
    });

    it('改过就标成已确认；生成时把副 API 的回复解析出来', async () => {
        const t = parseTemperament('{"baseline":{"miss":"mid"},"sensitivity":{}}', 1)!;
        expect(editTemperament(t, { recovery: 'fast' }).source).toBe('confirmed');
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"baseline":{"social":"low"},"sensitivity":{"stress":"high"}}' } }] }) })) as any;
        const out = await generateTemperament({ name: '卫斯理', systemPrompt: '……' } as any, { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }, fetchImpl);
        expect(out.baseline.social).toBe('low');
        expect(fetchImpl.mock.calls[0][0]).toBe('https://x/v1/chat/completions');
    });
});
