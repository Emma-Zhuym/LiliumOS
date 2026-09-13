// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { getContactRemark, saveContactRemark } from './contactRemarks';
import { ChatPrompts } from './chatPrompts';
import type { CharacterProfile, Message } from '../types';

afterEach(() => localStorage.clear());
it('keeps private remarks out of generated history and preserves original character identity', () => {
    const character = { id: 'remark-test', name: 'Sully' } as CharacterProfile;
    const messages: Message[] = [{ id: 1, charId: character.id, role: 'assistant', type: 'text', content: '你好', timestamp: 1000 }];
    const history = () => ChatPrompts.buildMessageHistory(messages, 10, character, { name: 'User' } as any, []).apiMessages;
    const before = history();
    saveContactRemark(character.id, ' 私人备注甲 ');
    expect(getContactRemark(character.id)).toBe('私人备注甲');
    expect(history()).toEqual(before);
    expect(JSON.stringify(history())).not.toContain('私人备注甲');
    expect(character).toEqual({ id: 'remark-test', name: 'Sully' });
    expect(messages[0].content).toBe('你好');
});
it('stores each contact independently and clearing restores the original-name fallback', () => {
    saveContactRemark('first', '小苏');
    saveContactRemark('second', '另一个备注');
    saveContactRemark('first', '  ');
    expect(getContactRemark('first') || 'Sully').toBe('Sully');
    expect(getContactRemark('second')).toBe('另一个备注');
});
