import type { Message } from '../types';
import {
  loadExternalHealthDailySummaries,
  loadExternalHealthSnapshot,
  mergeExternalHealthSnapshots,
  syncExternalHealthDailyRange,
  type ExternalHealthSnapshot,
  type HealthSyncHistoryMetric,
} from './externalHealth';
import { addLocalDays, getLocalDateKey, parseLocalDateKey } from './localDate';
import { hasHomeAssistantMcpAccess } from './mcpClient';
import { loadSmartHomeConfig } from './smartHome';

export const HEALTH_CHAT_TOOL_NAME = 'health_get_details';

const HEALTH_CATEGORIES = ['activity', 'sleep', 'heart', 'workout', 'body'] as const;
type HealthCategory = typeof HEALTH_CATEGORIES[number];
type HealthPeriod = 'today' | 'yesterday' | 'last_7_days' | 'date';

export const HEALTH_CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: HEALTH_CHAT_TOOL_NAME,
      description: '按需读取用户 Apple Health 经 HealthSync 存入 Home Assistant 的真实详细数据。可查看今天、昨天、指定日期或最近 7 天；只在对话确实涉及用户健康或生活节律时调用。',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'yesterday', 'last_7_days', 'date'],
            description: '查询范围，默认 today。指定某一天时使用 date。',
          },
          date: {
            type: 'string',
            description: 'period=date 时的本地日期，格式 YYYY-MM-DD。',
          },
          categories: {
            type: 'array',
            items: { type: 'string', enum: HEALTH_CATEGORIES },
            description: '只取回答所需类别：activity 活动、sleep 睡眠、heart 心率节律、workout 锻炼、body 体重与 VO2 max。默认全部。',
          },
        },
        additionalProperties: false,
      },
    },
  },
] as const;

export const HEALTH_CHAT_TOOL_NAMES = new Set<string>(HEALTH_CHAT_TOOLS.map(tool => tool.function.name));

const HEALTH_TOPIC_RE = /(?:apple\s*health|healthsync|健康数据|步数|走了多少步|活动能量|运动热量|锻炼时间|睡眠|睡了|睡得|入睡|醒来|起床时间|心率|静息心率|步行心率|HRV|心率变异|心率恢复|VO2|最大摄氧|体重(?:数据|记录|变化)?|BMI|锻炼记录|训练记录|workouts?|steps?|sleep|heart\s*rate)/i;
const HEALTH_QUERY_RE = /(?:查看|看看|查询|查一下|读一下|同步|多少|多久|怎么样|如何|什么情况|趋势|数据|记录|有没有|是否|达标|完成|分析|为什么|偏高|偏低|高不高|低不低|今天|昨日|昨天|昨晚|最近|这周|过去|刚才|上次|how\s+(?:many|much|long)|show|check|status|trend)/i;
const HEALTH_FALSE_POSITIVE_RE = /(?:买|购|选|推荐|哪个|哪款|多少钱).{0,8}(?:体重秤|手表)|(?:体重秤|手表).{0,8}(?:买|购|推荐|价格)/i;

function messageText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  try { return JSON.stringify(message.content); } catch { return ''; }
}

/** 健康语义只在当前轮开启本地工具；普通聊天继续走 Instant Chat/CF。 */
export function shouldEnableHealthTools(messages: Message[]): boolean {
  const lastUser = [...messages].reverse().find(message => message.role === 'user');
  if (!lastUser) return false;
  const text = messageText(lastUser);
  return !HEALTH_FALSE_POSITIVE_RE.test(text)
    && HEALTH_TOPIC_RE.test(text)
    && HEALTH_QUERY_RE.test(text);
}

export function isHealthChatToolAvailable(charId?: string): boolean {
  if (!hasHomeAssistantMcpAccess(charId)) return false;
  const config = loadSmartHomeConfig();
  return Boolean(
    loadExternalHealthSnapshot()
    || Object.keys(loadExternalHealthDailySummaries()).length
    || (config.baseUrl && !config.demoMode),
  );
}

export function buildHealthChatSystemBlock(): string {
  return [
    '[本轮可使用 Apple Health 详细查询工具]',
    '常驻摘要只给了今天和最近七天的极简生活节律；需要回答具体日期、睡眠阶段、活动、心率节律、锻炼或体重细节时，调用 health_get_details。',
    '只查询回答当前话题所需的类别，留意 data_as_of、source 和 missing_dates。缓存或缺失的数据要如实说明，不要假装实时。',
    '这不是医疗诊断工具。不要把单次可穿戴设备读数解释成疾病，不要制造健康焦虑；如用户描述严重或持续症状，应建议寻求专业帮助。',
    '用户已明确不希望角色读取或评论血氧；工具不会提供该指标，也不要追问或推测它。',
  ].join('\n');
}

const METRICS_BY_CATEGORY: Record<HealthCategory, HealthSyncHistoryMetric[]> = {
  activity: ['steps', 'activeCalories', 'exerciseTime', 'restingEnergy', 'distanceWalkingRunning', 'flightsClimbed'],
  sleep: ['sleep'],
  heart: ['heartRate', 'restingHeartRate', 'walkingHeartRateAverage', 'heartRateVariability', 'heartRateRecoveryOneMinute'],
  workout: ['workouts'],
  // 体脂和身高在当前数据源里可能是缺失值/错误默认值，因此不交给角色。
  body: ['weight', 'bodyMassIndex', 'vo2Max'],
};

const compact = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null)) as Partial<T>;

function publicDay(snapshot: ExternalHealthSnapshot, categories: HealthCategory[]) {
  const result: Record<string, unknown> = { date: snapshot.summaryDate };
  if (categories.includes('activity')) {
    result.activity = compact({
      steps: snapshot.stepsToday,
      active_calories_kcal: snapshot.activeCaloriesToday,
      exercise_minutes: snapshot.exerciseMinutesToday,
      resting_energy_kcal: snapshot.restingEnergyToday,
      walking_running_distance_m: snapshot.walkingRunningDistanceMetersToday,
      flights_climbed: snapshot.flightsClimbedToday,
    });
  }
  if (categories.includes('sleep')) {
    result.sleep = compact({
      hours: snapshot.sleepHoursLastNight,
      deep_minutes: snapshot.sleepDeepMinutes,
      rem_minutes: snapshot.sleepRemMinutes,
      core_minutes: snapshot.sleepCoreMinutes,
      awake_minutes: snapshot.sleepAwakeMinutes,
      started_at: snapshot.sleepStartedAt,
      ended_at: snapshot.sleepEndedAt,
    });
  }
  if (categories.includes('heart')) {
    result.heart = compact({
      average_or_latest_bpm: snapshot.latestHeartRate,
      resting_bpm: snapshot.restingHeartRate,
      walking_average_bpm: snapshot.walkingHeartRate,
      hrv_ms: snapshot.hrvMs,
      recovery_bpm: snapshot.heartRateRecovery,
    });
  }
  if (categories.includes('workout')) {
    result.workout = snapshot.lastWorkout ? compact({
      type: snapshot.lastWorkout.type,
      duration_minutes: snapshot.lastWorkout.durationMinutes,
      calories_kcal: snapshot.lastWorkout.calories,
      distance_m: snapshot.lastWorkout.distanceMeters,
      started_at: snapshot.lastWorkout.startedAt,
      ended_at: snapshot.lastWorkout.endedAt,
    }) : {};
  }
  if (categories.includes('body')) {
    result.body = compact({
      weight_kg: snapshot.latestWeightKg,
      bmi: snapshot.bodyMassIndex,
      vo2_max: snapshot.vo2Max,
    });
  }
  return result;
}

const validCategories = (raw: unknown): HealthCategory[] => {
  if (!Array.isArray(raw)) return [...HEALTH_CATEGORIES];
  const selected = raw.filter((item): item is HealthCategory =>
    typeof item === 'string' && (HEALTH_CATEGORIES as readonly string[]).includes(item));
  return selected.length ? [...new Set(selected)] : [...HEALTH_CATEGORIES];
};

function resolveRange(args: Record<string, unknown>): { period: HealthPeriod; startDate: string; endDate: string } {
  const today = getLocalDateKey();
  const period = (['today', 'yesterday', 'last_7_days', 'date'] as const).includes(args.period as HealthPeriod)
    ? args.period as HealthPeriod
    : 'today';
  if (period === 'yesterday') {
    const date = addLocalDays(today, -1);
    return { period, startDate: date, endDate: date };
  }
  if (period === 'last_7_days') return { period, startDate: addLocalDays(today, -6), endDate: today };
  if (period === 'date') {
    const date = typeof args.date === 'string' ? args.date.trim() : '';
    if (!parseLocalDateKey(date)) throw new Error('请提供有效的 YYYY-MM-DD 日期');
    return { period, startDate: date, endDate: date };
  }
  return { period: 'today', startDate: today, endDate: today };
}

function datesInRange(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  for (let date = startDate; date && date <= endDate; date = addLocalDays(date, 1)) result.push(date);
  return result;
}

function newestDataTimestamp(snapshots: ExternalHealthSnapshot[]): string | null {
  const timestamps = snapshots
    .map(snapshot => snapshot.updatedAt)
    .map(value => Date.parse(value))
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

export async function executeHealthChatTool(
  name: string,
  args: Record<string, unknown> = {},
  charId?: string,
): Promise<Record<string, unknown>> {
  if (name !== HEALTH_CHAT_TOOL_NAME) return { success: false, error: `未知健康工具：${name}` };
  if (!hasHomeAssistantMcpAccess(charId)) {
    return { success: false, status: 'forbidden', message: '这个角色没有读取 Home Assistant 健康数据的权限。' };
  }

  const { period, startDate, endDate } = resolveRange(args);
  const categories = validCategories(args.categories);
  const metrics = [...new Set(categories.flatMap(category => METRICS_BY_CATEGORY[category]))];
  const wantedDates = datesInRange(startDate, endDate);
  const cachedBefore = loadExternalHealthDailySummaries();
  const config = loadSmartHomeConfig();
  let fetched: Record<string, ExternalHealthSnapshot> = {};
  let liveError: string | null = null;

  if (config.baseUrl && !config.demoMode) {
    try {
      fetched = await syncExternalHealthDailyRange(startDate, endDate, config, {
        metrics,
        timeoutMs: 12_000,
      });
    } catch (error) {
      liveError = error instanceof Error ? error.message : String(error);
    }
  } else {
    liveError = 'Home Assistant 当前未配置为真实连接';
  }

  const latestCurrent = loadExternalHealthSnapshot();
  const cachedAfter = loadExternalHealthDailySummaries();
  const snapshots = wantedDates.flatMap((date) => {
    let snapshot = fetched[date] || cachedAfter[date] || cachedBefore[date];
    if (date === getLocalDateKey() && latestCurrent) {
      snapshot = snapshot ? mergeExternalHealthSnapshots(snapshot, latestCurrent) : latestCurrent;
      snapshot = { ...snapshot, summaryDate: date, summaryKind: 'daily' };
    }
    return snapshot ? [snapshot] : [];
  });
  const availableDates = new Set(snapshots.map(snapshot => snapshot.summaryDate).filter(Boolean));
  const missingDates = wantedDates.filter(date => !availableDates.has(date));
  const source = Object.keys(fetched).length
    ? (snapshots.some(snapshot => !fetched[snapshot.summaryDate || '']) ? 'mixed' : 'live')
    : 'cache';

  if (!snapshots.length) {
    return {
      success: false,
      status: liveError ? 'unreachable' : 'empty',
      period,
      start_date: startDate,
      end_date: endDate,
      missing_dates: missingDates,
      message: liveError || '这段日期还没有 HealthSync 数据。',
    };
  }

  return compact({
    success: true,
    period,
    start_date: startDate,
    end_date: endDate,
    categories,
    source,
    data_as_of: newestDataTimestamp(snapshots),
    coverage_days: snapshots.length,
    missing_dates: missingDates,
    live_refresh_error: liveError || undefined,
    days: snapshots
      .sort((left, right) => String(left.summaryDate).localeCompare(String(right.summaryDate)))
      .map(snapshot => publicDay(snapshot, categories)),
    note: '生活健康数据仅供日常参考，不代表医疗诊断。',
  });
}
