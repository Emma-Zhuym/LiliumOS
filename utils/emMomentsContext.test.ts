// [EM-START: moments-heartbeat]
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import type { CharacterProfile } from '../types';
import {
    applyHeartbeatMomentReactions, buildMomentsChatInjection, formatMomentsForChat, pickUserMomentsForSnapshot, refreshMomentsCache,
    relevantMoments, resetMomentsCacheForTest,
} from './emMomentsContext';
import { buildFeed, emptyInteractions, type MomentInteractions, type UserMomentPost } from './moments';
import { MomentsDB } from './momentsDb';

const NOW = new Date(2026, 8, 29, 20, 0).getTime();
const H = 3600_000;

const char = {
    id: 'lumi',
    name: '露米',
    phoneState: {
        records: [
            { id: 'r1', type: 'social', title: '', detail: '今天加班到很晚', timestamp: NOW - 2 * H, moment: { likes: 12, comments: [{ who: '表姐', text: '辛苦啦' }] } },
            { id: 'r0', type: 'social', title: '', detail: '上周的旧动态', timestamp: NOW - 5 * 24 * H },
        ],
    },
} as unknown as CharacterProfile;

const posts: UserMomentPost[] = [
    { id: 'u1', text: '和露米一起做的红烧肉', images: ['data:image/jpeg;base64,xx'], createdAt: NOW - H },
    { id: 'u2', text: '只给别人看的', images: [], createdAt: NOW - H, visibleTo: ['other'] },
    { id: 'u3', text: '已经点过赞的', images: [], createdAt: NOW - 3 * H },
];
const inter: Record<string, MomentInteractions> = {
    u3: { postId: 'u3', likes: [{ kind: 'char', charId: 'lumi' }], comments: [] },
    u1: { postId: 'u1', likes: [], comments: [{ id: 'c1', author: { kind: 'user' }, text: '好吃', createdAt: NOW - H + 60_000 }] },
};
const interOf = (id: string) => inter[id] ?? emptyInteractions(id);

describe('聊天里看得到朋友圈', () => {
    it('只带阿萌发的（TA 看得到的）和 TA 自己发的，48 小时内', () => {
        const ids = relevantMoments(buildFeed(posts, [char]), 'lumi', NOW).map(p => p.id);
        expect(ids).toEqual(['u1', 'rec:lumi:r1', 'u3']);
    });

    it('写明谁发的、配图、评论，TA 点过赞也说出来', () => {
        const text = formatMomentsForChat(relevantMoments(buildFeed(posts, [char]), 'lumi', NOW), interOf, 'lumi', '阿萌', () => '某人', NOW);
        expect(text).toContain('阿萌发了：「和露米一起做的红烧肉」［配图 1 张］');
        expect(text).toContain('阿萌：好吃');
        expect(text).toContain('你发了：「今天加班到很晚」');
        expect(text).toContain('表姐：辛苦啦');
        expect(text).toContain('（12 个赞）');
        expect(text).toMatch(/已经点过赞的」（你点了赞）/);
    });

    it('没有相关动态就是空串', () => {
        expect(formatMomentsForChat([], interOf, 'lumi', '阿萌', () => '', NOW)).toBe('');
    });
});

describe('快照带给心跳的阿萌动态', () => {
    it('去掉 TA 回应过的和不给 TA 看的，只带文字和配图张数', () => {
        const picked = pickUserMomentsForSnapshot(posts, interOf, 'lumi', '阿萌', NOW);
        expect(picked).toEqual([{
            id: 'u1', text: '和露米一起做的红烧肉', at: new Date(NOW - H).toISOString(), images: 1,
            comments: [{ who: '阿萌', text: '好吃' }],
        }]);
    });
});

describe('心跳送回来的反应写进朋友圈', () => {
    it('点赞和评论落库；同一条信箱消息再写一遍不重复；删掉的动态跳过', async () => {
        await MomentsDB.savePost(posts[0]);
        const reactions = [{ postId: 'u1', like: true, comment: '下次还要吃' }, { postId: 'gone', like: true }];
        expect(await applyHeartbeatMomentReactions('lumi', 'hb:1:moments', reactions, NOW)).toBe(1);
        expect(await applyHeartbeatMomentReactions('lumi', 'hb:1:moments', reactions, NOW)).toBe(1);
        const saved = (await MomentsDB.getInteractions()).find(i => i.postId === 'u1')!;
        expect(saved.likes).toEqual([{ kind: 'char', charId: 'lumi' }]);
        expect(saved.comments.map(c => c.text)).toEqual(['下次还要吃']);
    });

    it('聊天读的是内存副本：没加载过就不带，刷新后带上刚落库的评论', async () => {
        await new Promise(resolve => setTimeout(resolve, 50)); // 上一条落库后顺手的刷新先跑完
        resetMomentsCacheForTest();
        const bare = { ...char, phoneState: { records: [] } } as unknown as CharacterProfile;
        expect(buildMomentsChatInjection(bare, '阿萌', NOW)).toBe('');
        await refreshMomentsCache([{ id: 'lumi', name: '露米' }]);
        const text = buildMomentsChatInjection(char, '阿萌', NOW);
        expect(text).toContain('和露米一起做的红烧肉');
        expect(text).toContain('你：下次还要吃');
        expect(text).toContain('（你点了赞）');
    });
});
// [EM-END: moments-heartbeat]
