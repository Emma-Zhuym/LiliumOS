/**
 * 心跳「逛小红书」：首页解析与模型挑选的落地。数据形状照上游 xiaohongshu-mcp v2.5 的 list_feeds。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchFeed, formatFeedForPrompt, parseCount, parseFeed, resolvePicks } from './xhsFeed.mjs';
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
