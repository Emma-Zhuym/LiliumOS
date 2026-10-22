// [EM-START: emoji-group-intro]
import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import { groupIntroLine, groupVisionHint, stickerGroupFromUrl, stickerLabelWithDescription } from './emEmojiStickerLabel';
import type { CharacterProfile, Emoji, EmojiCategory, Message, UserProfile } from '../types';

const categories: EmojiCategory[] = [
    { id: 'default', name: '默认', isSystem: true },
    { id: 'mame', name: '小豆泥', intro: '一只圆眼睛的小暹罗猫，表情很软' },
    { id: 'pingu', name: 'pingu' },
];
const emojis: Emoji[] = [
    { name: '抱抱', url: 'blobref:a', categoryId: 'mame', description: '张开手扑过来' },
    { name: '震惊', url: 'blobref:b', categoryId: 'pingu' },
    { name: '好的', url: 'blobref:c' },
];

describe('表情分组「是谁」', () => {
    it('阿萌发的表情带组名，默认组不带', () => {
        expect(stickerGroupFromUrl(emojis, categories, 'blobref:a')).toBe('小豆泥');
        expect(stickerGroupFromUrl(emojis, categories, 'blobref:b')).toBe('pingu');
        expect(stickerGroupFromUrl(emojis, categories, 'blobref:c')).toBe('');
        expect(stickerLabelWithDescription('抱抱', '张开手扑过来', '小豆泥')).toBe('抱抱（小豆泥）（图上：张开手扑过来）');
        expect(stickerLabelWithDescription('好的', '', '')).toBe('好的');
    });

    it('表情清单后面单独一行介绍，只列写了介绍、清单里有的组', () => {
        expect(groupIntroLine(categories, ['mame', 'pingu', 'default'])).toBe('（这几组表情包的主角：小豆泥＝一只圆眼睛的小暹罗猫，表情很软）');
        expect(groupIntroLine(categories, ['pingu'])).toBe('');
        const context = ChatPrompts.buildEmojiContext(emojis, categories);
        expect(context).toContain('小豆泥: [抱抱]'); // 组名本身不变，角色写「组名:表情名」照样对得上
        expect(context).toContain('小豆泥＝一只圆眼睛的小暹罗猫');
    });

    it('读图时告诉模型这一组是谁，默认组什么都不说', () => {
        expect(groupVisionHint(categories[1])).toContain('描述里直接称呼「小豆泥」');
        expect(groupVisionHint(categories[1])).toContain('圆眼睛的小暹罗猫');
        expect(groupVisionHint(categories[0])).toBe('');
        expect(groupVisionHint(undefined)).toBe('');
    });

    it('私聊历史里阿萌发的表情带组名', () => {
        const char = { id: 'c1', name: '陈照', memories: [] } as unknown as CharacterProfile;
        const user = { name: '阿萌' } as unknown as UserProfile;
        const history = [{ id: 1, charId: 'c1', role: 'user', type: 'emoji', content: 'blobref:a', timestamp: 1 } as Message];
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, user, emojis, undefined, { emojiCategories: categories });
        expect(apiMessages[0].content).toContain('发送了表情包: 抱抱（小豆泥）（图上：张开手扑过来）');
    });
});
// [EM-END: emoji-group-intro]
