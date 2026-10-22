// [EM-START: emoji-descriptions]
/**
 * 阿萌发的表情包在聊天记录里给角色看的样子：名字 +「图上画了什么」。
 * 不带任何依赖：聊天提示词、群聊提示词都从这里取，免得把 DB / 网络代码带进别的打包。
 * 描述怎么来的见 utils/emEmojiDescriptions.ts。
 */

import type { Emoji, EmojiCategory } from '../types';

/** 描述最长多少字。表情包一两句话就够，太长了每次发都拖一大段。 */
export const EMOJI_DESCRIPTION_MAX = 120;

export const cleanEmojiDescription = (value: unknown): string => (typeof value === 'string' ? value : '')
    .replace(/^\s*(?:描述|画面|图上)\s*[：:]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EMOJI_DESCRIPTION_MAX);

/** 没有描述就和以前一样只有名字；有组名（不是默认组）就跟在名字后面 */
export const stickerLabelWithDescription = (name: string, description?: string, group?: string): string => {
    const clean = cleanEmojiDescription(description);
    const withGroup = group ? `${name}（${group}）` : name;
    return clean ? `${withGroup}（图上：${clean}）` : withGroup;
};

// [EM-START: emoji-group-intro]
/** 分组介绍最长多少字：一句话说清是谁就够 */
export const EMOJI_GROUP_INTRO_MAX = 60;

export const cleanGroupIntro = (value: unknown): string => (typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EMOJI_GROUP_INTRO_MAX);

/** 「默认 / 通用」这种系统组不算一个形象，不带组名 */
const isPlainGroup = (category: EmojiCategory | undefined): boolean =>
    !category || category.id === 'default' || !!category.isSystem;

/** 阿萌发的这个表情属于哪个组（默认组返回空）。没有介绍也带组名：组名本身就是 IP 名 */
export const stickerGroupFromUrl = (emojis: Emoji[], categories: EmojiCategory[] | undefined, url: string): string => {
    const categoryId = emojis.find(e => e.url === url)?.categoryId;
    const category = categoryId ? categories?.find(c => c.id === categoryId) : undefined;
    return isPlainGroup(category) ? '' : category!.name;
};

/**
 * 角色表情清单后面那一行：这几组分别是谁。不塞进分组标题——角色发表情偶尔写「组名:表情名」，
 * 程序按组名对，标题里多了介绍就对不上了。没有任何介绍时返回空。
 */
export const groupIntroLine = (categories: EmojiCategory[], usedCategoryIds: Iterable<string>): string => {
    const used = new Set(usedCategoryIds);
    const parts = categories
        .filter(c => used.has(c.id) && !isPlainGroup(c) && cleanGroupIntro(c.intro))
        .map(c => `${c.name}＝${cleanGroupIntro(c.intro)}`);
    return parts.length ? `（这几组表情包的主角：${parts.join('；')}）` : '';
};

/** 让读图模型认得这一组的形象：描述里直接用组名称呼它 */
export const groupVisionHint = (category: EmojiCategory | undefined): string => {
    if (isPlainGroup(category)) return '';
    const intro = cleanGroupIntro(category!.intro);
    return `这个表情包属于「${category!.name}」${intro ? `（${intro}）` : ''}这一组，画面里的主角就是它，描述里直接称呼「${category!.name}」。`;
};
// [EM-END: emoji-group-intro]

/** 按消息里存的图（令牌 / 网址）找到表情的描述。 */
export const stickerDescriptionFromUrl = (emojis: Emoji[], url: string): string =>
    cleanEmojiDescription(emojis.find(e => e.url === url)?.description);
// [EM-END: emoji-descriptions]
