// [EM-START: daily-rhythm-draft]
import { describe, expect, it } from 'vitest';

import type { CharacterProfile, UserProfile } from '../types';
import { buildDailyRhythmDraftPrompt } from './scheduleGenerator';

const user: UserProfile = { name: '阿萌' } as UserProfile;

describe('buildDailyRhythmDraftPrompt', () => {
    it('把人设各字段拼进 user 消息，system 里要求占位符与不覆盖式输出', () => {
        const char = {
            name: '陈照',
            systemPrompt: '游戏公司美术组长，做事认真。',
            description: '温柔但嘴硬',
            worldview: '',
        } as CharacterProfile;

        const { system, user: userMsg } = buildDailyRhythmDraftPrompt(char, user);

        expect(system).toContain('{{user}}');
        expect(system).not.toContain('阿萌');
        expect(userMsg).toContain('陈照');
        expect(userMsg).toContain('游戏公司美术组长');
        expect(userMsg).toContain('温柔但嘴硬');
    });

    it('没有任何人设字段时，退回一句带名字和用户名的泛用兜底', () => {
        const char = { name: '未命名角色', systemPrompt: '', description: '', worldview: '' } as CharacterProfile;
        const { user: userMsg } = buildDailyRhythmDraftPrompt(char, user);
        expect(userMsg).toContain('未命名角色');
        expect(userMsg).toContain('阿萌');
    });

    it('worldview 为空白字符串时按未填处理，不把空段落塞进 user 消息', () => {
        const char = { name: 'X', systemPrompt: '一个学生', description: '', worldview: '   ' } as CharacterProfile;
        const { user: userMsg } = buildDailyRhythmDraftPrompt(char, user);
        expect(userMsg).not.toContain('世界观');
    });
});
// [EM-END: daily-rhythm-draft]
