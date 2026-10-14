import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XhsMcpClient } from './xhsMcpClient';
import {
    resetXhsShareDetailStateForTests,
    resolveXhsShareTarget,
} from './xhsShareDetail';

const NOTE_ID = '6858ccaa0000000013013c94';
const SERVER = 'https://xhs.example.test/api';
const NOTE_URL = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=token&xsec_source=pc_share`;

describe('小红书分享目标预解析', () => {
    beforeEach(() => resetXhsShareDetailStateForTests());

    it('完整链接不访问短链服务，并正确解码 token', async () => {
        const expand = vi.fn();
        await expect(resolveXhsShareTarget(
            `看看这个 https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=test%2Btoken%3D`,
            expand,
        )).resolves.toEqual({ noteId: NOTE_ID, xsecToken: 'test+token=' });
        expect(expand).not.toHaveBeenCalled();
    });

    it('同一短链的预读和发送共用一次展开', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const expand = vi.fn(async () => {
            await gate;
            return `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=shared`;
        });
        const text = '标题 https://xhslink.cn/o/AbC123 打开【小红书】';

        const first = resolveXhsShareTarget(text, expand);
        const second = resolveXhsShareTarget(text, expand);
        release();

        await expect(Promise.all([first, second])).resolves.toEqual([
            { noteId: NOTE_ID, xsecToken: 'shared' },
            { noteId: NOTE_ID, xsecToken: 'shared' },
        ]);
        expect(expand).toHaveBeenCalledTimes(1);
    });
});

describe('小红书详情在途去重与短时缓存', () => {
    beforeEach(() => XhsMcpClient.clearDetailCache());
    afterEach(() => vi.restoreAllMocks());

    it('同一篇笔记并发读取时只发一个请求，完成后继续命中缓存', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            await gate;
            return new Response(JSON.stringify({ data: { note: { noteId: NOTE_ID, title: '标题' } } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        const first = XhsMcpClient.getNoteDetail(SERVER, NOTE_URL, 'token');
        const second = XhsMcpClient.getNoteDetail(SERVER, NOTE_URL, 'token');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        release();

        const [a, b] = await Promise.all([first, second]);
        expect(a).toEqual(b);
        await expect(XhsMcpClient.getNoteDetail(SERVER, NOTE_URL, 'another-token')).resolves.toEqual(a);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('失败结果不缓存，下一次能够重试', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));

        const first = await XhsMcpClient.getNoteDetail(SERVER, NOTE_URL, 'token');
        const second = await XhsMcpClient.getNoteDetail(SERVER, NOTE_URL, 'token');

        expect(first.success).toBe(false);
        expect(second.success).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
