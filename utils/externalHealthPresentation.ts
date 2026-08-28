import type { ExternalHealthSnapshot } from './externalHealth';

export interface ExternalHealthMetric {
  label: string;
  value: string;
}

export interface ExternalHealthMetricGroup {
  title: string;
  metrics: ExternalHealthMetric[];
}

const rounded = (value: number, digits = 0): string =>
  value.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

const metric = (
  label: string,
  value: number | undefined,
  unit = '',
  digits = 0,
): ExternalHealthMetric | null => value === undefined
  ? null
  : { label, value: `${rounded(value, digits)}${unit}` };

const positiveMetric = (
  label: string,
  value: number | undefined,
  unit = '',
  digits = 0,
): ExternalHealthMetric | null => value !== undefined && value > 0
  ? metric(label, value, unit, digits)
  : null;

const compact = <T>(values: Array<T | null>): T[] => values.filter((value): value is T => value !== null);

const distance = (meters: number | undefined): string | undefined => {
  if (meters === undefined) return undefined;
  if (meters >= 1000) return `${rounded(meters / 1000, 2)} km`;
  return `${rounded(meters)} m`;
};

const height = (meters: number | undefined): string | undefined => {
  if (meters === undefined) return undefined;
  return `${rounded(meters * 100, 1)} cm`;
};

const clock = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  const match = value.match(/\b(\d{1,2}):(\d{2})\b/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : value;
};

const workoutLabel = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = value.replace(/[\s_-]/g, '').toLowerCase();
  const known: Record<string, string> = {
    strengthtraining: '力量训练',
    traditionalstrengthtraining: '传统力量训练',
    functionalstrengthtraining: '功能性力量训练',
    walking: '步行',
    running: '跑步',
    cycling: '骑行',
    swimming: '游泳',
    yoga: '瑜伽',
    hiking: '徒步',
    hiit: '高强度间歇训练',
    highintensityintervaltraining: '高强度间歇训练',
  };
  return known[normalized] || value.replace(/([a-z])([A-Z])/g, '$1 $2');
};

const textMetric = (label: string, value: string | undefined): ExternalHealthMetric | null =>
  value ? { label, value } : null;

export function buildExternalHealthMetricGroups(
  snapshot: ExternalHealthSnapshot,
): ExternalHealthMetricGroup[] {
  const isDaily = snapshot.summaryKind === 'daily';
  const bloodPressure = snapshot.bloodPressureSystolic !== undefined || snapshot.bloodPressureDiastolic !== undefined
    ? [snapshot.bloodPressureSystolic, snapshot.bloodPressureDiastolic]
      .map(value => value === undefined ? '—' : rounded(value))
      .join('/')
    : undefined;

  const groups: ExternalHealthMetricGroup[] = [
    {
      title: isDaily ? '当日活动' : '今日活动',
      metrics: compact([
        metric('步数', snapshot.stepsToday),
        metric('活动能量', snapshot.activeCaloriesToday, ' kcal'),
        metric('锻炼时间', snapshot.exerciseMinutesToday, ' 分钟'),
        metric('静息能量', snapshot.restingEnergyToday, ' kcal'),
        textMetric('步行与跑步距离', distance(snapshot.walkingRunningDistanceMetersToday)),
        metric('已爬楼层', snapshot.flightsClimbedToday, ' 层'),
      ]),
    },
    {
      title: '睡眠',
      metrics: compact([
        metric(isDaily ? '夜间睡眠' : '昨夜睡眠', snapshot.sleepHoursLastNight, ' 小时', 1),
        metric('深睡', snapshot.sleepDeepMinutes, ' 分钟'),
        metric('REM 睡眠', snapshot.sleepRemMinutes, ' 分钟'),
        metric('核心睡眠', snapshot.sleepCoreMinutes, ' 分钟'),
        metric('清醒', snapshot.sleepAwakeMinutes, ' 分钟'),
        textMetric('入睡', clock(snapshot.sleepStartedAt)),
        textMetric('醒来', clock(snapshot.sleepEndedAt)),
      ]),
    },
    {
      title: '心脏与生命体征',
      metrics: compact([
        metric(isDaily ? '平均心率' : '最新心率', snapshot.latestHeartRate, ' 次/分'),
        metric(isDaily ? '平均静息心率' : '静息心率', snapshot.restingHeartRate, ' 次/分'),
        metric('步行平均心率', snapshot.walkingHeartRate, ' 次/分'),
        metric(isDaily ? '平均心率恢复' : '心率恢复', snapshot.heartRateRecovery, ' 次/分'),
        metric(isDaily ? '平均 HRV' : 'HRV', snapshot.hrvMs, ' ms'),
        textMetric(isDaily ? '平均血压' : '血压', bloodPressure ? `${bloodPressure} mmHg` : undefined),
        metric(isDaily ? '平均血氧' : '血氧', snapshot.bloodOxygenPercent, '%', 1),
        metric(isDaily ? '平均呼吸频率' : '呼吸频率', snapshot.respiratoryRate, ' 次/分', 1),
        metric(isDaily ? '平均房颤负荷' : '房颤负荷', snapshot.afibBurdenPercent, '%', 1),
      ]),
    },
    {
      title: '身体指标',
      metrics: compact([
        metric(isDaily ? '平均体温' : '体温', snapshot.bodyTemperatureCelsius, ' ℃', 1),
        metric(isDaily ? '平均血糖' : '血糖', snapshot.bloodGlucoseMgDl, ' mg/dL'),
        metric(isDaily ? '末次 VO₂ max' : 'VO₂ max', snapshot.vo2Max, ' ml/kg/min', 1),
        metric(isDaily ? '末次体重' : '体重', snapshot.latestWeightKg, ' kg', 1),
        metric('BMI', snapshot.bodyMassIndex, '', 1),
        positiveMetric('体脂率', snapshot.bodyFatPercent, '%', 1),
        positiveMetric('瘦体重', snapshot.leanBodyMassKg, ' kg', 1),
        textMetric('腰围', height(snapshot.waistCircumferenceMeters)),
      ]),
    },
    {
      title: isDaily ? '当日最近训练' : '最近一次训练',
      metrics: compact([
        textMetric('类型', workoutLabel(snapshot.lastWorkout?.type)),
        metric('时长', snapshot.lastWorkout?.durationMinutes, ' 分钟'),
        metric('活动能量', snapshot.lastWorkout?.calories, ' kcal'),
        textMetric('距离', distance(snapshot.lastWorkout?.distanceMeters)),
        textMetric('开始', clock(snapshot.lastWorkout?.startedAt)),
        textMetric('结束', clock(snapshot.lastWorkout?.endedAt)),
      ]),
    },
  ];

  return groups.filter(group => group.metrics.length > 0);
}

export function countExternalHealthMetrics(groups: ExternalHealthMetricGroup[]): number {
  return groups.reduce((total, group) => total + group.metrics.length, 0);
}
