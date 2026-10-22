// [EM-START: webpage-card-history]
import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';
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
// [EM-END: webpage-card-history]
