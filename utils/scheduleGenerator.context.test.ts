import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message, UserProfile } from '../types';
import { formatChatHistoryForSchedule, formatDailyRhythmForSchedule, formatSleepWindowForSchedule, recentMessagesForSchedule, SCHEDULE_HISTORY_MAX, SCHEDULE_HISTORY_MIN } from './scheduleGenerator';

const char = {
    id: 'char-1',
    name: '阿澄',
    timeAwarenessEnabled: false,
} as CharacterProfile;

const user = { name: '小鱼' } as UserProfile;
const timestamp = new Date('2026-07-30T08:00:00Z').getTime();

const msg = (input: Partial<Message> & Pick<Message, 'id' | 'role' | 'type' | 'content'>): Message => ({
    charId: char.id,
    timestamp,
    ...input,
} as Message);

describe('日程历史与私聊消息格式对齐', () => {
    it('日常节律保留原文，并替换用户占位符', () => {
        const block = formatDailyRhythmForSchedule({
            ...char,
            dailyRhythm: '22:00-次日01:00：和{{ user }}打游戏\n睡眠：偏晚',
        }, user);

        expect(block).toContain('22:00-次日01:00');
        expect(block).toContain('和小鱼打游戏');
        expect(block).not.toContain('{{ user }}');
        expect(block).toContain('高优先级生成参考');
    });

    it('没有日常节律时不向生成提示词增加空区块', () => {
        expect(formatDailyRhythmForSchedule(char, user)).toBe('');
    });

    it('睡眠区间按跨午夜时钟注入，避免生成器占用睡眠时段', () => {
        const block = formatSleepWindowForSchedule({
            ...char,
            sleepWindow: { bedtimeMinutes: 23 * 60, wakeTimeMinutes: 24 * 60 + 7 * 60 + 30 },
        });

        expect(block).toContain('23:00');
        expect(block).toContain('次日 07:30');
        expect(block).toContain('不要在这个区间安排活动');
    });

    it('双语消息只保留原文侧，避免历史体积近乎翻倍', () => {
        const block = formatChatHistoryForSchedule([
            msg({
                id: 1,
                role: 'assistant',
                type: 'text',
                content: 'Bonjour, tu vas bien ?\n%%BILINGUAL%%\n你好，最近好吗？',
            }),
        ], char, user);

        expect(block).toContain('Bonjour, tu vas bien ?');
        expect(block).not.toContain('%%BILINGUAL%%');
        expect(block).not.toContain('你好，最近好吗？');
    });

    it('交换日记保留双方正文，并去掉原始 JSON 载荷', () => {
        const card = {
            type: 'diary_card',
            date: '2026-07-30',
            userName: user.name,
            userText: '今天路过旧书店，买到了找很久的画册。',
            charText: '下次记得把那本画册拍给我看，我想看看封面。',
        };
        const block = formatChatHistoryForSchedule([
            msg({
                id: 2,
                role: 'system',
                type: 'score_card',
                content: JSON.stringify(card),
                metadata: { scoreCard: card },
            }),
        ], char, user);

        expect(block).toContain('交换日记');
        expect(block).toContain(card.userText);
        expect(block).toContain(card.charText);
        expect(block).not.toContain('"userText"');
        expect(block).not.toContain('"charText"');
    });

    it('家园正文完整保留，且补上与私聊相同的共同世界框定', () => {
        const worldBody = '「家园 · 海边小屋」下午\n阿澄在露台浇花\n把晒蔫的薄荷搬到了阴影里。';
        const block = formatChatHistoryForSchedule([
            msg({
                id: 3,
                role: 'assistant',
                type: 'world_card',
                content: worldBody,
                metadata: { worldName: '海边小屋', mode: 'normal' },
            }),
        ], char, user);

        expect(block).toContain(worldBody);
        expect(block).toContain('共同世界「家园」');
    });

    it('HTML 卡片只保留可见文字摘要，不把完整 HTML/CSS 塞进日程', () => {
        const rawHtml = `[HTML卡片] <style>${'.card{color:red}'.repeat(1000)}</style><div>隐藏载荷</div>`;
        const block = formatChatHistoryForSchedule([
            msg({
                id: 4,
                role: 'assistant',
                type: 'html_card',
                content: rawHtml,
                metadata: { htmlTextPreview: '今天完成了一张旅行计划卡。' },
            }),
        ], char, user);

        expect(block).toContain('今天完成了一张旅行计划卡。');
        expect(block).not.toContain('.card{color:red}');
        expect(block.length).toBeLessThan(1000);
    });

    it('图片只保留文字占位，不携带 base64', () => {
        const block = formatChatHistoryForSchedule([
            msg({
                id: 5,
                role: 'user',
                type: 'image',
                content: `data:image/png;base64,${'A'.repeat(20_000)}`,
            }),
        ], char, user);

        expect(block).toContain('[User sent an image]');
        expect(block).not.toContain('data:image/png;base64');
        expect(block.length).toBeLessThan(1000);
    });
});

// [EM-START: schedule-recent-context]
describe('日程只看最近的聊天（重排太慢）', () => {
    const NOW = new Date('2026-10-30T20:00:00Z').getTime();
    const H = 3600_000;
    const at = (id: number, hoursAgo: number) => msg({ id, role: 'user', type: 'text', content: `m${id}`, timestamp: NOW - hoursAgo * H });

    it('只留最近一天半的', () => {
        const old = Array.from({ length: 100 }, (_, i) => at(i, 100 - i * 0.1)); // 100–90 小时前
        const recent = Array.from({ length: 50 }, (_, i) => at(1000 + i, 30 - i * 0.5)); // 30–5.5 小时前
        expect(recentMessagesForSchedule([...old, ...recent], NOW).map(m => m.id)).toEqual(recent.map(m => m.id));
    });

    it('聊得很多也最多这么多条，留的是最后的', () => {
        const messages = Array.from({ length: 400 }, (_, i) => at(i, 10 - i * 0.01));
        const kept = recentMessagesForSchedule(messages, NOW);
        expect(kept).toHaveLength(SCHEDULE_HISTORY_MAX);
        expect(kept[0].id).toBe(400 - SCHEDULE_HISTORY_MAX);
    });

    it('最近没怎么聊：照样留最后几十条接前情', () => {
        const messages = Array.from({ length: 80 }, (_, i) => at(i, 200 - i));
        const kept = recentMessagesForSchedule(messages, NOW);
        expect(kept).toHaveLength(SCHEDULE_HISTORY_MIN);
        expect(kept.at(-1)?.id).toBe(79);
    });
});
// [EM-END: schedule-recent-context]
