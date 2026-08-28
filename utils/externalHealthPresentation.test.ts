import { describe, expect, it } from 'vitest';
import { buildExternalHealthMetricGroups, countExternalHealthMetrics } from './externalHealthPresentation';
import type { ExternalHealthSnapshot } from './externalHealth';

const baseSnapshot: ExternalHealthSnapshot = {
  source: 'healthsync-home-assistant',
  fetchedAt: '2026-08-26T14:00:00Z',
  updatedAt: '2026-08-26T13:20:00Z',
};

describe('external health presentation', () => {
  it('groups every available HealthSync value while omitting missing fields', () => {
    const groups = buildExternalHealthMetricGroups({
      ...baseSnapshot,
      stepsToday: 8241,
      activeCaloriesToday: 412.4,
      sleepHoursLastNight: 6.8,
      hrvMs: 42.5,
      latestHeartRate: 82,
      latestWeightKg: 55,
      lastWorkout: { type: 'strengthTraining', durationMinutes: 45 },
    });

    expect(groups.map(group => group.title)).toEqual([
      '今日活动', '睡眠', '心脏与生命体征', '身体指标', '最近一次训练',
    ]);
    expect(countExternalHealthMetrics(groups)).toBe(8);
    expect(groups[0].metrics).toContainEqual({ label: '活动能量', value: '412 kcal' });
    expect(groups[4].metrics).toContainEqual({ label: '类型', value: '力量训练' });
  });

  it('does not create empty sections', () => {
    expect(buildExternalHealthMetricGroups(baseSnapshot)).toEqual([]);
  });

  it('hides placeholder body fat and keeps static height in the local health profile', () => {
    const groups = buildExternalHealthMetricGroups({
      ...baseSnapshot,
      bodyFatPercent: 0,
      heightMeters: 1.7,
      latestWeightKg: 55,
    });

    const labels = groups.flatMap(group => group.metrics.map(metric => metric.label));
    expect(labels).toContain('体重');
    expect(labels).not.toContain('体脂率');
    expect(labels).not.toContain('身高');
  });

  it('labels daily aggregates as averages and date-scoped totals', () => {
    const groups = buildExternalHealthMetricGroups({
      ...baseSnapshot,
      summaryKind: 'daily',
      summaryDate: '2026-08-25',
      stepsToday: 6000,
      latestHeartRate: 72.5,
      hrvMs: 44,
      latestWeightKg: 54.8,
    });

    expect(groups[0].title).toBe('当日活动');
    expect(groups.flatMap(group => group.metrics)).toEqual(expect.arrayContaining([
      { label: '平均心率', value: '73 次/分' },
      { label: '平均 HRV', value: '44 ms' },
      { label: '末次体重', value: '54.8 kg' },
    ]));
  });
});
