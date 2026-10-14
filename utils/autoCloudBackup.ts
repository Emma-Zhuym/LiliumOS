/**
 * 云端自动备份（EM 独有）。
 *
 * 原来云端备份只能手点，2026-10 一次 PWA 打不开差点丢了两天数据。现在：
 *   - App 启动或回到前台时，若已连好云端备份、距上次成功备份超过 24 小时，就在后台静默
 *     备份一次（纯文字，体积小）。失败不打扰，至少隔 1 小时再试。
 *   - 超过 3 天没成功备份，一天最多提醒一次（普通提示条，不弹窗）。
 *
 * 自动备份的文件名带 `_auto_`，清理时跟手动备份分开数：自动的留最近 7 份，手动的留最近 5 份，
 * 每天一份的自动备份不会把阿萌手点的完整备份挤掉。
 *
 * 上次成功时间沿用 cloudBackupConfig.lastBackupTime（手动备份也会更新它）；
 * 自动备份自己的尝试记录放 localStorage，不进完整备份。
 */
import type { CloudBackupConfig, CloudBackupFile } from '../types';

export const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTO_BACKUP_RETRY_MS = 60 * 60 * 1000;
export const BACKUP_STALE_WARN_MS = 3 * 24 * 60 * 60 * 1000;
export const STALE_NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 启动 / 回前台后先等一会，别跟开机加载抢 IndexedDB 和网络。 */
export const AUTO_BACKUP_DELAY_MS = 30_000;
export const AUTO_BACKUP_KEEP = 7;
export const MANUAL_BACKUP_KEEP = 5;

const STATE_KEY = 'em_auto_cloud_backup_v1';
const AUTO_MARKER = '_auto_';

export interface AutoBackupState {
    lastAttemptAt?: number;
    lastError?: string;
    lastErrorAt?: number;
    lastStaleNoticeAt?: number;
}

export function readAutoBackupState(): AutoBackupState {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        return raw ? JSON.parse(raw) as AutoBackupState : {};
    } catch {
        return {};
    }
}

export function writeAutoBackupState(patch: Partial<AutoBackupState>): AutoBackupState {
    const next = { ...readAutoBackupState(), ...patch };
    try { localStorage.setItem(STATE_KEY, JSON.stringify(next)); } catch { /* 写不进就下次再算 */ }
    return next;
}

/** 已连好、凭据齐全才算配置了云端备份。 */
export function isCloudBackupConfigured(config: CloudBackupConfig): boolean {
    if (!config.enabled) return false;
    if (config.provider === 'github') return Boolean(config.githubToken && config.githubOwner);
    return Boolean(config.webdavUrl && config.username && config.password);
}

export function shouldRunAutoBackup(config: CloudBackupConfig, state: AutoBackupState, now: number): boolean {
    if (!isCloudBackupConfigured(config)) return false;
    if (config.lastBackupTime && now - config.lastBackupTime < AUTO_BACKUP_INTERVAL_MS) return false;
    if (state.lastAttemptAt && now - state.lastAttemptAt < AUTO_BACKUP_RETRY_MS) return false;
    return true;
}

/** 超过 3 天没成功备份时返回天数；从没备份过返回 Infinity；没超或没配置返回 null。 */
export function staleBackupDays(config: CloudBackupConfig, now: number): number | null {
    if (!isCloudBackupConfigured(config)) return null;
    if (!config.lastBackupTime) return Infinity;
    const age = now - config.lastBackupTime;
    return age > BACKUP_STALE_WARN_MS ? Math.floor(age / (24 * 60 * 60 * 1000)) : null;
}

export function shouldShowStaleNotice(config: CloudBackupConfig, state: AutoBackupState, now: number): boolean {
    if (staleBackupDays(config, now) === null) return false;
    return !state.lastStaleNoticeAt || now - state.lastStaleNoticeAt >= STALE_NOTICE_INTERVAL_MS;
}

export function autoBackupFilename(now: number): string {
    return `Sully_Backup${AUTO_MARKER}text_only_${now}.zip`;
}

export function isAutoBackupName(name: string): boolean {
    return name.includes(AUTO_MARKER);
}

const backupTimeOf = (file: CloudBackupFile): number => {
    const fromName = /_(\d{12,})(?:\.part\d+of\d+)?\.zip$/i.exec(file.name);
    if (fromName) return Number(fromName[1]);
    const parsed = Date.parse(file.lastModified || '');
    return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * 自动 / 手动分开数，各留最近几份，其余返回待删。上传不完整的不算也不删
 * （GitHub 那边留着给人手动处理）。
 */
export function pickBackupsToDelete(
    files: CloudBackupFile[],
    keep: { auto: number; manual: number } = { auto: AUTO_BACKUP_KEEP, manual: MANUAL_BACKUP_KEEP },
): CloudBackupFile[] {
    const ready = files.filter(f => f.status !== 'incomplete');
    const newestFirst = (list: CloudBackupFile[]) => [...list].sort((a, b) => backupTimeOf(b) - backupTimeOf(a));
    const auto = newestFirst(ready.filter(f => isAutoBackupName(f.name)));
    const manual = newestFirst(ready.filter(f => !isAutoBackupName(f.name)));
    return [...auto.slice(keep.auto), ...manual.slice(keep.manual)];
}

export interface BackupProvider {
    uploadBackup: (config: CloudBackupConfig, blob: Blob, filename: string) => Promise<{ ok: boolean; message: string }>;
    listBackups: (config: CloudBackupConfig) => Promise<CloudBackupFile[]>;
    deleteBackup: (config: CloudBackupConfig, file: CloudBackupFile) => Promise<boolean>;
}

export async function loadBackupProvider(config: CloudBackupConfig): Promise<BackupProvider> {
    return config.provider === 'github'
        ? await import('./githubClient')
        : await import('./webdavClient');
}

/** 清理旧备份（手动备份和自动备份都走这里）。失败不影响备份本身。 */
export async function pruneCloudBackups(provider: BackupProvider, config: CloudBackupConfig): Promise<number> {
    const toDelete = pickBackupsToDelete(await provider.listBackups(config));
    let deleted = 0;
    for (const file of toDelete) {
        if (await provider.deleteBackup(config, file)) deleted++;
    }
    return deleted;
}

export type AutoBackupResult = { ok: true; size: number; at: number } | { ok: false; error: string };

/** 跑一次静默备份：打包纯文字 → 上传 → 清理。不弹任何提示，结果交给调用方。 */
export async function runAutoCloudBackup(opts: {
    config: CloudBackupConfig;
    exportTextBackup: () => Promise<Blob>;
    provider?: BackupProvider;
    now?: () => number;
}): Promise<AutoBackupResult> {
    const now = opts.now ?? Date.now;
    writeAutoBackupState({ lastAttemptAt: now() });
    try {
        const provider = opts.provider ?? await loadBackupProvider(opts.config);
        const blob = await opts.exportTextBackup();
        const result = await provider.uploadBackup(opts.config, blob, autoBackupFilename(now()));
        if (!result.ok) throw new Error(result.message || '上传失败');
        const at = now();
        writeAutoBackupState({ lastError: undefined, lastErrorAt: undefined });
        await pruneCloudBackups(provider, opts.config).catch(() => 0);
        return { ok: true, size: blob.size, at };
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        writeAutoBackupState({ lastError: error, lastErrorAt: now() });
        return { ok: false, error };
    }
}
