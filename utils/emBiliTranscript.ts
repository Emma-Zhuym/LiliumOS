/**
 * 聊天里发 B 站链接，角色「看过」再回（docs/ideas.md「B 站视频获取」②，2026-10-14 阿萌验收时提：
 * 发链接过去 TA 只读了标题）。
 *
 * 上游的网页分享对视频链接只拿得到标题、作者、热度（apizero 视频解析），角色被明确告知看不到视频。
 * 这里在建卡之前，经 mini 上常驻的 B 站 MCP（server/bilibili-mcp，只读）读字幕，存进卡片的
 * webpage.transcript；utils/messageFormat.ts 的 [EM: bili-transcript] 把字幕喂给角色。
 *
 * 不写死工具名：从设置里已发现的 MCP 工具清单里找「字幕」那个工具（名字或说明里带 subtitle / transcript / 字幕），
 * 参数名也从它的 inputSchema 里挑（bvid_or_url / url / bvid…）。没配 B 站 MCP、mini 不在、视频没字幕，
 * 都退回原来的样子（只有标题），并在卡片上记一句为什么。
 */
import type { ExtractedWebpage } from './webpageExtractor';
import { callMcpTool, getEnabledMcpServers, type McpServerConfig, type McpToolDef } from './mcpClient';

/** 卡片里字幕最多存这么多字（上下文里再截短） */
export const BILI_TRANSCRIPT_MAX = 8000;
const TIMEOUT_MS = 25_000;

export const isBiliUrl = (url: string): boolean => /(bilibili\.com\/video\/|b23\.tv\/|m\.bilibili\.com\/|\bBV[0-9A-Za-z]{10}\b)/i.test(url);
export const isBiliShare = (url: string, webpage?: ExtractedWebpage | null): boolean =>
  isBiliUrl(url) || webpage?.video?.platform === 'bilibili';

/** 这个角色能用的 MCP 服务器里，B 站那台的「读字幕」工具 */
export const findBiliSubtitleTool = (charId?: string): { server: McpServerConfig; tool: McpToolDef } | null => {
  for (const server of getEnabledMcpServers(charId)) {
    const tools = server.tools ?? [];
    const looksBili = /bili|哔哩|b站/i.test(`${server.url} ${server.name}`) || tools.some(tool => /bili|哔哩|b ?站/i.test(`${tool.name} ${tool.description ?? ''}`));
    if (!looksBili) continue;
    const tool = tools.find(item => /subtitle|transcript/i.test(item.name)) ?? tools.find(item => /字幕/.test(item.description ?? ''));
    if (tool) return { server, tool };
  }
  return null;
};

/** 链接该放进哪个参数：认得的名字优先，不然取第一个必填的字符串参数 */
export const subtitleArgs = (tool: McpToolDef, url: string): Record<string, string> => {
  const props: Record<string, any> = tool.inputSchema?.properties ?? {};
  const preferred = ['bvid_or_url', 'url', 'video_url', 'bvid', 'video', 'id'].find(name => name in props);
  const required: string[] = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
  const key = preferred ?? required.find(name => props[name]?.type === 'string') ?? Object.keys(props)[0] ?? 'url';
  return { [key]: url };
};

/** MCP 返回的东西收成纯文字 */
export const resultText = (data: unknown, rawText?: string): string => {
  if (typeof data === 'string') return data;
  const content = (data as any)?.content;
  if (Array.isArray(content)) return content.map((item: any) => typeof item?.text === 'string' ? item.text : '').join('\n');
  if (typeof (data as any)?.text === 'string') return (data as any).text;
  if (rawText) return rawText;
  try { return JSON.stringify(data); } catch { return ''; }
};

/** 字幕里的时间轴、序号这类不用给角色看：一行一句，去掉 [00:12] / 00:00:12,000 --> … 这种前缀 */
export const cleanTranscript = (text: string): string => text
  .split('\n')
  .map(line => line.replace(/^\s*\[?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\]?\s*(-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)?\s*/, '').trim())
  .filter(line => line && !/^\d+$/.test(line))
  .join('\n')
  .slice(0, BILI_TRANSCRIPT_MAX);

export type BiliTranscriptStatus = 'ok' | 'none' | 'unavailable' | 'failed';

/** 读字幕，存进卡片。失败不抛：卡片照常建，只是没有字幕 */
export async function attachBiliTranscript(
  webpage: ExtractedWebpage, sharedUrl: string, charId: string, toast?: (text: string, kind: 'info' | 'error') => void,
): Promise<ExtractedWebpage & { transcript?: string; transcriptStatus?: BiliTranscriptStatus }> {
  const found = findBiliSubtitleTool(charId);
  if (!found) return { ...webpage, transcriptStatus: 'unavailable' };
  toast?.('正在读 B 站字幕…', 'info');
  const url = webpage.finalUrl && isBiliUrl(webpage.finalUrl) ? webpage.finalUrl : sharedUrl;
  try {
    const result = await Promise.race([
      callMcpTool(found.server, found.tool.name, subtitleArgs(found.tool, url)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('读字幕超时')), TIMEOUT_MS)),
    ]);
    const text = result.success ? cleanTranscript(resultText(result.data, result.rawText)) : '';
    // 「该视频没有可用字幕」这类回答不算字幕
    if (!text || /没有(可用)?字幕|no subtitle|字幕不可用/i.test(text.slice(0, 80))) {
      toast?.('这个视频没有字幕，TA 只能看到标题', 'info');
      return { ...webpage, transcriptStatus: 'none' };
    }
    return { ...webpage, transcript: text, transcriptStatus: 'ok' };
  } catch (error) {
    console.warn('[bili-transcript] 读字幕失败', error);
    toast?.('B 站字幕没读到（mini 可能不在），TA 只能看到标题', 'error');
    return { ...webpage, transcriptStatus: 'failed' };
  }
}

export { transcriptForPrompt } from './emBiliTranscriptPrompt';
