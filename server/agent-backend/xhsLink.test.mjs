import test from 'node:test';
import assert from 'node:assert/strict';
import { expandXhsShortLink } from './xhsLink.mjs';

const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });
const NOTE = 'https://www.xiaohongshu.com/discovery/item/0123456789abcdef01234567?xsec_token=abc';

test('只跟 xhslink 自己的跳转，跳出去就交回', async () => {
    const seen = [];
    const fetchImpl = async url => {
        seen.push(url);
        return seen.length === 1 ? redirect('https://xhslink.cn/o/next') : redirect(NOTE);
    };
    assert.deepEqual(await expandXhsShortLink('https://xhslink.cn/o/abc', { fetchImpl }), { finalUrl: NOTE });
    assert.deepEqual(seen, ['https://xhslink.cn/o/abc', 'https://xhslink.cn/o/next']);
});

test('卡住的那一次重试', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls++;
        if (calls === 1) throw new Error('timeout');
        return redirect(NOTE);
    };
    assert.equal((await expandXhsShortLink('http://xhslink.com/a/x', { fetchImpl })).finalUrl, NOTE);
    assert.equal(calls, 2);
});

test('不是 xhslink 的一律不碰', async () => {
    const fetchImpl = async () => { throw new Error('should not fetch'); };
    for (const url of ['http://127.0.0.1/x', 'https://xhslink.cn.evil.com/o/x', 'file:///etc/passwd', '']) {
        await assert.rejects(expandXhsShortLink(url, { fetchImpl }), /短链/);
    }
});

test('一直失败就报展开失败', async () => {
    const fetchImpl = async () => new Response('nope', { status: 200 });
    await assert.rejects(expandXhsShortLink('https://xhslink.cn/o/x', { fetchImpl, attempts: 2 }), /短链展开失败/);
});
