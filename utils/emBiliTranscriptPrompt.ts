/**
 * B 站分享卡片里的字幕怎么写给角色看（utils/emBiliTranscript.ts 读来、存在 webpage.transcript）。
 * 单独一个不带依赖的文件：utils/messageFormat.ts 也会被打进 worker，不能连带拉进 MCP 客户端。
 */
export const transcriptForPrompt = (meta: { transcript?: unknown }, maxChars = 3000): string | null => {
  if (typeof meta.transcript !== 'string' || !meta.transcript.trim()) return null;
  const text = meta.transcript.trim();
  const body = text.length > maxChars ? `${text.slice(0, maxChars)}…（字幕太长，后面截掉了）` : text;
  return `视频字幕：\n${body}\n（注：你读过这个视频的字幕，知道它讲了什么；画面你没看到，别描述画面细节。）`;
};
