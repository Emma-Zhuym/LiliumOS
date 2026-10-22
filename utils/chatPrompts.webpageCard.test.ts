// [EM-START: webpage-card-history]
import { describe, expect, it } from 'vitest';
import { ChatPrompts, WEBPAGE_CARD_FULL_ROUNDS } from './chatPrompts';
import type { CharacterProfile, Message, UserProfile } from '../types';

// 网页卡片（含 B 站视频）的正文 / 字幕存在 metadata.webpage 里，content 只是标题。
// 私聊历史以前直接拿 content 当正文，角色只看得到标题——字幕读到了也白读。

const char = { id: 'c1', name: '陈照', memories: [] } as unknown as CharacterProfile;
const userProfile = { name: '阿萌' } as unknown as UserProfile;

const history: Message[] = [
    {
        id: 1, charId: 'c1', role: 'user', type: 'webpage_card', content: '猫为什么踩奶', timestamp: 1,
        metadata: { webpage: {
            title: '猫为什么踩奶', url: 'https://www.bilibili.com/video/BV1xx',
            video: { platform: 'bilibili', platformLabel: 'B站', authorName: '猫猫研究所' },
            transcript: '踩奶是小猫吃奶时留下的习惯，长大后放松的时候还会这样做。',
        } },
    } as Message,
    {
        id: 2, charId: 'c1', role: 'user', type: 'webpage_card', content: '冬天怎么养绿萝', timestamp: 2,
        metadata: { webpage: { title: '冬天怎么养绿萝', url: 'https://example.com/a', content: '绿萝怕冷，室温别低于十度，少浇水。' } },
    } as Message,
];

describe('网页卡片进私聊历史', () => {
    const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);

    it('B 站视频带上字幕', () => {
        expect(apiMessages[0].content).toContain('视频字幕');
        expect(apiMessages[0].content).toContain('踩奶是小猫吃奶时留下的习惯');
    });

    it('普通网页带上正文', () => {
        expect(apiMessages[1].content).toContain('绿萝怕冷');
    });
});
describe('分享过几轮以后只留一小段', () => {
    // 五轮：阿萌说一句、TA 回三条气泡，拆成气泡的不算轮数
    const later: Message[] = Array.from({ length: WEBPAGE_CARD_FULL_ROUNDS }, (_, round) => [
        { id: 100 + round * 4, charId: 'c1', role: 'user', type: 'text', content: `第${round}轮`, timestamp: 100 + round * 4 },
        ...[1, 2, 3].map(k => ({ id: 100 + round * 4 + k, charId: 'c1', role: 'assistant', type: 'text', content: '嗯', timestamp: 100 + round * 4 + k })),
    ] as Message[]).flat();

    it('四轮以内还带全文', () => {
        const { apiMessages: early } = ChatPrompts.buildMessageHistory([history[0], ...later.slice(0, 4 * 4)], 80, char, userProfile, []);
        expect(early[0].content).toContain('视频字幕：');
    });
    const { apiMessages } = ChatPrompts.buildMessageHistory([...history, ...later], 80, char, userProfile, []);

    it('B 站字幕只剩开头，并说明之前看过', () => {
        expect(apiMessages[0].content).toContain('字幕开头：踩奶是小猫');
        expect(apiMessages[0].content).toContain('之前读过这个视频的完整字幕');
        expect(apiMessages[0].content).not.toContain('视频字幕：');
    });

    it('网页正文只剩开头', () => {
        expect(apiMessages[1].content).toContain('正文开头：绿萝怕冷');
        expect(apiMessages[1].content).not.toContain('网页正文：');
    });
});
// [EM-END: webpage-card-history]
