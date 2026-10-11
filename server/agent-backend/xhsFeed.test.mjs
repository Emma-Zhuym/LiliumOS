/**
 * 心跳「逛小红书」：首页解析与模型挑选的落地。数据形状照上游 xiaohongshu-mcp v2.5 的 list_feeds。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyXhsActions, fetchDetail, fetchFeed, formatDetailForPrompt, formatFeedForPrompt, guardXhs, parseCount, parseDetail, parseFeed, resolvePicks, resolveShare,
} from './xhsFeed.mjs';
import { feedResult } from './xhsFeed.fixture.mjs';


test('赞数：万 / k / 加号 / 逗号都认，认不出是 0', () => {
    assert.equal(parseCount('1.2万'), 12_000);
    assert.equal(parseCount('10万+'), 100_000);
    assert.equal(parseCount('2.5k'), 2_500);
    assert.equal(parseCount('1,234'), 1_234);
    assert.equal(parseCount('赞'), 0);
    assert.equal(parseCount(undefined), 0);
});

test('首页解析：只留有标题有 id 的笔记，直播卡和重复的丢掉', () => {
    const notes = parseFeed(feedResult());
    assert.deepEqual(notes, [
        { noteId: 'n1', title: '秋天第一杯热可可', author: '小鹿', likes: 12_000, video: false, xsecToken: 'tok1' },
        { noteId: 'n2', title: '猫咪第一次见雪', author: '橘子汽水', likes: 356, video: true, xsecToken: 'tok2' },
    ]);
    // 多包一层、或者工具报错、或者正文不是 JSON，都不炸
    assert.equal(parseFeed({ content: [{ type: 'text', text: JSON.stringify({ data: { feeds: [{ id: 'x', noteCard: { displayTitle: 't' } }] } }) }] }).length, 1);
    assert.deepEqual(parseFeed({ isError: true, content: [{ type: 'text', text: '获取Feeds列表失败' }] }), []);
    assert.deepEqual(parseFeed({ content: [{ type: 'text', text: '未登录' }] }), []);
});

test('刷首页：没配、报错、空首页都给原因，不抛', async () => {
    assert.deepEqual(await fetchFeed(null), { notes: [], error: 'xhs_not_configured' });
    const broken = { callTool: async () => { throw new Error('连不上 MCP 服务'); } };
    assert.match((await fetchFeed(broken)).error, /连不上/);
    const empty = { callTool: async () => feedResult([]) };
    assert.equal((await fetchFeed(empty)).error, 'xhs_empty_feed');
    const ok = { callTool: async (name, args, opts) => { assert.equal(name, 'list_feeds'); assert.ok(opts.timeoutMs > 25_000); return feedResult(); } };
    assert.equal((await fetchFeed(ok)).notes.length, 2);
});

test('给模型看的是编号 + 标题 + 作者 + 赞数，不给 id', () => {
    const text = formatFeedForPrompt(parseFeed(feedResult()));
    assert.equal(text, '1. 「秋天第一杯热可可」 — 小鹿，12000 赞\n2. 「猫咪第一次见雪」（视频） — 橘子汽水，356 赞');
    assert.ok(!text.includes('n1'));
});

test('模型挑的编号换回真实笔记：越界、重复的丢掉，标题作者不信模型', () => {
    const notes = parseFeed(feedResult());
    const picks = resolvePicks([{ index: 2, note: '雪地里的小爪印好可爱' }, { index: 2 }, { index: 9 }, { index: 0 }, { index: 1 }], notes);
    assert.deepEqual(picks.map(p => [p.noteId, p.title, p.note]), [['n2', '猫咪第一次见雪', '雪地里的小爪印好可爱'], ['n1', '秋天第一杯热可可', undefined]]);
});

test('白名单：心跳只准刷首页、看详情、点赞、收藏；发帖评论删登录一律叫不动', async () => {
    const calls = [];
    const guarded = guardXhs({ callTool: async name => { calls.push(name); return {}; } });
    for (const name of ['list_feeds', 'get_feed_detail', 'like_feed', 'favorite_feed']) await guarded.callTool(name, {});
    for (const name of ['publish_content', 'post_comment_to_feed', 'reply_comment_in_feed', 'delete_cookies', 'search_feeds']) {
        await assert.rejects(guarded.callTool(name, {}), /不允许/);
    }
    assert.deepEqual(calls, ['list_feeds', 'get_feed_detail', 'like_feed', 'favorite_feed']);
    assert.equal(guardXhs(null), null);
});

test('详情：正文截一段、评论只留有字的，包在 data 里也认得', () => {
    const wrap = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
    const detail = parseDetail(wrap({ data: { note: { title: '标题', desc: '正'.repeat(900), ipLocation: '上海' }, comments: { list: [
        { content: '好看', likeCount: '12', userInfo: { nickname: 'A' } },
        { content: '', userInfo: { nickname: 'B' } },
        { content: '同款', userInfo: {} },
    ] } } }));
    assert.equal(detail.desc.length, 600);
    assert.equal(detail.location, '上海');
    assert.deepEqual(detail.comments, [{ author: 'A', text: '好看', likes: 12 }, { author: '匿名', text: '同款', likes: 0 }]);
    assert.equal(parseDetail(wrap({ feeds: [] })), null);
    assert.equal(parseDetail({ isError: true, content: [{ type: 'text', text: '失败' }] }), null);
    const text = formatDetailForPrompt(3, { title: '短标题', author: '小鹿' }, { fullTitle: '完整标题', desc: '', comments: [] });
    assert.equal(text, '你点开了第 3 条「完整标题」（小鹿）：\n正文：（只有图 / 视频，没什么字）\n评论区：还没人评论。');
});

test('点开：没 token 不点，工具失败给原因', async () => {
    assert.deepEqual(await fetchDetail({ callTool: async () => ({}) }, { noteId: 'n1' }), { error: 'xhs_no_token' });
    const broken = { callTool: async () => { throw new Error('笔记不可访问'); } };
    assert.match((await fetchDetail(broken, { noteId: 'n1', xsecToken: 't' })).error, /不可访问/);
});

test('转发：编号和配的话缺一不可', () => {
    const notes = parseFeed(feedResult());
    assert.deepEqual(resolveShare({ index: 1, text: ' 看这个 ' }, notes), { note: notes[0], text: '看这个' });
    assert.equal(resolveShare({ index: 1, text: '' }, notes), null);
    assert.equal(resolveShare({ index: 5, text: 'x' }, notes), null);
    assert.equal(resolveShare(undefined, notes), null);
});

test('点赞收藏：一跳最多两次，没 token 的不点，失败只记原因', async () => {
    const calls = [];
    const xhs = { callTool: async (name, args) => {
        calls.push(`${name}:${args.feed_id}`);
        if (args.feed_id === 'bad') throw new Error('被风控了');
        return { content: [] };
    } };
    const picks = [
        { noteId: 'bad', title: 'a', xsecToken: 't', wantLike: true },
        { noteId: 'n1', title: 'b', xsecToken: 't', wantLike: true, wantFav: true },
        { noteId: 'n2', title: 'c', wantLike: true },
    ];
    const done = await applyXhsActions(xhs, picks);
    assert.deepEqual(calls, ['like_feed:bad', 'like_feed:n1']);
    assert.deepEqual(done, [
        { noteId: 'bad', title: 'a', xsecToken: 't', error: '被风控了' },
        { noteId: 'n1', title: 'b', xsecToken: 't', liked: true },
        { noteId: 'n2', title: 'c' },
    ]);
});
