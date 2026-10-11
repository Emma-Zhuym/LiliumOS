// [EM-START: heartbeat-xhs]
import { describe, expect, it } from 'vitest';

import type { LifeEvent } from './emLife';
import { applyLifeEpisode } from './emLife';
import { xhsActivitiesFromLife, xhsActivityFromLife, xhsChatNote } from './emLifeXhs';

const AT = '2026-09-26T03:10:00.000Z';
const feed = [
    { noteId: 'n1', title: '秋天第一杯热可可', author: '小鹿', likes: 12000, video: false, xsecToken: 't1' },
    { noteId: 'n2', title: '猫咪第一次见雪', author: '橘子汽水', likes: 356, video: true },
];
const event = (life: Partial<LifeEvent['life']> = {}): LifeEvent => ({
    messageId: 'hb:x1:life',
    createdAt: AT,
    life: { kind: 'xhs', detail: '刷到一只第一次见雪的猫，笑出声。', feed, picks: [{ ...feed[1], note: '爪印好可爱' }], ...life },
});

describe('心跳逛小红书 → 小红书 App 活动记录', () => {
    it('变成一条「刷首页」活动：看过的帖子是真实首页，多看两眼的进话题', () => {
        const activity = xhsActivityFromLife(event(), 'lumi')!;
        expect(activity).toMatchObject({
            id: 'ag-hb:x1:life',
            characterId: 'lumi',
            timestamp: Date.parse(AT),
            actionType: 'browse',
            thinking: '刷到一只第一次见雪的猫，笑出声。',
            result: 'success',
            resultMessage: '自己刷了 2 条首页笔记，多看了 1 条',
        });
        expect(activity.content.notesViewed).toEqual([
            { noteId: 'n1', title: '秋天第一杯热可可', desc: '', author: '小鹿', likes: 12000 },
            { noteId: 'n2', title: '猫咪第一次见雪', desc: '', author: '橘子汽水', likes: 356 },
        ]);
        expect(activity.content.savedTopics).toEqual([{ title: '猫咪第一次见雪', desc: '爪印好可爱', noteId: 'n2' }]);
    });

    it('一条都没多看也照样记；没刷到首页或没写感想就不记', () => {
        expect(xhsActivityFromLife(event({ picks: undefined }), 'lumi')!.content.savedTopics).toBeUndefined();
        expect(xhsActivityFromLife(event({ feed: [] }), 'lumi')).toBeNull();
        expect(xhsActivityFromLife(event({ detail: '' }), 'lumi')).toBeNull();
        expect(xhsActivityFromLife({ ...event(), life: { kind: 'moment', detail: 'x' } }, 'lumi')).toBeNull();
    });

    it('私聊里那条系统消息照手动自由活动的格式', () => {
        const note = xhsChatNote(xhsActivityFromLife(event(), 'lumi')!, '露米');
        expect(note).toBe([
            '📕 露米的自由活动: 自己刷了会儿小红书首页',
            '看到的帖子: 「秋天第一杯热可可」by 小鹿、「猫咪第一次见雪」by 橘子汽水',
            '多看了两眼: 「猫咪第一次见雪」 - 爪印好可爱',
            '💭 内心想法: 刷到一只第一次见雪的猫，笑出声。',
        ].join('\n'));
    });

    it('点开、点赞、收藏、转发都记上；点开的那条另记一笔「查看详情」', () => {
        const full = event({
            picks: [{ ...feed[1], note: '爪印好可爱', liked: true, faved: true }, { ...feed[0], liked: false, error: '被风控了' }],
            opened: { noteId: 'n2', title: '猫咪第一次见雪', author: '橘子汽水', desc: '整只扑进去了', comments: 12 },
            share: { note: feed[1], text: '你看这只猫' },
        });
        const [main, detail, ...more] = xhsActivitiesFromLife(full, 'lumi');
        expect(more).toHaveLength(0);
        expect(main.resultMessage).toBe('自己刷了 2 条首页笔记，多看了 2 条、点开看了 1 条、点赞 1、收藏 1、转发给你 1 条');
        expect(detail).toMatchObject({
            id: 'ag-hb:x1:life:detail',
            content: { keyword: '查看详情: 猫咪第一次见雪' },
            resultMessage: '查看了「猫咪第一次见雪」的详情，12 条评论',
        });
        expect(detail.timestamp).toBeGreaterThan(main.timestamp);
        const note = xhsChatNote(main, '露米', full.life);
        expect(note).toContain('点开看了「猫咪第一次见雪」的正文和评论区');
        expect(note).toContain('点了赞: 「猫咪第一次见雪」');
        expect(note).toContain('收藏了: 「猫咪第一次见雪」');
        expect(note).toContain('转发给了对方: 「猫咪第一次见雪」');
        expect(xhsActivitiesFromLife(event({ opened: undefined }), 'lumi')).toHaveLength(1);
    });

    it('不进查手机', () => {
        expect(applyLifeEpisode(undefined, event())).toBeNull();
    });
});
// [EM-END: heartbeat-xhs]
