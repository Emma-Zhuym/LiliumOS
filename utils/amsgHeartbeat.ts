/**
 * Active Message 2.0 的滚动心跳协议。
 *
 * 这份文件同时被浏览器与 Cloudflare Worker 引用，只能放纯函数和常量，不能读取
 * localStorage / IndexedDB / DOM。心跳本身是一串一次性任务：当前这一跳触发时，
 * Worker 先用确定性 uuid 排好下一跳，再决定这次要不要生成、要不要推送。
 */

import type { ActiveMsg2HeartbeatChatPolicy } from '../types';

export const AMSG_HEARTBEAT_SUBTYPE = 'heartbeat';
export const AMSG_HEARTBEAT_CONTROL_KEY = 'heartbeat_control';

/** 模型明确选择安静时返回的唯一标记；Worker 会剥掉它，不会送成聊天消息。 */
export const AMSG_HEARTBEAT_NOOP = '[[HEARTBEAT_NOOP]]';

export const HEARTBEAT_INTERVAL_OPTIONS = [30, 60, 120, 240] as const;
export type HeartbeatIntervalMinutes = typeof HEARTBEAT_INTERVAL_OPTIONS[number];
export const DEFAULT_HEARTBEAT_INTERVAL_MINUTES: HeartbeatIntervalMinutes = 60;
export const HEARTBEAT_FIRST_WAKE_DELAY_MS = 3 * 60_000;
export const DEFAULT_HEARTBEAT_ACTIVE_CHAT_POLICY: ActiveMsg2HeartbeatChatPolicy = 'skip';

export const normalizeHeartbeatActiveChatPolicy = (
  value: unknown,
): ActiveMsg2HeartbeatChatPolicy => value === 'merge' ? 'merge' : DEFAULT_HEARTBEAT_ACTIVE_CHAT_POLICY;

export const normalizeHeartbeatInterval = (value: unknown): HeartbeatIntervalMinutes => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  return HEARTBEAT_INTERVAL_OPTIONS.includes(numeric as HeartbeatIntervalMinutes)
    ? numeric as HeartbeatIntervalMinutes
    : DEFAULT_HEARTBEAT_INTERVAL_MINUTES;
};

/**
 * 自然时间波动：约为所选间隔的 10%，但短周期至少前后 5 分钟，长周期最多前后 20 分钟。
 * 30/60/120/240 分钟分别得到 ±5/6/12/20 分钟。
 */
export const heartbeatJitterWindowMinutes = (intervalMinutes: unknown): number =>
  Math.min(20, Math.max(5, Math.round(normalizeHeartbeatInterval(intervalMinutes) * 0.1)));

export const isHeartbeatMetadata = (metadata: unknown): boolean =>
  Boolean(metadata && typeof metadata === 'object'
    && (metadata as Record<string, unknown>).amsgHeartbeat === true);

export interface AmsgHeartbeatControl {
  v: 1;
  enabled: boolean;
  intervalMinutes: HeartbeatIntervalMinutes;
  activeChatPolicy: ActiveMsg2HeartbeatChatPolicy;
  generation: string;
  updatedAt: number;
}

export const buildHeartbeatControl = (input: {
  enabled: boolean;
  intervalMinutes: unknown;
  activeChatPolicy?: unknown;
  generation: string;
  updatedAt?: number;
}): AmsgHeartbeatControl => ({
  v: 1,
  enabled: input.enabled,
  intervalMinutes: normalizeHeartbeatInterval(input.intervalMinutes),
  activeChatPolicy: normalizeHeartbeatActiveChatPolicy(input.activeChatPolicy),
  generation: input.generation,
  updatedAt: input.updatedAt ?? Date.now(),
});

export const parseHeartbeatControl = (value: string | null | undefined): AmsgHeartbeatControl | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AmsgHeartbeatControl>;
    if (parsed.v !== 1 || typeof parsed.enabled !== 'boolean'
      || typeof parsed.generation !== 'string' || !parsed.generation) return null;
    return {
      v: 1,
      enabled: parsed.enabled,
      intervalMinutes: normalizeHeartbeatInterval(parsed.intervalMinutes),
      activeChatPolicy: normalizeHeartbeatActiveChatPolicy(parsed.activeChatPolicy),
      generation: parsed.generation,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
};

/**
 * 心跳不是“每小时必须发一句”的闹钟。它只给角色一次完整醒来的机会：可以看上下文、
 * 调工具、自然地来找用户，也可以明确保持安静。把安静收敛成唯一标记，避免模型写一段
 * “我决定不打扰你”反而真的打扰。
 */
export const buildHeartbeatTaskInstruction = (
  intervalMinutes: unknown,
  options: { activeChat?: boolean } = {},
): string => {
  const interval = normalizeHeartbeatInterval(intervalMinutes);
  return [
    `这是你的周期心跳（约每 ${interval} 分钟醒来一次），不是一条必须发送的定时消息。`,
    '先结合当前时间、最近对话、你自己的状态记录和可用工具，判断此刻是否有自然、具体的理由主动联系用户。',
    '如果有，就像平时聊天一样发 1-3 条简短自然的消息；可以关心、分享、提醒或承接之前的话题，但不要复述系统排程，不要提“心跳”“任务”“自动唤醒”，也不要用空泛模板式问候。',
    `如果没有合适的话，正文只能输出 ${AMSG_HEARTBEAT_NOOP}，不要附加解释，也不要为了证明你醒过而硬发消息。`,
    '用户一段时间没有开口时，你可以更愿意主动靠近，但不要催促、责怪、制造内疚，也不要在对方尚未回复时连续堆很多相似消息。',
    ...(options.activeChat ? [
      '',
      '【正在聊天时的处理】',
      '用户此刻正在和你聊天。不要另起话题、不要像突然弹出的通知，也不要重复回答用户刚说的话。',
      `只有当你能顺着当前话题自然补充一句时才发送，而且尽量只发 1 条短消息；否则输出 ${AMSG_HEARTBEAT_NOOP}。`,
    ] : []),
  ].join('\n');
};

/** 标记可以和思考残片一起出现；剥完只剩空串时，agentic 层自然走 skip-push。 */
export const stripHeartbeatNoop = (content: string): string =>
  content.split(AMSG_HEARTBEAT_NOOP).join('').trim();

/**
 * 从本次名义触发时刻向后滚动，直到下一跳至少在当前时刻 60 秒之后。
 * Cron 延迟或重试很久时不会把一串已经过期的心跳瞬间补跑出来。
 */
const stableHashNumber = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * 看起来随机、实际可复算的分钟偏移。同一角色、代次与名义下一跳在 Worker 重试时
 * 永远得到同一个结果，避免 Math.random() 让同一次 fire 排出多个不同 uuid 的分支。
 */
export const heartbeatJitterMinutes = (
  seed: string,
  nominalNextMs: number,
  intervalMinutes: unknown,
): number => {
  const window = heartbeatJitterWindowMinutes(intervalMinutes);
  const bucketCount = window * 2 + 1;
  return stableHashNumber(`${seed}:${Math.trunc(nominalNextMs)}`) % bucketCount - window;
};

export const nextHeartbeatTimeMs = (
  occurrenceMs: number,
  nowMs: number,
  intervalMinutes: unknown,
  jitterSeed = 'heartbeat',
): number => {
  const interval = normalizeHeartbeatInterval(intervalMinutes);
  const periodMs = interval * 60_000;
  const safeOccurrence = Number.isFinite(occurrenceMs) ? occurrenceMs : nowMs;
  const earliest = nowMs + 60_000;
  let steps = Math.max(1, Math.ceil((earliest - safeOccurrence) / periodMs));

  // 如果这一格抽到了负偏移、已经落在当前时刻之前，就看下一格；绝不补跑过期心跳。
  for (let attempt = 0; attempt < 3; attempt += 1, steps += 1) {
    const nominalNext = safeOccurrence + steps * periodMs;
    const jitterMs = heartbeatJitterMinutes(jitterSeed, nominalNext, interval) * 60_000;
    const candidate = nominalNext + jitterMs;
    if (candidate >= earliest) return candidate;
  }

  // period 最短 30 分钟、波动最大 20 分钟，正常两格内一定会到未来；保留这个兜底让
  // 非法时间输入也永远返回一个可排的时刻。
  return earliest;
};

const stableHash = (value: string): string => stableHashNumber(value).toString(36);

/** 重试同一跳时 uuid 不变，上游返回 duplicate 即视为下一跳已经安全存在。 */
export const heartbeatTaskUuid = (charId: string, occurrenceMs: number): string =>
  `heartbeat-${stableHash(charId)}-${Math.trunc(occurrenceMs).toString(36)}`;
