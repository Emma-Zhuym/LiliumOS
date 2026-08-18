/**
 * Active Message 2.0 心跳的睡眠硬闸。
 *
 * 浏览器把角色明确设置的睡眠区间和当天日程原始数据放进 fire_pack；Worker 到点按
 * 角色时区现算。这里必须保持纯函数，不能读取 DB / localStorage / DOM。
 */

import type { ScheduleSlot } from '../types';
import type { AmsgFireScene } from './amsgFireScene';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone } from './timezone';

export const SLEEP_TIMELINE_START = 21 * 60 + 30;
export const SLEEP_TIMELINE_END = 24 * 60 + 10 * 60;

export interface AmsgSleepWindow {
  bedtimeMinutes: number;
  wakeTimeMinutes: number;
}

export type HeartbeatSleepReason = 'sleep-window' | 'schedule-sleep';

/** 云端状态只接受日程面板能产生的跨午夜睡眠区间；坏数据按未设置处理。 */
export const normalizeAmsgSleepWindow = (value: unknown): AmsgSleepWindow | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Partial<AmsgSleepWindow>;
  if (typeof source.bedtimeMinutes !== 'number' || typeof source.wakeTimeMinutes !== 'number') return null;
  const bedtimeMinutes = Math.round(source.bedtimeMinutes);
  const wakeTimeMinutes = Math.round(source.wakeTimeMinutes);
  if (!Number.isFinite(bedtimeMinutes) || !Number.isFinite(wakeTimeMinutes)) return null;
  if (
    bedtimeMinutes < SLEEP_TIMELINE_START
    || wakeTimeMinutes > SLEEP_TIMELINE_END
    || wakeTimeMinutes <= bedtimeMinutes
  ) return null;
  return { bedtimeMinutes, wakeTimeMinutes };
};

const timelineMinutesAt = (nowMs: number, tzId: string): number => {
  const wallNow = nowInTimeZone(tzId, new Date(nowMs));
  const minutes = wallNow.getHours() * 60 + wallNow.getMinutes();
  return minutes < 10 * 60 ? minutes + 24 * 60 : minutes;
};

const isInsideSleepWindow = (window: AmsgSleepWindow, nowMs: number, tzId: string): boolean => {
  const minutes = timelineMinutesAt(nowMs, tzId);
  return minutes >= window.bedtimeMinutes && minutes < window.wakeTimeMinutes;
};

// 只认明确睡着的表达；“睡前阅读 / 起床 / 失眠”不在表里，避免把清醒时段误拦。
const SLEEP_SLOT_PATTERN = /睡眠中|睡觉|入睡|熟睡|沉睡|午睡|小睡|补觉|就寝|休眠|梦乡|睡着|睡懒觉|\b(?:sleep|asleep|napping|nap)\b/i;
const AWAKE_SLEEP_PATTERN = /睡前|睡觉前|准备(?:睡|就寝)|失眠|起床|醒来|刚醒|赖床|before sleep|bedtime routine/i;

export const scheduleSlotIsSleeping = (slot: ScheduleSlot | null | undefined): boolean => {
  if (!slot) return false;
  const text = `${slot.activity || ''} ${slot.description || ''}`;
  return !AWAKE_SLEEP_PATTERN.test(text) && SLEEP_SLOT_PATTERN.test(text);
};

const parseSlotMinutes = (slot: ScheduleSlot): number | null => {
  const [hour, minute] = slot.startTime.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
};

const previousDateKey = (dateKey: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const instant = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 86_400_000;
  return new Date(instant).toISOString().slice(0, 10);
};

/**
 * 当日日程按当前 slot 判；凌晨第一项开始前继承最后一个 slot，与前台角色状态一致。
 * fire_pack 可能是前一晚打好的，所以允许“昨天的最后一项”跨到今天第一项之前；更旧的
 * 日程一律不用，避免拿几天前的作息误判。
 */
const resolveSceneSlot = (
  scene: AmsgFireScene | null,
  nowMs: number,
  tzId: string,
): ScheduleSlot | null => {
  if (!scene?.schedule?.slots?.length) return null;
  const wallNow = nowInTimeZone(tzId, new Date(nowMs));
  const currentDateKey = getLocalDateKey(wallNow);
  const priorDateKey = previousDateKey(currentDateKey);
  if (scene.dateKey !== currentDateKey && scene.dateKey !== priorDateKey) return null;

  const validSlots = scene.schedule.slots
    .map((slot) => ({ slot, minutes: parseSlotMinutes(slot) }))
    .filter((entry): entry is { slot: ScheduleSlot; minutes: number } => entry.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  if (validSlots.length === 0) return null;

  const currentMinutes = wallNow.getHours() * 60 + wallNow.getMinutes();
  // 前一天的表只允许承担“昨夜延续”这一小段；一旦跨过它自己的第一项就视为过期。
  if (scene.dateKey === priorDateKey && currentMinutes >= validSlots[0].minutes) return null;

  for (let i = validSlots.length - 1; i >= 0; i -= 1) {
    if (currentMinutes >= validSlots[i].minutes) return validSlots[i].slot;
  }
  return validSlots[validSlots.length - 1].slot;
};

/** 明确睡眠区间与当天日程任一判定为睡着，就在调用模型前安静跳过。 */
export const resolveHeartbeatSleepReason = (input: {
  sleepWindow: unknown;
  scene: AmsgFireScene | null;
  nowMs: number;
  tzId: string;
}): HeartbeatSleepReason | null => {
  const window = normalizeAmsgSleepWindow(input.sleepWindow);
  if (window && isInsideSleepWindow(window, input.nowMs, input.tzId)) return 'sleep-window';
  const currentSlot = resolveSceneSlot(input.scene, input.nowMs, input.tzId);
  return scheduleSlotIsSleeping(currentSlot) ? 'schedule-sleep' : null;
};
