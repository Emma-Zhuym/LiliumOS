import { beforeEach, describe, expect, it, vi } from 'vitest';

const servers: any[] = [];
const call = vi.fn();
vi.mock('./mcpClient', () => ({
  getEnabledMcpServers: () => servers,
  callMcpTool: (...args: unknown[]) => call(...args),
}));

import { attachBiliTranscript, cleanTranscript, findBiliSubtitleTool, isBiliShare, resultText, subtitleArgs } from './emBiliTranscript';
import { transcriptForPrompt } from './emBiliTranscriptPrompt';
import { normalizeMessageContent } from './messageFormat';

const bili = {
  id: 'bili', name: 'B 站', url: 'https://node.example.ts.net/bili/mcp', enabled: true,
  tools: [
    { name: 'get_video_info', description: '读 B 站视频信息', inputSchema: { properties: { bvid_or_url: { type: 'string' } } } },
    { name: 'get_video_subtitles', description: '读字幕', inputSchema: { properties: { bvid_or_url: { type: 'string' }, lang: { type: 'string' } }, required: ['bvid_or_url'] } },
  ],
};
const page = { url: 'https://b23.tv/abc', title: '十分钟学会糖醋排骨', content: '', excerpt: '', truncated: false, fetchedAt: 0, video: { platform: 'bilibili', platformLabel: '哔哩哔哩' } };

beforeEach(() => { servers.length = 0; call.mockReset(); });

describe('B 站链接读字幕', () => {
  it('认得 B 站链接；找得到字幕工具、参数名照工具说明来', () => {
    expect(isBiliShare('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    expect(isBiliShare('https://b23.tv/abc')).toBe(true);
    expect(isBiliShare('https://example.com', page)).toBe(true);
    expect(isBiliShare('https://www.douyin.com/video/1')).toBe(false);
    expect(findBiliSubtitleTool('c1')).toBeNull();
    servers.push({ id: 'ha', name: '家里', url: 'https://ha/mcp', enabled: true, tools: [{ name: 'get_subtitles_for_tv' }] }, bili);
    expect(findBiliSubtitleTool('c1')?.tool.name).toBe('get_video_subtitles');
    expect(subtitleArgs(bili.tools[1] as any, 'https://b23.tv/abc')).toEqual({ bvid_or_url: 'https://b23.tv/abc' });
    expect(subtitleArgs({ name: 'x', inputSchema: { properties: { link: { type: 'string' } }, required: ['link'] } }, 'u')).toEqual({ link: 'u' });
  });
  it('MCP 回来的东西收成一行一句，去掉时间轴和序号', () => {
    expect(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb');
    expect(cleanTranscript('1\n00:00:01,000 --> 00:00:03,000\n先把排骨焯水\n[00:12] 再煎到金黄\n\n')).toBe('先把排骨焯水\n再煎到金黄');
  });
  it('读到字幕存进卡片；角色读到的是字幕、不再说看不到视频', async () => {
    servers.push(bili);
    call.mockResolvedValue({ success: true, data: { content: [{ type: 'text', text: '[00:01] 先把排骨焯水\n[00:05] 糖醋汁一比二比三' }] } });
    const card = await attachBiliTranscript(page as any, 'https://b23.tv/abc', 'c1');
    expect(call).toHaveBeenCalledWith(bili, 'get_video_subtitles', { bvid_or_url: 'https://b23.tv/abc' });
    expect(card).toMatchObject({ transcript: '先把排骨焯水\n糖醋汁一比二比三', transcriptStatus: 'ok' });
    const text = normalizeMessageContent({ type: 'webpage_card', role: 'user', content: page.title, metadata: { webpage: card } } as any, 'TA', '阿萌');
    expect(text).toContain('视频字幕：\n先把排骨焯水');
    expect(text).not.toContain('看不到视频画面和声音');
    expect(transcriptForPrompt({ transcript: 'x'.repeat(10) }, 4)).toContain('后面截掉了');
  });
  it('没字幕、mini 不在、没配 B 站 MCP：卡片照常，只是没有字幕', async () => {
    expect((await attachBiliTranscript(page as any, 'u', 'c1')).transcriptStatus).toBe('unavailable');
    servers.push(bili);
    call.mockResolvedValueOnce({ success: true, data: '该视频没有可用字幕' });
    expect((await attachBiliTranscript(page as any, 'u', 'c1')).transcriptStatus).toBe('none');
    call.mockRejectedValueOnce(new Error('502'));
    const failed = await attachBiliTranscript(page as any, 'u', 'c1');
    expect(failed).toMatchObject({ transcriptStatus: 'failed', title: page.title });
    const text = normalizeMessageContent({ type: 'webpage_card', role: 'user', content: page.title, metadata: { webpage: failed } } as any, 'TA', '阿萌');
    expect(text).toContain('看不到视频画面和声音');
  });
});
