/**
 * useCharStatus.ts — 角色在线状态 hook
 *
 * EM 独有功能。根据角色日程自动计算 online/busy/offline，
 * 并在时段边界精确切换（不轮询）。
 *
 * 用法：
 *   const { status, activity, emoji } = useCharStatus(schedule);
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CharacterProfile, DailySchedule } from '../types';
import { computeCharStatus, CharAvailability } from '../utils/charStatus';

interface UseCharStatusReturn {
    status: CharAvailability;
    activity?: string;
    emoji?: string;
}

export function useCharStatus(schedule: DailySchedule | null, char?: CharacterProfile | null): UseCharStatusReturn {
    const [status, setStatus] = useState<CharAvailability>('online');
    const [activity, setActivity] = useState<string | undefined>();
    const [emoji, setEmoji] = useState<string | undefined>();
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const updateStatus = useCallback(() => {
        const result = computeCharStatus(schedule, undefined, char);
        setStatus(result.status);
        setActivity(result.currentActivity);
        setEmoji(result.currentEmoji);

        // 清旧定时器
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        // 设新定时器：精确到下一个 slot 边界
        if (result.msUntilChange !== Infinity && result.msUntilChange > 0) {
            // 浏览器 setTimeout 最大约 24.8 天，日程最多到午夜，不会溢出
            timerRef.current = setTimeout(() => {
                updateStatus(); // 递归：到点了重新计算
            }, result.msUntilChange);
        }
    }, [schedule, char]);

    // schedule 变化时重新计算
    useEffect(() => {
        updateStatus();
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [updateStatus]);

    // 页面切回前台时立即重算（补偿浏览器暂停定时器的情况）
    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                updateStatus();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [updateStatus]);

    return { status, activity, emoji };
}
