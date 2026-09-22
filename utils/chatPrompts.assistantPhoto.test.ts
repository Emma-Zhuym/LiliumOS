import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';

// 角色 SEND_PHOTO 生成的图片以 role: 'assistant' 存档。OpenAI / Claude / Gemini 只接受
// user 消息里的 image_url，历史里一旦回放 assistant 带图，后续每一轮都会 400。

const char = { id: 'c1', name: '小角色' } as any;
const userProfile = { name: '我' } as any;
const t0 = Date.now() - 60_000;

describe('buildMessageHistory 角色生图消息', () => {
    it('assistant 图片只回放文字，并带上原始 photoPrompt', () => {
        const history = [
            { id: 1, charId: 'c1', role: 'assistant', type: 'image', content: 'data:image/png;base64,AAAA', timestamp: t0, metadata: { photoPrompt: 'a bowl of ramen on a wooden table' } },
            { id: 2, charId: 'c1', role: 'user', type: 'text', content: '好香', timestamp: t0 + 1000 },
        ] as any[];
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);
        const aiMsg = apiMessages.find((m: any) => m.role === 'assistant')!;
        expect(typeof aiMsg.content).toBe('string');
        expect(aiMsg.content).toContain('你发送了一张照片：a bowl of ramen on a wooden table');
        expect(JSON.stringify(apiMessages)).not.toContain('image_url');
    });

    it('没有 photoPrompt 的 assistant 图片也不带 image_url', () => {
        const history = [
            { id: 1, charId: 'c1', role: 'assistant', type: 'image', content: 'https://example.com/a.png', timestamp: t0 },
        ] as any[];
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);
        expect(apiMessages[0].content).toContain('你发送了一张照片');
        expect(JSON.stringify(apiMessages)).not.toContain('image_url');
    });

    it('用户发的图片仍走 image_url（既有行为不回归）', () => {
        const history = [
            { id: 1, charId: 'c1', role: 'user', type: 'image', content: 'data:image/png;base64,AAAA', timestamp: t0 },
        ] as any[];
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);
        const content = apiMessages[0].content as any[];
        expect(Array.isArray(content)).toBe(true);
        expect(content.some(p => p.type === 'image_url')).toBe(true);
    });
});
