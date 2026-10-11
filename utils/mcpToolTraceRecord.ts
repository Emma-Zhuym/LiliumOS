/**
 * 聊天里的 MCP 调用记录。
 *
 * 这里只保存「用户已经允许角色调用的工具」的可读快照，不保存服务器 URL、请求头、
 * Bearer Token 等连接配置。参数和结果仍可能由第三方工具返回敏感字段，因此落库前
 * 还要按字段名和常见凭据形态做一次打码，并限制体积。
 */

export type McpToolCallSource = 'native' | 'text_fallback';

export interface McpToolCallRecord {
  id: string;
  serverName: string;
  toolName: string;
  exposedName: string;
  status: 'success' | 'error';
  source: McpToolCallSource;
  arguments: unknown;
  result?: unknown;
  error?: string;
  startedAt: number;
  durationMs: number;
}

export interface McpToolTraceRecord {
  version: 1;
  runId: string;
  records: McpToolCallRecord[];
}

const SENSITIVE_KEY_RE = /(?:^|[_-])(authorization|api[_-]?key|access[_-]?key|secret|password|passwd|token|cookie|session[_-]?id|proxy[_-]?key|signature)(?:$|[_-])/i;
const MAX_STRING_CHARS = 2_000;
const MAX_ARRAY_ITEMS = 24;
const MAX_OBJECT_KEYS = 32;
const MAX_DEPTH = 5;

const redactString = (value: string): string => {
  const redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/([?&](?:token|api[_-]?key|key|secret|password|signature)=)[^&#\s]+/gi, '$1[已隐藏]');
  return redacted.length > MAX_STRING_CHARS
    ? `${redacted.slice(0, MAX_STRING_CHARS)}…[内容过长已截断]`
    : redacted;
};

/** 把任意工具参数/结果变成可安全落库与展示的 JSON 形状。 */
export const sanitizeMcpTraceValue = (value: unknown): unknown => {
  const seen = new WeakSet<object>();

  const visit = (input: unknown, depth: number): unknown => {
    if (input == null || typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'string') return redactString(input);
    if (typeof input === 'bigint') return input.toString();
    if (typeof input !== 'object') return String(input);
    if (depth >= MAX_DEPTH) return '[层级过深，已收起]';
    if (seen.has(input as object)) return '[循环引用]';
    seen.add(input as object);

    if (Array.isArray(input)) {
      const kept = input.slice(0, MAX_ARRAY_ITEMS).map(item => visit(item, depth + 1));
      if (input.length > MAX_ARRAY_ITEMS) kept.push(`…另有 ${input.length - MAX_ARRAY_ITEMS} 项`);
      return kept;
    }

    const entries = Object.entries(input as Record<string, unknown>);
    const output: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
      output[key] = SENSITIVE_KEY_RE.test(key) ? '[已隐藏]' : visit(item, depth + 1);
    }
    if (entries.length > MAX_OBJECT_KEYS) output['…'] = `另有 ${entries.length - MAX_OBJECT_KEYS} 个字段`;
    return output;
  };

  return visit(value, 0);
};

const compactTraceValue = (value: unknown, maxChars: number): unknown => {
  const sanitized = sanitizeMcpTraceValue(value);
  try {
    const serialized = JSON.stringify(sanitized);
    return serialized.length > maxChars
      ? `${serialized.slice(0, maxChars)}…[记录过长已截断]`
      : sanitized;
  } catch {
    return redactString(String(value));
  }
};

export const createMcpToolCallRecord = (input: {
  id: string;
  serverName: string;
  toolName: string;
  exposedName: string;
  source: McpToolCallSource;
  args: unknown;
  result: { success: boolean; data?: unknown; error?: unknown };
  startedAt: number;
  finishedAt?: number;
}): McpToolCallRecord => {
  const finishedAt = input.finishedAt ?? Date.now();
  const success = input.result.success === true;
  return {
    id: input.id,
    serverName: redactString(input.serverName || 'MCP'),
    toolName: redactString(input.toolName || input.exposedName || 'unknown_tool'),
    exposedName: redactString(input.exposedName || input.toolName || 'unknown_tool'),
    status: success ? 'success' : 'error',
    source: input.source,
    arguments: compactTraceValue(input.args ?? {}, 4_000),
    ...(success
      ? { result: compactTraceValue(input.result.data, 8_000) }
      : { error: redactString(String(input.result.error || '工具执行失败')) }),
    startedAt: input.startedAt,
    durationMs: Math.max(0, finishedAt - input.startedAt),
  };
};

/** 渲染端的窄校验：历史坏数据或第三方导入不能把卡片渲染炸掉。 */
export const readMcpToolTraceRecord = (raw: unknown): McpToolTraceRecord | null => {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<McpToolTraceRecord>;
  if (candidate.version !== 1 || typeof candidate.runId !== 'string' || !Array.isArray(candidate.records)) return null;
  const records = candidate.records.filter((record): record is McpToolCallRecord => {
    if (!record || typeof record !== 'object') return false;
    const item = record as Partial<McpToolCallRecord>;
    return typeof item.id === 'string'
      && typeof item.serverName === 'string'
      && typeof item.toolName === 'string'
      && typeof item.exposedName === 'string'
      && (item.source === 'native' || item.source === 'text_fallback')
      && (item.status === 'success' || item.status === 'error');
  });
  return records.length ? { version: 1, runId: candidate.runId, records } : null;
};
