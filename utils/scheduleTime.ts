import type { CharacterProfile, ScheduleSlot } from '../types';
import {
    normalizeAmsgSleepWindow,
} from './amsgSleepGuard';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone, resolveCharTimeZone } from './timezone';

type ScheduleCharacter = Pick<CharacterProfile, 'customTimezoneEnabled' | 'customTimezone' | 'sleepWindow'>;

export { SLEEP_TIMELINE_END, SLEEP_TIMELINE_START } from './amsgSleepGuard';

export interface SleepWindowState {
    isSleeping: boolean;
    bedtimeMinutes: number;
    wakeTimeMinutes: number;
    msUntilWake: number;
}

/** 把跨午夜滑块刻度格式化成可读时间。 */
export const formatSleepTimelineTime = (minutes: number): string => {
    const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const prefix = minutes >= 24 * 60 ? '次日 ' : '';
    return `${prefix}${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

/** 按角色时区判断当前是否落在已设定的睡眠区间。 */
export const getSleepWindowState = (
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): SleepWindowState | null => {
    const window = normalizeAmsgSleepWindow(char?.sleepWindow);
    if (!window) return null;

    const { bedtimeMinutes, wakeTimeMinutes } = window;

    const wallClock = getScheduleWallClock(char, base);
    const clockMinutes = wallClock.getHours() * 60 + wallClock.getMinutes();
    const timelineMinutes = clockMinutes < 10 * 60 ? clockMinutes + 24 * 60 : clockMinutes;
    const isSleeping = timelineMinutes >= bedtimeMinutes && timelineMinutes < wakeTimeMinutes;
    const msUntilWake = isSleeping
        ? Math.max(1_000, (wakeTimeMinutes - timelineMinutes) * 60_000 - wallClock.getSeconds() * 1_000 - wallClock.getMilliseconds())
        : 0;

    return { isSleeping, bedtimeMinutes, wakeTimeMinutes, msUntilWake };
};

/** 当前绝对时刻 → 角色所在地的墙上时间；未启用自定义时区时跟随设备。 */
export const getScheduleWallClock = (
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): Date => nowInTimeZone(resolveCharTimeZone(char), base);

/** 角色所在地的日历日 key。 */
export const getScheduleDateKey = (
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): string => getLocalDateKey(getScheduleWallClock(char, base));

/** 按角色所在地的当前时间，找到已经开始的最后一条日程。 */
export const getCurrentScheduleSlotIndex = (
    slots: ScheduleSlot[],
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): number => {
    const now = getScheduleWallClock(char, base);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (let i = slots.length - 1; i >= 0; i--) {
        const [h, m] = slots[i].startTime.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        if (currentMinutes >= h * 60 + m) return i;
    }
    return -1;
};
