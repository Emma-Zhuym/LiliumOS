import {
  LOCATION_FRESH_MS,
  LOCATION_MAX_AGE_MS,
  loadLocationAwareness,
  refreshCoarseLocation,
  type LocationAwarenessState,
} from './locationService';

export const LOCATION_CHAT_TOOL_NAME = 'get_user_coarse_location';

export const LOCATION_CHAT_TOOL = {
  type: 'function',
  function: {
    name: LOCATION_CHAT_TOOL_NAME,
    description: '按需读取用户当前所在的粗略语义范围（例如家、学校、超市或在外面）。当对话自然需要知道用户在哪里时才调用；不会返回精确坐标。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
};

export function isLocationChatToolEnabled(state = loadLocationAwareness()): boolean {
  return state.enabled && state.zones.length > 0;
}

export function buildLocationChatToolSystemBlock(): string {
  return `【位置感知工具】你可以调用 ${LOCATION_CHAT_TOOL_NAME} 查看用户此刻的粗略位置范围。仅在对话自然需要时调用，例如用户问“我在哪里”、你确实担心她是否到家，或当前话题需要位置；不要每轮查询，不要把它当作监控。工具只会返回家/学校/超市/在外面和更新时间，不会给你精确坐标。`;
}

function resultFromState(state: LocationAwarenessState, now: number, source: 'live' | 'cache') {
  const snapshot = state.lastSnapshot;
  if (!snapshot) {
    return { success: false, status: 'unknown', message: '暂时没有可用的位置记录。可以自然地询问用户。' };
  }
  const ageMs = Math.max(0, now - snapshot.updatedAt);
  if (ageMs > LOCATION_MAX_AGE_MS) {
    return { success: false, status: 'stale', message: '位置记录已经过期，无法判断用户现在在哪里。可以自然地询问用户。' };
  }
  const minutesAgo = Math.round(ageMs / 60000);
  return {
    success: true,
    status: snapshot.zoneId ? 'inside_zone' : 'outside_saved_zones',
    label: snapshot.zoneId
      ? (snapshot.label.startsWith('在') ? snapshot.label : `在${snapshot.label}`)
      : '在外面',
    freshness: ageMs <= LOCATION_FRESH_MS ? 'fresh' : 'cached',
    minutesAgo,
    source,
    note: '这是粗略语义位置，不包含精确坐标。',
  };
}

export async function executeLocationChatTool(maxWaitMs = 8000): Promise<Record<string, unknown>> {
  const cached = loadLocationAwareness();
  if (!cached.enabled) return { success: false, status: 'disabled', message: '用户已关闭位置感知。' };
  if (cached.zones.length === 0) return { success: false, status: 'unconfigured', message: '用户尚未设置位置范围。' };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), maxWaitMs);
    });
    const refreshed = await Promise.race([
      refreshCoarseLocation().catch(() => null),
      timeout,
    ]);
    return resultFromState(refreshed || cached, Date.now(), refreshed ? 'live' : 'cache');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
