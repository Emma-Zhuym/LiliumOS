// [EM-START: moments]
import { describe, expect, it } from 'vitest';

import type { CharacterProfile, PhoneContact, PhoneEvidence } from '../types';
import {
    USER, addComment, applyLookReactions, buildFeed, canSee, charActor, collectLookItems, emptyInteractions,
    allComments, formatMomentTime, likeCount, normalizeMomentExtras, parseLookReactions, relationOf, toggleLike,
    type MomentInteractions, type UserMomentPost,
} from './moments';
import { buildLookMessages } from './momentsLook';

const NOW = new Date(2026, 8, 24, 20, 0).getTime();
const H = 3_600_000;

const social = (id: string, detail: string, timestamp: number): PhoneEvidence => ({ id, type: 'social', title: '', detail, timestamp });
const contact = (o: Partial<PhoneContact>): PhoneContact => ({ id: 'k', name: 'x', kind: 'real', affinity: 0, status: 'friend', createdAt: 0, ...o });
const char = (id: string, name: string, records: PhoneEvidence[] = [], contacts: PhoneContact[] = []) =>
    ({ id, name, description: `${name}的设定`, phoneState: { records, contacts } } as unknown as CharacterProfile);

const a = char('a', '沈砚', [social('r1', '加班到现在', NOW - 2 * H), { id: 'o1', type: 'order', title: '键盘', detail: '', timestamp: NOW }]),
    b = char('b', '陆离', [social('r2', '猫又把花盆推下去了', NOW - H)], [contact({ linkedCharId: 'a', identity: '大学室友' })]);
const mine: UserMomentPost = { id: 'u1', text: '今天的晚霞', images: ['data:image/jpeg;base64,xx'], createdAt: NOW - 0.5 * H };

describe('buildFeed · 汇总', () => {
    it('用户的动态 + 各角色查手机里的朋友圈，最新的在前；别的类型不算', () => {
        const feed = buildFeed([mine], [a, b]);
        expect(feed.map(p => p.id)).toEqual(['u1', 'rec:b:r2', 'rec:a:r1']);
        expect(feed[2]).toMatchObject({ author: { kind: 'char', charId: 'a' }, text: '加班到现在' });
    });
});

describe('可见性与关系', () => {
    it('用户的动态可以只给部分人看；不选就是公开；角色的对所有人公开', () => {
        const [u, r2] = buildFeed([{ ...mine, visibleTo: ['b'] }], [b]);
        expect(canSee(u, 'b')).toBe(true);
        expect(canSee(u, 'a')).toBe(false);
        expect(canSee(r2, 'a')).toBe(true);
        expect(canSee(buildFeed([mine], [])[0], 'a')).toBe(true);
    });

    it('通讯录里关联了就按关系叫，否则是网友', () => {
        expect(relationOf(b, charActor('a'), [a, b])).toBe('大学室友');
        expect(relationOf(a, charActor('b'), [a, b])).toBe('网友');
        expect(relationOf(char('c', 'c', [], [contact({ linkedCharId: 'a', status: 'blocked' })]), charActor('a'), [a])).toBe('网友');
    });
});

describe('点赞评论', () => {
    it('点赞再点一次就取消', () => {
        const once = toggleLike(emptyInteractions('u1'), USER);
        expect(once.likes).toEqual([USER]);
        expect(toggleLike(once, USER).likes).toEqual([]);
    });
});

describe('刷朋友圈', () => {
    const feed = buildFeed([mine], [a, b]);
    const store: Record<string, MomentInteractions> = {};
    const interOf = (id: string) => store[id] ?? emptyInteractions(id);

    it('看新动态（不看自己的），用户的排最前；自己动态下的新评论也要看', () => {
        store['rec:a:r1'] = addComment(emptyInteractions('rec:a:r1'), { id: 'c1', author: USER, text: '早点睡', createdAt: NOW - 0.2 * H });
        const items = collectLookItems('a', feed, interOf, NOW - 3 * H);
        expect(items.map(i => [i.ref, i.post.id, i.why])).toEqual([
            ['#1', 'u1', 'new_post'], ['#2', 'rec:b:r2', 'new_post'], ['#3', 'rec:a:r1', 'comment_on_mine'],
        ]);
    });

    it('看不到的、上次看过之前的、已经互动过的都不再给', () => {
        const hidden = buildFeed([{ ...mine, visibleTo: ['b'] }], [a, b]);
        expect(collectLookItems('a', hidden, interOf, NOW - 3 * H).map(i => i.post.id)).not.toContain('u1');
        expect(collectLookItems('a', feed, interOf, NOW - 0.1 * H)).toEqual([]);
    });

    it('反应落地：点赞 + 评论；在自己动态下说话就是回复刚才评论的人', () => {
        const items = collectLookItems('a', feed, interOf, NOW - 3 * H);
        const reactions = parseLookReactions({ reactions: [
            { ref: '#1', like: true, comment: '好看' }, { ref: '3', comment: '知道啦' }, { ref: '#9', like: true }, { ref: '#2' },
        ] }, items.map(i => i.ref));
        expect(reactions).toEqual([{ ref: '#1', like: true, comment: '好看' }, { ref: '#3', comment: '知道啦' }]);
        const changed = applyLookReactions('a', items, reactions, interOf, NOW);
        expect(changed[0].likes).toEqual([charActor('a')]);
        expect(changed[0].comments[0]).toMatchObject({ author: charActor('a'), text: '好看' });
        expect(changed[1].comments[1]).toMatchObject({ author: charActor('a'), text: '知道啦', replyTo: USER });
    });

    it('别人回复了我在别人动态下的评论，也要让我看到', () => {
        const local: Record<string, MomentInteractions> = {
            'rec:b:r2': {
                postId: 'rec:b:r2', likes: [],
                comments: [
                    { id: 'x1', author: charActor('a'), text: '哈哈', createdAt: NOW - 0.9 * H },
                    { id: 'x2', author: USER, text: '你也养猫？', createdAt: NOW - 0.3 * H, replyTo: charActor('a') },
                ],
            },
        };
        const items = collectLookItems('a', feed, id => local[id] ?? emptyInteractions(id), NOW - 0.5 * H);
        expect(items.map(i => [i.post.id, i.why])).toEqual([['rec:b:r2', 'reply_to_me']]);
    });

    it('提示词：带上关系、已有评论和用户的图', () => {
        const items = collectLookItems('b', feed, interOf, NOW - 3 * H);
        const [system, user] = buildLookMessages(b, items, interOf, [a, b], '阿萌');
        expect(String(system.content)).toContain('你是陆离');
        const parts = user.content as { type: string; text?: string; image_url?: { url: string } }[];
        expect(parts[0].text).toContain('阿萌（对方，也就是和你聊天的那个人）发了');
        expect(parts[0].text).toContain('沈砚（大学室友）发了');
        expect(parts[0].text).toContain('已有评论：\n  - 阿萌：早点睡');
        expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xx' } });
    });
});

describe('亲友评论（和动态一起生成）', () => {
    const family = contact({ name: '妈妈', kind: 'npc', identity: '妈妈', group: 'family' });
    const boss = contact({ name: '王总', kind: 'npc', identity: '领导', group: 'work' });
    const rec: PhoneEvidence = {
        ...social('r9', '今晚又加班', NOW - H),
        moment: { likes: 21, hide: ['family'], comments: [{ who: '王总', relation: '领导', text: '辛苦' }, { who: '妈妈', text: '早点回家' }] },
    };
    const c = char('c', '顾南', [rec], [family, boss]);

    it('显示时：被屏蔽分组的亲友评论挡掉；虚拟赞数加在真实点赞上', () => {
        const [post] = buildFeed([], [c]);
        expect(post.npcComments.map(x => [x.author, x.text])).toEqual([[{ kind: 'npc', name: '王总', relation: '领导' }, '辛苦']]);
        const inter = toggleLike(emptyInteractions(post.id), USER);
        expect(likeCount(post, inter)).toBe(22);
    });

    it('用户回复亲友：亲友不接话，但角色刷朋友圈时能看到', () => {
        const [post] = buildFeed([], [c]);
        const inter = addComment(emptyInteractions(post.id), { id: 'u', author: USER, text: '王总好', createdAt: NOW, replyTo: { kind: 'npc', name: '王总' } });
        expect(allComments(post, inter).map(x => x.text)).toEqual(['辛苦', '王总好']);
        const items = collectLookItems('c', [post], () => inter, NOW - 1);
        expect(items[0]).toMatchObject({ why: 'comment_on_mine' });
        expect(items[0].comments.map(x => x.text)).toEqual(['王总好']);
    });

    it('normalizeMomentExtras：只收合法字段，最多 5 条', () => {
        expect(normalizeMomentExtras({
            comments: [...Array(7)].map((_, i) => ({ who: `人${i}`, text: 'hi' })).concat([{ who: '', text: 'x' } as never]),
            likes: '12', hide: ['family', 'boss', 'family'],
        })).toEqual({ comments: [...Array(5)].map((_, i) => ({ who: `人${i}`, text: 'hi' })), likes: 12, hide: ['family'] });
        expect(normalizeMomentExtras({ title: 'x' })).toBeUndefined();
    });
});

describe('formatMomentTime', () => {
    it('今天 / 昨天 / 今年 / 往年', () => {
        expect(formatMomentTime(new Date(2026, 8, 24, 9, 5).getTime(), NOW)).toBe('今天 9:05');
        expect(formatMomentTime(new Date(2026, 8, 23, 23, 30).getTime(), NOW)).toBe('昨天 23:30');
        expect(formatMomentTime(new Date(2026, 0, 3, 8, 0).getTime(), NOW)).toBe('1月3日 8:00');
        expect(formatMomentTime(new Date(2025, 11, 31, 8, 0).getTime(), NOW)).toBe('2025年12月31日 8:00');
    });
});
// [EM-END: moments]
