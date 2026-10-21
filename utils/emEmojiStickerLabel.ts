// [EM-START: emoji-descriptions]
/**
 * 阿萌发的表情包在聊天记录里给角色看的样子：名字 +「图上画了什么」。
 * 不带任何依赖：聊天提示词、群聊提示词都从这里取，免得把 DB / 网络代码带进别的打包。
 * 描述怎么来的见 utils/emEmojiDescriptions.ts。
 */

import type { Emoji } from '../types';

/** 描述最长多少字。表情包一两句话就够，太长了每次发都拖一大段。 */
export const EMOJI_DESCRIPTION_MAX = 120;

export const cleanEmojiDescription = (value: unknown): string => (typeof value === 'string' ? value : '')
    .replace(/^\s*(?:描述|画面|图上)\s*[：:]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EMOJI_DESCRIPTION_MAX);

/** 没有描述就和以前一样只有名字。 */
export const stickerLabelWithDescription = (name: string, description?: string): string => {
    const clean = cleanEmojiDescription(description);
    return clean ? `${name}（图上：${clean}）` : name;
};

/** 按消息里存的图（令牌 / 网址）找到表情的描述。 */
export const stickerDescriptionFromUrl = (emojis: Emoji[], url: string): string =>
    cleanEmojiDescription(emojis.find(e => e.url === url)?.description);
// [EM-END: emoji-descriptions]
