import { describe, expect, it } from 'vitest';
import { buildInviteTurnBlock, deepTalkEventText, proposedAtFromClock } from './deepTalk';
import { defaultInviteClock } from '../components/deepTalk/DeepTalkInviteSheet';

const names = { userName: '阿萌', charName: '既白' };

describe('烛下约时间', () => {
    it('她选的钟点：今天还没到就是今天，过了就是明天；格式不对不收', () => {
        const now = new Date(2026, 9, 22, 17, 30);
        expect(new Date(proposedAtFromClock('20:00', now)!).toString()).toBe(new Date(2026, 9, 22, 20, 0).toString());
        expect(new Date(proposedAtFromClock('09:15', now)!).toString()).toBe(new Date(2026, 9, 23, 9, 15).toString());
        expect(proposedAtFromClock('25:00', now)).toBeNull();
        expect(proposedAtFromClock('八点', now)).toBeNull();
    });

    it('默认约在晚上八点；七点以后默认下一个整点', () => {
        expect(defaultInviteClock(new Date(2026, 9, 22, 15, 10))).toBe('20:00');
        expect(defaultInviteClock(new Date(2026, 9, 22, 21, 40))).toBe('22:00');
        expect(defaultInviteClock(new Date(2026, 9, 22, 23, 5))).toBe('00:00');
    });

    it('邀请气泡写上时间；到点那个气泡写「来了，蜡烛点上了」', () => {
        expect(deepTalkEventText('invite', { ...names, invitedBy: 'user', proposedClock: '20:00' })).toBe('阿萌点了一支蜡烛，想在 20:00 和你聊聊');
        expect(deepTalkEventText('invite', { ...names, invitedBy: 'user' })).toBe('阿萌点了一支蜡烛，想和你聊聊');
        expect(deepTalkEventText('due', names)).toBe('既白来了，蜡烛点上了');
    });

    it('约了时间的邀请问的是「那个时间行不行」，还是同一套标记', () => {
        const block = buildInviteTurnBlock(names, '20:00');
        expect(block).toContain('想约你 20:00');
        expect(block).toContain('[[DEEP_TALK: accept]]');
        expect(block).toContain('改到的时间');
        expect(buildInviteTurnBlock(names)).toContain('现在就能聊');
    });
});
