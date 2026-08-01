/**
 * charStatus.ts — 根据角色日程计算当前在线状态
 *
 * EM 独有功能，独立文件不侵入上游。
 *
 * 三种状态：
 *   online  — 角色空闲 / 可以聊天的时段
 *   busy    — 角色在忙（开会、工作、上课等），会短回复
 *   offline — 角色不可用（睡觉等），不发送 API 请求
 */

import { CharacterProfile, DailySchedule, ScheduleSlot } from '../types';
import { getScheduleWallClock, getSleepWindowState } from './scheduleTime';

export type CharAvailability = 'online' | 'busy' | 'offline';

export interface CharStatusResult {
    status: CharAvailability;
    /** 当前时段的活动名 */
    currentActivity?: string;
    /** 当前时段 emoji */
    currentEmoji?: string;
    /** 距离下一次状态变化还剩多少毫秒（用于 setTimeout） */
    msUntilChange: number;
    /** 下一个状态是什么 */
    nextStatus?: CharAvailability;
}

// ─── 关键词匹配（当 slot 没有手动设置 availability 时自动判断）───

// offline = 完全不可能碰手机的场合
const OFFLINE_KEYWORDS = [
    // 睡眠
    '睡', '入睡', '熟睡', '午睡', '小睡', '躺下', '关灯',
    '梦', '做梦', '失眠',
    // 正式演出 / 比赛（不是排练）
    '演出', '登台', '表演', '上台', '比赛', '决赛',
    // 考试 / 面试（正式场合）
    '考试', '面试', '答辩',
    // 医疗（执刀方）
    '手术',
    // 直播（在镜头前）
    '直播',
];

// busy = 在忙但偶尔能瞄一眼手机
const BUSY_KEYWORDS = [
    '开会', '会议', '上课', '讲座',
    '工作', '上班', '加班', '赶工', '赶稿', '赶 deadline',
    '排练', '录音', '彩排',
    '看诊', '门诊',
    '训练', '健身',
];

/**
 * 根据活动名自动推断 availability。
 * 优先级：offline > busy > online
 */
function inferAvailability(slot: ScheduleSlot): CharAvailability {
    const text = `${slot.activity} ${slot.description || ''}`;

    if (OFFLINE_KEYWORDS.some(kw => text.includes(kw))) return 'offline';
    if (BUSY_KEYWORDS.some(kw => text.includes(kw))) return 'busy';
    return 'online';
}

/**
 * 获取某个 slot 的 availability（手动设置优先，否则自动推断）
 */
export function getSlotAvailability(slot: ScheduleSlot): CharAvailability {
    if (slot.availability) return slot.availability;
    return inferAvailability(slot);
}

/**
 * 核心函数：根据日程和当前时间，计算角色的在线状态
 */
export function computeCharStatus(
    schedule: DailySchedule | null,
    now?: Date,
    char?: CharacterProfile | null,
): CharStatusResult {
    const sleepState = getSleepWindowState(char, now);
    if (sleepState?.isSleeping) {
        return {
            status: 'offline',
            currentActivity: '睡眠中',
            currentEmoji: '💤',
            msUntilChange: sleepState.msUntilWake,
            nextStatus: 'online',
        };
    }

    // 没有日程 → 默认 online
    if (!schedule || !schedule.slots || schedule.slots.length === 0) {
        return { status: 'online', msUntilChange: Infinity };
    }

    const time = char ? getScheduleWallClock(char, now) : (now || new Date());
    const currentMinutes = time.getHours() * 60 + time.getMinutes();
    const currentMs = time.getHours() * 3600000 + time.getMinutes() * 60000 + time.getSeconds() * 1000;

    // 找到当前 slot 和下一个 slot
    let currentSlotIndex = -1;
    for (let i = schedule.slots.length - 1; i >= 0; i--) {
        const [h, m] = schedule.slots[i].startTime.split(':').map(Number);
        if (currentMinutes >= h * 60 + m) {
            currentSlotIndex = i;
            break;
        }
    }

    // 还没到第一个 slot（凌晨~第一个 slot 之前）
    // 继承当天最后一个 slot 的状态：如果最后是睡觉(offline)，凌晨也算 offline
    if (currentSlotIndex === -1) {
        const firstSlot = schedule.slots[0];
        const [fh, fm] = firstSlot.startTime.split(':').map(Number);
        const firstSlotMs = fh * 3600000 + fm * 60000;
        const lastSlot = schedule.slots[schedule.slots.length - 1];
        const lastSlotAvail = getSlotAvailability(lastSlot);
        return {
            status: lastSlotAvail,
            currentActivity: lastSlot.activity,
            currentEmoji: lastSlot.emoji,
            msUntilChange: firstSlotMs - currentMs,
            nextStatus: getSlotAvailability(firstSlot),
        };
    }

    const currentSlot = schedule.slots[currentSlotIndex];
    const status = getSlotAvailability(currentSlot);

    // 计算到下一个 slot 的时间
    const nextSlot = currentSlotIndex < schedule.slots.length - 1
        ? schedule.slots[currentSlotIndex + 1]
        : null;

    let msUntilChange: number;
    let nextStatus: CharAvailability | undefined;

    if (nextSlot) {
        const [nh, nm] = nextSlot.startTime.split(':').map(Number);
        const nextSlotMs = nh * 3600000 + nm * 60000;
        msUntilChange = nextSlotMs - currentMs;
        nextStatus = getSlotAvailability(nextSlot);
    } else {
        // 最后一个 slot → 到午夜
        const midnightMs = 24 * 3600000;
        msUntilChange = midnightMs - currentMs;
    }

    // 确保至少 1 秒（防止负数或零）
    msUntilChange = Math.max(msUntilChange, 1000);

    return {
        status,
        currentActivity: currentSlot.activity,
        currentEmoji: currentSlot.emoji,
        msUntilChange,
        nextStatus,
    };
}
