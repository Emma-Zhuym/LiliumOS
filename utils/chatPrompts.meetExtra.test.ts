// [EM-START: meet-extra]
import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import { MEET_EXTRA_CARD_KIND, MEET_EXTRA_FULL_ROUNDS, meetExtraCardContent } from './meetExtra';
import type { CharacterProfile, Message, UserProfile } from '../types';

const char = { id: 'c1', name: '陆时', memories: [] } as unknown as CharacterProfile;
const userProfile = { name: '阿萌' } as unknown as UserProfile;

const card: Message = {
    id: 1, charId: 'c1', role: 'user', type: 'text', timestamp: 1,
    content: meetExtraCardContent('雨夜来信'),
    metadata: { kind: MEET_EXTRA_CARD_KIND, meetExtra: { id: 'e1', title: '雨夜来信', synopsis: '民国报社', body: '他把退稿信折好，里面夹着一张电影票。', summary: '他退了她的稿，却夹了一张电影票。' } },
} as Message;

const rounds = (n: number): Message[] => Array.from({ length: n }, (_, r) => [
    { id: 10 + r * 2, charId: 'c1', role: 'user', type: 'text', content: `第${r}轮`, timestamp: 10 + r * 2 },
    { id: 11 + r * 2, charId: 'c1', role: 'assistant', type: 'text', content: '嗯', timestamp: 11 + r * 2 },
] as Message[]).flat();

describe('番外卡进私聊历史', () => {
    it('刚分享的几轮带全文，并说明是虚构的', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory([card, ...rounds(MEET_EXTRA_FULL_ROUNDS - 1)], 80, char, userProfile, []);
        expect(apiMessages[0].content).toContain('里面夹着一张电影票');
        expect(apiMessages[0].content).toContain('虚构的故事');
    });

    it('过了几轮只剩总结', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory([card, ...rounds(MEET_EXTRA_FULL_ROUNDS)], 80, char, userProfile, []);
        expect(apiMessages[0].content).toContain('却夹了一张电影票');
        expect(apiMessages[0].content).not.toContain('全文：');
    });
});
// [EM-END: meet-extra]
