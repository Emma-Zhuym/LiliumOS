// [EM-START: assistant-photo-text]
import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import type { CharacterProfile, Message, UserProfile } from '../types';

// 角色自己发的照片（SEND_PHOTO 生成的）不能以 image_url 出现在 assistant 消息里：
// OpenRouter 兼容，直连官方的中转站一律 400，而且之后每一轮都会带着那张图报错。

const char = { id: 'c1', name: '陈照', memories: [] } as unknown as CharacterProfile;
const userProfile = { name: '阿萌' } as unknown as UserProfile;
const DATA = 'data:image/png;base64,QUJD';

const history: Message[] = [
    { id: 1, charId: 'c1', role: 'user', type: 'image', content: DATA, timestamp: 1 } as Message,
    { id: 2, charId: 'c1', role: 'assistant', type: 'image', content: DATA, timestamp: 2, metadata: { aiGenerated: true, photoPrompt: '窗边的咖啡和猫' } } as Message,
    { id: 3, charId: 'c1', role: 'assistant', type: 'image', content: DATA, timestamp: 3 } as Message,
    { id: 4, charId: 'c1', role: 'user', type: 'text', content: '好可爱', timestamp: 4 } as Message,
];

describe('角色自己发的照片只给文字', () => {
    const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);

    it('用户发的图照旧带 image_url', () => {
        const user = apiMessages.find(m => m.role === 'user' && Array.isArray(m.content));
        expect(user?.content.some((p: { type: string }) => p.type === 'image_url')).toBe(true);
    });

    it('assistant 消息里没有任何 image_url，带上 TA 生图时写的描述', () => {
        const assistant = apiMessages.filter(m => m.role === 'assistant');
        expect(assistant).toHaveLength(2);
        for (const m of assistant) expect(typeof m.content).toBe('string');
        expect(assistant[0].content).toContain('[你发了一张照片：窗边的咖啡和猫]');
        expect(assistant[1].content).toContain('[你发了一张照片]');
    });
});
// [EM-END: assistant-photo-text]
