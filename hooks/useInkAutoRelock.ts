/**
 * 回前台时按需把墨线窗锁屏锁回去，规则见 utils/inkAutoRelock.ts。
 * 挂在 OSContext 里（[EM: ink-window-lock]），整个 App 只有一份。
 */
import { useEffect, useRef } from 'react';
import { shouldInkRelock } from '../utils/inkAutoRelock';

export function useInkAutoRelock(opts: { enabled: boolean; isLocked: boolean; lock: () => void }) {
    const latest = useRef(opts);
    latest.current = opts;

    useEffect(() => {
        let hiddenAt: number | null = null;
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                hiddenAt = Date.now();
                return;
            }
            const { enabled, isLocked, lock } = latest.current;
            if (shouldInkRelock({ enabled, isLocked, hiddenAt, now: Date.now() })) lock();
            hiddenAt = null;
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);
}
