/**
 * 启动 / 回前台时按需静默云端备份，规则见 utils/autoCloudBackup.ts。
 * 挂在 OSContext 里（[EM: auto-cloud-backup]），整个 App 只有一份。
 */
import { useEffect, useRef } from 'react';
import type { CloudBackupConfig } from '../types';
import {
    AUTO_BACKUP_DELAY_MS,
    readAutoBackupState,
    runAutoCloudBackup,
    shouldRunAutoBackup,
    shouldShowStaleNotice,
    staleBackupDays,
    writeAutoBackupState,
} from '../utils/autoCloudBackup';

export function useAutoCloudBackup(opts: {
    config: CloudBackupConfig;
    exportTextBackup: () => Promise<Blob>;
    onSuccess: (result: { at: number; size: number }) => void;
    /** 手动备份 / 恢复正在跑时别插进去。 */
    isBusy: () => boolean;
    notify: (message: string) => void;
}) {
    const latest = useRef(opts);
    latest.current = opts;
    const running = useRef(false);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        const check = async () => {
            timer = null;
            const { config, exportTextBackup, isBusy } = latest.current;
            if (document.visibilityState !== 'visible' || running.current || isBusy()) return;

            let effective = config;
            if (navigator.onLine !== false && shouldRunAutoBackup(config, readAutoBackupState(), Date.now())) {
                running.current = true;
                try {
                    const result = await runAutoCloudBackup({ config, exportTextBackup });
                    if (result.ok) {
                        // 备份要跑一阵，期间配置可能被改过，用最新那份回写。
                        latest.current.onSuccess(result);
                        effective = { ...config, lastBackupTime: result.at };
                    } else {
                        console.warn('[AutoCloudBackup] 自动备份失败，稍后再试:', result.error);
                    }
                } finally {
                    running.current = false;
                }
            }

            const now = Date.now();
            if (shouldShowStaleNotice(effective, readAutoBackupState(), now)) {
                const days = staleBackupDays(effective, now);
                writeAutoBackupState({ lastStaleNoticeAt: now });
                latest.current.notify(days === Infinity
                    ? '云端备份还没成功过，可以去 设置 → 云端备份 看看'
                    : `已经 ${days} 天没有成功云端备份了，可以去 设置 → 云端备份 看看`);
            }
        };

        const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { void check(); }, AUTO_BACKUP_DELAY_MS);
        };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') schedule();
            else if (timer) { clearTimeout(timer); timer = null; }
        };

        if (document.visibilityState === 'visible') schedule();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            if (timer) clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);
}
