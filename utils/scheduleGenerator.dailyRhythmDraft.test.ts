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

describe('buildDailyRhythmDraftPrompt · 老角色的调整场景', () => {
    const char = { name: '陆时', systemPrompt: '项目经理，工作狂', description: '', worldview: '' } as CharacterProfile;

    it('要求时间写具体，不能只写"白天/晚上"糊弄过去', () => {
        const { system } = buildDailyRhythmDraftPrompt(char, user);
        expect(system).toContain('时间要写具体');
        expect(system).toContain('太模糊等于没写');
    });

    it('带上现有节律时，system 里出现"相处会改变作息"的规则，user 里带上现有节律原文', () => {
        const { system, user: userMsg } = buildDailyRhythmDraftPrompt(char, user, {
            currentRhythm: '周一到周五 9:00-18:00 在公司',
        });
        expect(system).toContain('相处会改变作息');
        expect(system).toContain('没有新证据支持的部分照抄现有节律');
        expect(userMsg).toContain('TA 现在的节律');
        expect(userMsg).toContain('9:00-18:00 在公司');
    });

    it('没有现有节律时不提这条规则，也不在 user 里塞空段落', () => {
        const { system, user: userMsg } = buildDailyRhythmDraftPrompt(char, user);
        expect(system).not.toContain('相处会改变作息');
        expect(userMsg).not.toContain('TA 现在的节律');
    });

    it('带上调整说明时，作为最高优先级规则出现在 system 里', () => {
        const { system } = buildDailyRhythmDraftPrompt(char, user, {
            instruction: '他最近升职了，周末也偶尔要加班',
        });
        expect(system).toContain('阿萌的调整说明（最优先，照这个改）');
        expect(system).toContain('他最近升职了，周末也偶尔要加班');
    });

    it('带上最近聊天记录时，user 里附上原文，供模型判断作息是否已经变化', () => {
        const { user: userMsg } = buildDailyRhythmDraftPrompt(char, user, {
            recentChatText: '阿萌: 你怎么又加班\n陆时: 最近项目忙，可能周末也要来',
        });
        expect(userMsg).toContain('最近的聊天记录');
        expect(userMsg).toContain('最近项目忙，可能周末也要来');
    });
});
