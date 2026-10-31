// [EM-START: ooc]
import { beforeEach, describe, expect, it } from 'vitest';

import type { CharacterProfile, Message, UserProfile } from '../types';
import { ChatPrompts } from './chatPrompts';
import {
    buildOocPinsInjection, cleanOocReply, isOocPinned, isOocPromptContent, loadOocPins, oocPromptContent, parseOocInput, pinOoc, unpinOoc,
    updateOocPin,
} from './emOoc';

describe('OOC：怎么认', () => {
    it('// 、OOC：、（OOC）开头都算，去掉前缀', () => {
        expect(parseOocInput('// 时差又算错了')).toBe('时差又算错了');
        expect(parseOocInput('OOC：别再写动作描写')).toBe('别再写动作描写');
        expect(parseOocInput('ooc: shorter please')).toBe('shorter please');
        expect(parseOocInput('（OOC）你刚才理解错了')).toBe('你刚才理解错了');
        expect(parseOocInput('(ooc) 慢一点')).toBe('慢一点');
    });

    it('不是开头、只有前缀、普通括号都不算', () => {
        expect(parseOocInput('今天好累 //')).toBeNull();
        expect(parseOocInput('//')).toBeNull();
        expect(parseOocInput('（小声）想你了')).toBeNull();
        expect(parseOocInput('http://example.com')).toBeNull();
    });
});

describe('OOC：给模型看', () => {
    it('她的那条标明是作者说的；最后一条要求出戏回应', () => {
        const text = oocPromptContent({ role: 'user', content: '时差又算错了' }, { userName: '阿萌', timeStr: '[10-30 21:00]', isLast: true });
        expect(text).toContain('[OOC｜阿萌以作者身份对你（模型）说的');
        expect(text).toContain('不是 ta 的情绪');
        expect(text).toContain('这一轮请出戏回应');
        expect(oocPromptContent({ role: 'user', content: 'x' }, { userName: '阿萌' })).not.toContain('这一轮请出戏回应');
        expect(isOocPromptContent(text)).toBe(true);
        expect(isOocPromptContent('[10-30] 早安')).toBe(false);
    });

    it('聊天记录里：OOC 带标记、普通消息不受影响', () => {
        const char = { id: 'lumi', name: '露米', timeAwarenessEnabled: false } as CharacterProfile;
        const user = { name: '阿萌' } as UserProfile;
        const messages = [
            { id: 1, charId: 'lumi', role: 'user', type: 'text', content: '早安', timestamp: 1 },
            { id: 2, charId: 'lumi', role: 'user', type: 'text', content: '你又搞错时差了', timestamp: 2, metadata: { ooc: true } },
        ] as Message[];
        const { apiMessages } = ChatPrompts.buildMessageHistory(messages, 10, char, user, []);
        const contents = apiMessages.map(m => String(m.content));
        expect(contents.find(c => c.includes('早安'))).not.toContain('OOC');
        expect(contents.find(c => c.includes('搞错时差'))).toContain('这一轮请出戏回应');
    });

    it('模型的出戏回应：剥思考块和标签', () => {
        expect(cleanOocReply('<think>嗯</think>[OOC] 明白了，时差我会看第二行。[[DATE_PLAN: 明天 | x | y]]')).toBe('明白了，时差我会看第二行。');
    });
});

describe('OOC：钉住', () => {
    beforeEach(() => localStorage.clear());

    it('钉住、取消；每一轮带上', () => {
        pinOoc('lumi', { id: 7, content: '我在芝加哥，你在上海，别再自己算时差' });
        expect(isOocPinned('lumi', 7)).toBe(true);
        expect(buildOocPinsInjection('lumi', '阿萌')).toContain('- 我在芝加哥，你在上海，别再自己算时差');
        unpinOoc('lumi', 7);
        expect(buildOocPinsInjection('lumi', '阿萌')).toBe('');
    });

    it('最多 8 条，满了挤掉最早的', () => {
        for (let i = 0; i < 10; i += 1) pinOoc('lumi', { id: i, content: `第${i}条` });
        expect(loadOocPins('lumi').map(p => p.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    });
});
// [EM-END: ooc]

describe('改钉住的要求', () => {
    it('只改钉住的这份，进提示词的跟着变', () => {
        pinOoc('edit-a', { id: 7, content: '绝对不能复述' });
        updateOocPin('edit-a', 7, '  可以提，但要有心疼  ');
        expect(loadOocPins('edit-a')[0].text).toBe('可以提，但要有心疼');
        expect(buildOocPinsInjection('edit-a', '阿萌')).toContain('可以提，但要有心疼');
        expect(buildOocPinsInjection('edit-a', '阿萌')).not.toContain('绝对不能复述');
    });
});
