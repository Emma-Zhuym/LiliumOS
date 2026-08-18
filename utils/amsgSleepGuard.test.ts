import { describe, expect, it } from 'vitest';
import type { AmsgFireScene } from './amsgFireScene';
import {
  normalizeAmsgSleepWindow,
  resolveHeartbeatSleepReason,
  scheduleSlotIsSleeping,
} from './amsgSleepGuard';

const scene = (
  dateKey: string,
  slots: Array<{ startTime: string; activity: string; description?: string }>,
): AmsgFireScene => ({
  charId: 'char-a',
  dateKey,
  schedule: { slots },
  songPool: [],
});
describe('amsgSleepGuard', () => {
  it('按角色时区识别明确的跨午夜睡眠区间', () => {
    const sleepWindow = { bedtimeMinutes: 23 * 60, wakeTimeMinutes: 24 * 60 + 7 * 60 + 30 };
    expect(resolveHeartbeatSleepReason({
      sleepWindow,
      scene: null,
      nowMs: Date.parse('2026-08-18T11:30:00.000Z'), // 洛杉矶 04:30
      tzId: 'America/Los_Angeles',
    })).toBe('sleep-window');
    expect(resolveHeartbeatSleepReason({
      sleepWindow,
      scene: null,
      nowMs: Date.parse('2026-08-18T16:00:00.000Z'), // 洛杉矶 09:00
      tzId: 'America/Los_Angeles',
    })).toBeNull();
  });

  it('当天日程明确写着午睡时安静跳过，开会不冒充睡觉', () => {
    const schedule = scene('2026-08-18', [
      { startTime: '09:00', activity: '开会' },
      { startTime: '12:30', activity: '午睡一会儿' },
      { startTime: '13:30', activity: '继续工作' },
    ]);
    expect(resolveHeartbeatSleepReason({
      sleepWindow: null,
      scene: schedule,
      nowMs: Date.parse('2026-08-18T12:50:00.000Z'),
      tzId: 'UTC',
    })).toBe('schedule-sleep');
    expect(resolveHeartbeatSleepReason({
      sleepWindow: null,
      scene: schedule,
      nowMs: Date.parse('2026-08-18T10:00:00.000Z'),
      tzId: 'UTC',
    })).toBeNull();
  });

  it('凌晨第一项开始前继承前一晚最后的睡眠时段', () => {
    const yesterday = scene('2026-08-17', [
      { startTime: '07:30', activity: '起床洗漱' },
      { startTime: '23:00', activity: '睡觉' },
    ]);
    expect(resolveHeartbeatSleepReason({
      sleepWindow: null,
      scene: yesterday,
      nowMs: Date.parse('2026-08-18T03:00:00.000Z'),
      tzId: 'UTC',
    })).toBe('schedule-sleep');
  });

  it('超过一天的旧日程不再参与睡眠判定', () => {
    expect(resolveHeartbeatSleepReason({
      sleepWindow: null,
      scene: scene('2026-08-16', [{ startTime: '23:00', activity: '睡觉' }]),
      nowMs: Date.parse('2026-08-18T03:00:00.000Z'),
      tzId: 'UTC',
    })).toBeNull();
  });

  it('坏区间与清醒相关词不会误拦', () => {
    expect(normalizeAmsgSleepWindow({ bedtimeMinutes: 480, wakeTimeMinutes: 500 })).toBeNull();
    expect(scheduleSlotIsSleeping({ startTime: '22:30', activity: '睡前阅读' })).toBe(false);
    expect(scheduleSlotIsSleeping({ startTime: '08:00', activity: '起床' })).toBe(false);
    expect(scheduleSlotIsSleeping({ startTime: '02:00', activity: '失眠发呆' })).toBe(false);
  });
});
