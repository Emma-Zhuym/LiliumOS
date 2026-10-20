// [EM-START: char-drives-engine]
/**
 * 脾气读数（docs/spec-character-drives.md 5.6）：同一件事，每个角色在意的程度不一样。
 *
 * LiliumOS 的人设很厚，性格早就写好了；劲儿系统不能自己再发明一套性格，只能把人设「翻译」成数。
 * 所以由副 API 读一次人设，给出每股劲儿平常的水平、敏感度、回落快慢、压力出口、哪几股不适用——
 * 全是低 / 中 / 高三档（模型分档比给小数靠谱，阿萌看着也好改）。照记忆宫殿「性格检测」的路子，
 * 已有的反刍倾向直接拿来当参考（高 → 回味高、别扭消得慢）。
 *
 * 生成的标 source='auto'，阿萌在心跳面板里改过就是 'confirmed'。随快照传给 mini。
 */

import type { CharacterProfile, DriveKey, DriveLevel, DriveTemperament } from '../types';

export const DRIVE_KEYS: DriveKey[] = ['miss', 'curious', 'reminisce', 'social', 'stress', 'sulk', 'concern', 'desire', 'tired'];
export const DRIVE_NAMES: Record<DriveKey, string> = {
    miss: '想你', curious: '好奇', reminisce: '回味', social: '社交', stress: '压力', sulk: '别扭', concern: '挂心', desire: '念想', tired: '疲惫',
};
export const LEVEL_NAMES: Record<DriveLevel, string> = { low: '低', mid: '中', high: '高' };
export const RECOVERY_NAMES = { fast: '来得快去得快', mid: '一般', slow: '要闷一阵' } as const;
export const OUTLET_NAMES = { friends: '找朋友吐槽', user: '来找你说', work: '闷头干活', alone: '自己消化' } as const;
const LEVELS: DriveLevel[] = ['low', 'mid', 'high'];

export const buildTemperamentPrompt = (char: Pick<CharacterProfile, 'name' | 'systemPrompt' | 'description' | 'ruminationTendency' | 'scheduleStyle'>): string => {
    const persona = String(char.systemPrompt || char.description || '').slice(0, 2400);
    return `你是一个性格分析助手。读下面这个角色的设定，判断 TA 的「脾气」。只按设定判断，不要发挥。

## 角色：${char.name}
${persona}
${typeof char.ruminationTendency === 'number' ? `\n（已有的检测：反刍倾向 ${char.ruminationTendency}，越高越容易纠结旧事。）` : ''}
${char.scheduleStyle === 'mindful' ? '\n（这是没有物理身体的 AI 存在：没有出门社交、没有身体上的累和性欲。）' : ''}

## 要判断的九股劲儿
${DRIVE_KEYS.map(key => `- ${key}（${DRIVE_NAMES[key]}）`).join('\n')}

每股给两个档位（low / mid / high）：
- baseline：平时这股劲儿有多强（比如黏人的人「想你」平时就高）
- sensitivity：同样的事对 TA 触动多大（比如敏感的人被冷落一下「别扭」涨很多）
另外：
- recovery：别扭、压力消得快慢：fast / mid / slow
- stressOutlet：压力大时习惯怎么排解：friends（找朋友吐槽）/ user（找对方说）/ work（闷头干活）/ alone（自己消化）
- disabled：设定里根本不适用的几股（没有就空数组）
- reasoning：30 字以内的理由

只输出 JSON：
{"baseline":{"miss":"mid",...},"sensitivity":{"sulk":"mid",...},"recovery":"mid","stressOutlet":"alone","disabled":[],"reasoning":"..."}`;
};

const levelMap = (raw: unknown): Partial<Record<DriveKey, DriveLevel>> => {
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(DRIVE_KEYS
        .filter(key => LEVELS.includes((raw as any)[key]))
        .map(key => [key, (raw as any)[key]])) as Partial<Record<DriveKey, DriveLevel>>;
};

/** 模型给的整理一遍；一项都认不出就返回 null。 */
export const parseTemperament = (text: string, now = Date.now()): DriveTemperament | null => {
    const match = String(text ?? '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    let raw: any;
    try { raw = JSON.parse(match[0]); } catch { return null; }
    const baseline = levelMap(raw.baseline);
    const sensitivity = levelMap(raw.sensitivity);
    if (!Object.keys(baseline).length && !Object.keys(sensitivity).length) return null;
    return {
        baseline,
        sensitivity,
        recovery: ['fast', 'mid', 'slow'].includes(raw.recovery) ? raw.recovery : 'mid',
        stressOutlet: ['friends', 'user', 'work', 'alone'].includes(raw.stressOutlet) ? raw.stressOutlet : 'alone',
        disabled: Array.isArray(raw.disabled) ? raw.disabled.filter((key: any) => DRIVE_KEYS.includes(key)) : [],
        source: 'auto',
        generatedAt: now,
        reasoning: typeof raw.reasoning === 'string' ? raw.reasoning.slice(0, 60) : undefined,
    };
};

/** 读人设生成一份。api 用角色的副 API（情绪评估那套）或心跳那套，调用方定。失败抛错。 */
export const generateTemperament = async (
    char: Pick<CharacterProfile, 'name' | 'systemPrompt' | 'description' | 'ruminationTendency' | 'scheduleStyle'>,
    api: { baseUrl: string; apiKey: string; model: string },
    fetchImpl: typeof fetch = fetch,
): Promise<DriveTemperament> => {
    const base = api.baseUrl.replace(/\/+$/, '');
    const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
    const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
        body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: buildTemperamentPrompt(char) }], temperature: 0.3 }),
    });
    if (!response.ok) throw new Error(`读脾气失败：模型返回 ${response.status}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((b: any) => b?.text ?? '').join('') : '';
    const parsed = parseTemperament(text);
    if (!parsed) throw new Error('读脾气失败：模型没给出能用的结果');
    return parsed;
};

/** 阿萌改了某一项：标成已确认。 */
export const editTemperament = (t: DriveTemperament, patch: Partial<DriveTemperament>): DriveTemperament => ({
    ...t, ...patch, source: 'confirmed',
});
// [EM-END: char-drives-engine]
