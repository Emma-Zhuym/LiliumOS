// [EM-START: settings-subpages-f]
/**
 * 实时感知 / 日记同步 / 小红书三页共用的那份 RealtimeConfig：改了就存，不再有「保存配置」按钮。
 *
 * - 开关、分段、小圆片点了立刻存；输入框离开时（或退出这一页时）存一次（FieldRow 管）
 * - 存完清 RealtimeContextManager 缓存；往云端推（amsg 工具配置 + 提示词）攒 800ms 一起推，
 *   退出页面时把攒着的立刻推掉——角色到点会照着云端那份提示词调工具，不能留旧的
 */

import { useCallback, useEffect, useRef } from 'react';
import { useOS } from '../../context/OSContext';
import type { RealtimeConfig } from '../../types';
import { RealtimeContextManager } from '../../utils/realtimeContext';
import { syncAmsgToolConfigAndPrompts } from '../../utils/amsgStateSync';

const SYNC_DELAY_MS = 800;

export function useRealtimeSettings() {
    const { realtimeConfig, updateRealtimeConfig, characters, userProfile, groups, addToast } = useOS();
    const latest = useRef<RealtimeConfig>(realtimeConfig);
    const scope = useRef({ characters, userProfile, groups });
    scope.current = { characters, userProfile, groups };
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { latest.current = realtimeConfig; }, [realtimeConfig]);

    const flush = useCallback(() => {
        if (!timer.current) return;
        clearTimeout(timer.current);
        timer.current = null;
        syncAmsgToolConfigAndPrompts(latest.current, scope.current);
    }, []);

    useEffect(() => flush, [flush]);

    const commit = useCallback((updates: Partial<RealtimeConfig>) => {
        const next = { ...latest.current, ...updates };
        latest.current = next;
        updateRealtimeConfig(next); // 整份传过去：OSContext 那边是拿闭包里的旧配置去合并的，连着改两下会丢前一下
        RealtimeContextManager.clearCache();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; syncAmsgToolConfigAndPrompts(latest.current, scope.current); }, SYNC_DELAY_MS);
    }, [updateRealtimeConfig]);

    return { config: realtimeConfig, commit, latest, addToast };
}
// [EM-END: settings-subpages-f]
