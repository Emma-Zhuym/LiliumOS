import { describe, expect, it } from 'vitest';
import type { ExternalHealthSnapshot } from './externalHealth';
import { buildExternalHealthRoleContext } from './externalHealthRoleSummary';

const snapshot = (
  date: string,
  values: Partial<ExternalHealthSnapshot>,
): ExternalHealthSnapshot => ({
  source: 'healthsync-home-assistant',
  fetchedAt: `${date}T20:00:00.000Z`,
  updatedAt: `${date}T20:00:00.000Z`,
  summaryDate: date,
  summaryKind: 'daily',
  ...values,
});

describe('Apple Health role summary', () => {
  it('keeps the always-on context minimal and never exposes blood oxygen or other vitals', () => {
    const lines = buildExternalHealthRoleContext({
      now: new Date(2026, 7, 27, 12),
      current: snapshot('2026-08-27', {
        stepsToday: 1953,
        activeCaloriesToday: 161,
        sleepHoursLastNight: 7.1,
        hrvMs: 46,
        latestHeartRate: 82,
        bloodOxygenPercent: 93,
        bodyFatPercent: 0,
      }),
    });

    expect(lines).toEqual(['【Apple Health·今日】步数1,953｜活动161kcal｜昨夜睡7.1h']);
    expect(lines.join('\n')).not.toMatch(/血氧|心率|HRV|体脂/);
  });

  it('builds a compact seven-day rhythm summary from the available daily cache', () => {
    const lines = buildExternalHealthRoleContext({
      now: new Date(2026, 7, 27, 12),
      current: snapshot('2026-08-27', {
        stepsToday: 6000,
        activeCaloriesToday: 300,
        sleepHoursLastNight: 7,
        exerciseMinutesToday: 30,
      }),
      dailyByDate: {
        '2026-08-26': snapshot('2026-08-26', {
          stepsToday: 4000,
          activeCaloriesToday: 200,
          sleepHoursLastNight: 8,
        }),
        '2026-08-25': snapshot('2026-08-25', {
          stepsToday: 5000,
          activeCaloriesToday: 250,
          sleepHoursLastNight: 6,
          lastWorkout: { durationMinutes: 45 },
          bloodOxygenPercent: 91,
        }),
      },
    });

    expect(lines[1]).toBe('【Apple Health·近7日】已记录3天｜日均5,000步｜日均活动250kcal｜平均睡眠7.0h｜锻炼2天');
    expect(lines.join('\n')).not.toContain('血氧');
  });

  it('does not pretend one cached day is a seven-day trend', () => {
    const lines = buildExternalHealthRoleContext({
      now: new Date(2026, 7, 27, 12),
      current: snapshot('2026-08-27', { stepsToday: 1000 }),
    });
    expect(lines).toHaveLength(1);
  });
});
