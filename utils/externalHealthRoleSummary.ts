import type { ExternalHealthSnapshot } from './externalHealth';

export interface ExternalHealthRoleContextInput {
  current?: ExternalHealthSnapshot | null;
  dailyByDate?: Record<string, ExternalHealthSnapshot>;
  now?: Date;
}

const localDateKey = (date: Date): string => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

const mean = (values: Array<number | undefined>): number | undefined => {
  const available = values.filter(finite);
  if (available.length < 2) return undefined;
  return available.reduce((sum, value) => sum + value, 0) / available.length;
};

const mergeDefined = (
  base: ExternalHealthSnapshot | undefined,
  current: ExternalHealthSnapshot | null | undefined,
): ExternalHealthSnapshot | undefined => {
  if (!base) return current ?? undefined;
  if (!current) return base;
  const merged = { ...base } as ExternalHealthSnapshot;
  Object.entries(current).forEach(([key, value]) => {
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  });
  return merged;
};

/**
 * 给角色的 Apple Health 常驻上下文只保留生活节律数据。
 * 心率、HRV、血压、血氧等生命体征与身体指标刻意不进入这里，避免模型把
 * 可穿戴设备的单次读数当成医疗异常反复提醒；原始值仍留在 Health/HA 详情中。
 */
export function buildExternalHealthRoleContext({
  current,
  dailyByDate = {},
  now = new Date(),
}: ExternalHealthRoleContextInput): string[] {
  const today = localDateKey(now);
  const todaySnapshot = mergeDefined(dailyByDate[today], current);
  const lines: string[] = [];

  if (todaySnapshot) {
    const todayParts: string[] = [];
    if (finite(todaySnapshot.stepsToday) && todaySnapshot.stepsToday > 0) {
      todayParts.push(`步数${Math.round(todaySnapshot.stepsToday).toLocaleString('zh-CN')}`);
    }
    if (finite(todaySnapshot.activeCaloriesToday) && todaySnapshot.activeCaloriesToday > 0) {
      todayParts.push(`活动${Math.round(todaySnapshot.activeCaloriesToday)}kcal`);
    }
    if (finite(todaySnapshot.sleepHoursLastNight) && todaySnapshot.sleepHoursLastNight > 0) {
      todayParts.push(`昨夜睡${todaySnapshot.sleepHoursLastNight.toFixed(1).replace(/\.0$/, '')}h`);
    }
    if (finite(todaySnapshot.exerciseMinutesToday) && todaySnapshot.exerciseMinutesToday > 0) {
      todayParts.push(`锻炼${Math.round(todaySnapshot.exerciseMinutesToday)}分钟`);
    }
    if (todayParts.length) lines.push(`【Apple Health·今日】${todayParts.join('｜')}`);
  }

  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now);
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() - index);
    return localDateKey(day);
  });
  const weekSnapshots = weekDates
    .map(date => date === today ? mergeDefined(dailyByDate[date], current) : dailyByDate[date])
    .filter((snapshot): snapshot is ExternalHealthSnapshot => Boolean(snapshot));

  if (weekSnapshots.length >= 2) {
    const weekParts = [`已记录${weekSnapshots.length}天`];
    const steps = mean(weekSnapshots.map(snapshot => snapshot.stepsToday));
    const activity = mean(weekSnapshots.map(snapshot => snapshot.activeCaloriesToday));
    const sleep = mean(weekSnapshots.map(snapshot => snapshot.sleepHoursLastNight));
    if (steps !== undefined) weekParts.push(`日均${Math.round(steps).toLocaleString('zh-CN')}步`);
    if (activity !== undefined) weekParts.push(`日均活动${Math.round(activity)}kcal`);
    if (sleep !== undefined) weekParts.push(`平均睡眠${sleep.toFixed(1)}h`);

    const exerciseDays = weekSnapshots.filter((snapshot) => {
      const workoutMinutes = snapshot.lastWorkout?.durationMinutes;
      return (finite(snapshot.exerciseMinutesToday) && snapshot.exerciseMinutesToday > 0)
        || (finite(workoutMinutes) && workoutMinutes > 0);
    }).length;
    if (exerciseDays > 0) weekParts.push(`锻炼${exerciseDays}天`);
    lines.push(`【Apple Health·近7日】${weekParts.join('｜')}`);
  }

  return lines;
}
