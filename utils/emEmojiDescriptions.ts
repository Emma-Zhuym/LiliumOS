// [EM-START: emoji-descriptions]
/**
 * 表情包描述：每个表情包可以多存一句「图上画了什么」，阿萌发这个表情时一起给角色看。
 *
 * 起因 2026-10-21：角色看表情包只看名字（「乖乖当狗」），名字是导入时别人起的，常常跟画面
 * 对不上。每次发都让模型读图又贵又慢（图在历史里每轮都占 token），所以改成「看一次、记下来」：
 * 存表情时用识图模型写一句描述，阿萌可以改。
 *
 * - 只在**阿萌发的**表情后面带描述（阿萌 2026-10-21 定）。角色自己挑表情用的那份表情清单
 *   仍然只有名字，否则一百多个表情每轮都多占一大截。
 * - 读图用哪个 API：设置里的识图 API（开着就默认用它）、主 API，或者任一 API 预设。
 *   选择只存本机 localStorage，跟小厨房读小票同一个做法，不进备份。
 */

import type { APIConfig, ApiPreset, Emoji, VisionApiConfig } from '../types';
import { extractContent, safeFetchJson } from './safeApi';
import { isVisionApiReady, visionApiConfigFromPreset } from './visionApi';
import { cleanEmojiDescription } from './emEmojiStickerLabel';

export { cleanEmojiDescription, EMOJI_DESCRIPTION_MAX, stickerLabelWithDescription } from './emEmojiStickerLabel';

export const EMOJI_VISION_PROMPT = `这是一张聊天用的表情包。用一两句中文写清楚画面里实际有什么：
主体是谁 / 是什么（人、动物、卡通形象）、表情和动作、画面上的文字（原样照抄）。
不要猜它想表达什么情绪或用意，不要寒暄，不超过 60 字，只输出描述本身。`;

// ── 用哪个 API 读图 ─────────────────────────────────────────────

export interface EmojiVisionChoice {
    /** 'vision' = 设置里的识图 API，'main' = 主 API，'preset:<id>' = 某个预设 */
    id: string;
    label: string;
    config: VisionApiConfig;
}

const CHOICE_KEY = 'lilium.emoji.visionChoice';

export const readEmojiVisionChoiceId = (): string | null => {
    try { return localStorage.getItem(CHOICE_KEY); } catch { return null; }
};

export const saveEmojiVisionChoiceId = (id: string) => {
    try { localStorage.setItem(CHOICE_KEY, id); } catch { /* 存不了就这次用 */ }
};

const fromApiConfig = (config: APIConfig): VisionApiConfig =>
    visionApiConfigFromPreset({ id: 'main', name: '主 API', config });

/** 能拿来读图的候选：识图 API（开着才列）、主 API、各预设。没填全的不列。 */
export const listEmojiVisionChoices = (apiConfig: APIConfig, presets: ApiPreset[]): EmojiVisionChoice[] => {
    const choices: EmojiVisionChoice[] = [];
    if (isVisionApiReady(apiConfig.visionApi)) choices.push({ id: 'vision', label: `识图 API（${apiConfig.visionApi.model}）`, config: apiConfig.visionApi });
    const main = { ...fromApiConfig(apiConfig), enabled: true };
    if (isVisionApiReady(main)) choices.push({ id: 'main', label: `主 API（${main.model}）`, config: main });
    for (const preset of presets) {
        const config = visionApiConfigFromPreset(preset);
        if (isVisionApiReady(config)) choices.push({ id: `preset:${preset.id}`, label: `${preset.name}（${config.model}）`, config });
    }
    return choices;
};

/** 上次选的还在就用它；否则识图 API 优先，再退到主 API。 */
export const pickEmojiVisionChoice = (choices: EmojiVisionChoice[], savedId: string | null): EmojiVisionChoice | null =>
    choices.find(choice => choice.id === savedId) ?? choices[0] ?? null;

// ── 读图 ───────────────────────────────────────────────────────

/**
 * 让模型看一眼表情包写描述。图可以是本机令牌（blobref:）、data URL 或网址：
 * safeFetchJson 发出去之前会把令牌还原成 data URL。
 */
export const describeEmojiImage = async (imageValue: string, config: VisionApiConfig): Promise<string> => {
    if (!isVisionApiReady(config)) throw new Error('读图用的 API 没填完整（地址、Key、模型）');
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
        body: JSON.stringify({
            model: config.model.trim(),
            messages: [{ role: 'user', content: [
                { type: 'text', text: EMOJI_VISION_PROMPT },
                { type: 'image_url', image_url: { url: imageValue } },
            ] }],
            temperature: 0,
            max_tokens: 300,
            stream: false,
        }),
    }, 1, 60_000, { appName: '聊天', purpose: '表情包描述' });
    const description = cleanEmojiDescription(extractContent(data));
    if (!description) throw new Error('模型没写出描述（可能这个模型看不了图）');
    return description;
};

export interface DescribeBatchResult { done: number; failed: { name: string; reason: string }[] }

/**
 * 一批表情逐个写描述。一个失败不连累后面的。
 * 开头 3 个全失败就停：多半是 API / 模型看不了图。成功过以后不再停——中间连着失败通常是一串
 * 图床挂了的表情（sharkpan 那批整片都打不开），不该连累后面好的。
 */
export const describeEmojisInBatch = async (
    emojis: Emoji[],
    deps: {
        describe: (imageValue: string) => Promise<string>;
        save: (name: string, description: string) => Promise<void>;
        onProgress?: (done: number, total: number) => void;
        shouldStop?: () => boolean;
    },
): Promise<DescribeBatchResult> => {
    const result: DescribeBatchResult = { done: 0, failed: [] };
    let streak = 0;
    for (let i = 0; i < emojis.length; i += 1) {
        if (deps.shouldStop?.()) break;
        const emoji = emojis[i];
        try {
            await deps.save(emoji.name, await deps.describe(emoji.url));
            result.done += 1;
            streak = 0;
        } catch (error) {
            result.failed.push({ name: emoji.name, reason: (error as Error)?.message || '失败' });
            streak += 1;
            if (streak >= 3 && result.done === 0) {
                for (const rest of emojis.slice(i + 1)) result.failed.push({ name: rest.name, reason: '开头几个都失败了，没再试' });
                break;
            }
        }
        deps.onProgress?.(i + 1, emojis.length);
    }
    return result;
};

/** 还没写描述、而且图还在的表情（网址形式的也算，图床活着就能读）。 */
export const emojisMissingDescription = (emojis: Emoji[]): Emoji[] =>
    emojis.filter(e => !cleanEmojiDescription(e.description) && typeof e.url === 'string' && e.url.length > 0);
// [EM-END: emoji-descriptions]
