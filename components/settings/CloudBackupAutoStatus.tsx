// [EM-START: auto-cloud-backup]
import React from 'react';
import type { CloudBackupConfig } from '../../types';
import { F, R, STATUS } from '../../utils/clayTokens';
import { readAutoBackupState, staleBackupDays } from '../../utils/autoCloudBackup';

/** 设置 → 云端备份：上次成功备份时间、自动备份失败原因、超过 3 天没成功时的提醒。 */
export default function CloudBackupAutoStatus({ config }: { config: CloudBackupConfig }) {
    const now = Date.now();
    const state = readAutoBackupState();
    const stale = staleBackupDays(config, now);
    const lastOk = config.lastBackupTime;
    const failedSinceLastOk = Boolean(state.lastError && state.lastErrorAt && (!lastOk || state.lastErrorAt > lastOk));

    return <div className="space-y-2">
        <div className="text-center text-xs leading-5" style={{ color: F.textSecondary }}>
            <p>
                {lastOk
                    ? <>上次成功备份：{new Date(lastOk).toLocaleString('zh-CN')}{config.lastBackupSize ? `（${(config.lastBackupSize / 1024 / 1024).toFixed(1)} MB）` : ''}</>
                    : '还没有成功备份过'}
            </p>
            <p style={{ color: F.textTertiary }}>自动备份：每天打开 App 时备份一次纯文字，失败会稍后再试</p>
        </div>
        {(stale !== null || failedSinceLastOk) && <div role="status" className="px-3 py-2 text-xs leading-5"
            style={{ background: STATUS.warning.tint, color: STATUS.warning.ink, borderRadius: R.smallCard }}>
            {stale !== null && <p>{stale === Infinity ? '云端备份还没成功过，建议现在手动备份一次。' : `已经 ${stale} 天没有成功备份了，建议现在手动备份一次。`}</p>}
            {failedSinceLastOk && <p className="break-words">自动备份上次没成功：{state.lastError}</p>}
        </div>}
    </div>;
}
// [EM-END: auto-cloud-backup]
