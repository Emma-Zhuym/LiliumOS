// [EM-START: agent-backend-snapshot]
import { describe, expect, it, vi } from 'vitest';

import type { CharacterProfile, Message } from '../types';

vi.mock('./dailySchedule', () => ({
    getDailyScheduleForChar: vi.fn(async () => ({
        id: 'lumi_2026-09-23',
        slots: [
            { startTime: '09:00', activity: '上班', location: '公司', availability: 'busy' },
            { startTime: '18:00', activity: '回家做饭', availability: 'online' },
        ],
        generatedAt: Date.now(),
    })),
}));

import { buildCharacterSnapshot, findLastInteraction, messageToPlainText } from './emAgentSnapshot';

const char = {
    id: 'lumi',
    name: '露米',
    description: '温和、爱做饭',
    systemPrompt: '你是露米。',
    worldview: '',
    sleepWindow: { bedtimeMinutes: 23 * 60 + 30, wakeTimeMinutes: 24 * 60 + 7 * 60 },
} as unknown as CharacterProfile;

const message = (overrides: Partial<Message>): Message => ({
    id: 1,
    charId: 'lumi',
    role: 'user',
    type: 'text',
    content: '在吗',
    timestamp: Date.parse('2026-09-23T20:00:00.000Z'),
    ...overrides,
} as Message);

describe('角色近况快照', () => {
    it('带上角色设定、作息与今天的日程', async () => {
        const snapshot = await buildCharacterSnapshot(char, [message({})], {
            userName: '阿萌',
            at: new Date('2026-09-23T20:05:00.000Z'),
        });
        expect(snapshot.charId).toBe('lumi');
        expect(snapshot.payload.identity.persona).toContain('你是露米。');
        // 跨午夜刻度要还原成普通时钟，「次日」前缀对后端没意义。
        expect(snapshot.payload.sleepWindow).toEqual({ start: '23:30', end: '07:00' });
        expect(snapshot.payload.todaySchedule?.[0]).toEqual({
            start: '09:00', end: '18:00', title: '上班 · 公司', availability: 'busy',
        });
        // 最后一个 slot 没有下一段，结束时间留空而不是瞎猜。
        expect(snapshot.payload.todaySchedule?.[1].end).toBe('');
    });

    it('最近消息只留纯文本，图片语音留占位', async () => {
        const snapshot = await buildCharacterSnapshot(char, [
            message({ id: 1, type: 'image', content: 'data:image/png;base64,AAAA' }),
            message({ id: 2, role: 'assistant', type: 'text', content: '在的' }),
        ], { at: new Date('2026-09-23T20:05:00.000Z') });
        const texts = snapshot.payload.recentMessages?.map(item => item.text);
        expect(texts).toEqual(['[一张照片]', '在的']);
        expect(JSON.stringify(snapshot)).not.toContain('base64');
    });

    it('未完事项恒为空：猜出来的会被角色当成约定说出口', async () => {
        const snapshot = await buildCharacterSnapshot(char, [message({})], {});
        expect(snapshot.payload.openThreads).toBeUndefined();
    });

    it('最后互动时间分别取用户侧与角色侧，系统消息不算', () => {
        const found = findLastInteraction([
            message({ id: 1, role: 'user', timestamp: Date.parse('2026-09-23T19:00:00.000Z') }),
            message({ id: 2, role: 'assistant', timestamp: Date.parse('2026-09-23T19:01:00.000Z') }),
            message({ id: 3, role: 'system', type: 'system', timestamp: Date.parse('2026-09-23T19:30:00.000Z') }),
        ]);
        expect(found.userAt).toBe('2026-09-23T19:00:00.000Z');
        expect(found.charAt).toBe('2026-09-23T19:01:00.000Z');
    });

    it('语音消息保留转写文字', () => {
        expect(messageToPlainText(message({ type: 'voice', content: '晚安' }))).toBe('[语音] 晚安');
    });
});


describe('dailyRhythm 进快照', () => {
    it('带上聊天「日程/情绪」面板里的日常节律原文', async () => {
        const rhythmChar = { ...char, dailyRhythm: '周二周四必须到公司开会，其余时间较自由' } as unknown as CharacterProfile;
        const snapshot = await buildCharacterSnapshot(rhythmChar, [], {});
        expect(snapshot.payload.dailyRhythm).toBe('周二周四必须到公司开会，其余时间较自由');
    });

    it('mindful 角色没有物理生活，不带这份', async () => {
        const rhythmChar = { ...char, dailyRhythm: '……', scheduleStyle: 'mindful' } as unknown as CharacterProfile;
        const snapshot = await buildCharacterSnapshot(rhythmChar, [], {});
        expect(snapshot.payload.dailyRhythm).toBeUndefined();
    });

    it('没填就不带这个字段', async () => {
        const snapshot = await buildCharacterSnapshot(char, [], {});
        expect(snapshot.payload.dailyRhythm).toBeUndefined();
    });
});

describe('circle 进快照', () => {
    it('只带虚构、还是好友、私人生活里的人；按最近联系排，不带阿萌本人', async () => {
        const phoneChar = {
            ...char,
            phoneState: {
                records: [],
                contacts: [
                    { id: '1', name: '老周', identity: '发小', kind: 'npc', affinity: 0, status: 'friend', createdAt: 1, lastInteraction: 5 },
                    { id: '2', name: '表姐', identity: '表姐', kind: 'npc', affinity: 0, status: 'friend', createdAt: 1, lastInteraction: 9 },
                    { id: '3', name: '小林', identity: '同事', kind: 'npc', affinity: 0, status: 'friend', createdAt: 1 },
                    { id: '4', name: '陈照', kind: 'real', linkedCharId: 'x', affinity: 0, status: 'friend', createdAt: 1 },
                    { id: '5', name: '前任', kind: 'npc', affinity: 0, status: 'blocked', createdAt: 1 },
                    { id: '6', name: '阿萌', kind: 'npc', affinity: 0, status: 'friend', createdAt: 1 },
                ],
            },
        } as unknown as CharacterProfile;
        const snapshot = await buildCharacterSnapshot(phoneChar, [], { userName: '阿萌' });
        expect(snapshot.payload.circle).toEqual([
            { name: '表姐', relation: '表姐', group: 'family' },
            { name: '老周', relation: '发小', group: 'friend' },
        ]);
    });

    it('没人就不带这个字段', async () => {
        expect((await buildCharacterSnapshot(char, [], {})).payload.circle).toBeUndefined();
    });
});
