import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudBackupConfig, CloudBackupFile } from '../types';
import {
    AUTO_BACKUP_INTERVAL_MS,
    AUTO_BACKUP_RETRY_MS,
    autoBackupFilename,
    pickBackupsToDelete,
    readAutoBackupState,
    runAutoCloudBackup,
    shouldRunAutoBackup,
    shouldShowStaleNotice,
    staleBackupDays,
    type BackupProvider,
} from './autoCloudBackup';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

const webdav: CloudBackupConfig = {
    enabled: true, webdavUrl: 'https://dav.example/dav/', username: 'u', password: 'p', remotePath: '/SullyBackup/',
};
const github: CloudBackupConfig = {
    enabled: true, provider: 'github', githubToken: 't', githubOwner: 'o',
    webdavUrl: '', username: '', password: '', remotePath: '',
};

const file = (name: string, extra: Partial<CloudBackupFile> = {}): CloudBackupFile => ({
    name, size: 1, lastModified: '', href: name, ...extra,
});

beforeEach(() => { localStorage.clear(); });

describe('shouldRunAutoBackup', () => {
    it('没配置 / 没开不跑', () => {
        expect(shouldRunAutoBackup({ ...webdav, enabled: false }, {}, NOW)).toBe(false);
        expect(shouldRunAutoBackup({ ...webdav, password: '' }, {}, NOW)).toBe(false);
        expect(shouldRunAutoBackup({ ...github, githubToken: undefined }, {}, NOW)).toBe(false);
    });

    it('从没备份过就跑；24 小时内成功过不跑', () => {
        expect(shouldRunAutoBackup(webdav, {}, NOW)).toBe(true);
        expect(shouldRunAutoBackup(github, {}, NOW)).toBe(true);
        expect(shouldRunAutoBackup({ ...webdav, lastBackupTime: NOW - AUTO_BACKUP_INTERVAL_MS + 1000 }, {}, NOW)).toBe(false);
        expect(shouldRunAutoBackup({ ...webdav, lastBackupTime: NOW - AUTO_BACKUP_INTERVAL_MS - 1000 }, {}, NOW)).toBe(true);
    });

    it('刚失败过一小时内不重试', () => {
        const stale = { ...webdav, lastBackupTime: NOW - 2 * DAY };
        expect(shouldRunAutoBackup(stale, { lastAttemptAt: NOW - AUTO_BACKUP_RETRY_MS + 1000 }, NOW)).toBe(false);
        expect(shouldRunAutoBackup(stale, { lastAttemptAt: NOW - AUTO_BACKUP_RETRY_MS - 1000 }, NOW)).toBe(true);
    });
});

describe('超过 3 天提醒', () => {
    it('3 天内不提醒，超过给天数，从没成功过给 Infinity', () => {
        expect(staleBackupDays({ ...webdav, lastBackupTime: NOW - 2 * DAY }, NOW)).toBeNull();
        expect(staleBackupDays({ ...webdav, lastBackupTime: NOW - 4 * DAY - 1000 }, NOW)).toBe(4);
        expect(staleBackupDays(webdav, NOW)).toBe(Infinity);
        expect(staleBackupDays({ ...webdav, enabled: false }, NOW)).toBeNull();
    });

    it('一天最多提醒一次', () => {
        const stale = { ...webdav, lastBackupTime: NOW - 5 * DAY };
        expect(shouldShowStaleNotice(stale, {}, NOW)).toBe(true);
        expect(shouldShowStaleNotice(stale, { lastStaleNoticeAt: NOW - DAY / 2 }, NOW)).toBe(false);
        expect(shouldShowStaleNotice(stale, { lastStaleNoticeAt: NOW - DAY }, NOW)).toBe(true);
    });
});

describe('pickBackupsToDelete', () => {
    it('自动和手动分开数，自动的再多也不挤掉手动的完整备份', () => {
        const autos = Array.from({ length: 10 }, (_, i) => file(autoBackupFilename(NOW - i * DAY)));
        const manual = [
            file(`Sully_Backup_full_${NOW - 30 * DAY}.zip`),
            file(`Sully_Backup_text_only_${NOW - 40 * DAY}.zip`),
        ];
        const toDelete = pickBackupsToDelete([...manual, ...autos], { auto: 7, manual: 5 });
        expect(toDelete.map(f => f.name)).toEqual(autos.slice(7).map(f => f.name));
    });

    it('手动的按时间留最新 5 份（不按名字排，full / text_only 混着也对）', () => {
        const names = [1, 2, 3, 4, 5, 6, 7].map(i => `Sully_Backup_${i % 2 ? 'full' : 'text_only'}_${NOW - i * DAY}.zip`);
        const toDelete = pickBackupsToDelete(names.map(n => file(n)), { auto: 7, manual: 5 });
        expect(toDelete.map(f => f.name).sort()).toEqual(names.slice(5).sort());
    });

    it('上传不完整的不算也不删', () => {
        const files = [
            file(autoBackupFilename(NOW), { status: 'incomplete' }),
            file(autoBackupFilename(NOW - DAY)),
        ];
        expect(pickBackupsToDelete(files, { auto: 0, manual: 5 }).map(f => f.name)).toEqual([autoBackupFilename(NOW - DAY)]);
    });
});

describe('runAutoCloudBackup', () => {
    const makeProvider = (overrides: Partial<BackupProvider> = {}): BackupProvider => ({
        uploadBackup: vi.fn(async () => ({ ok: true, message: '' })),
        listBackups: vi.fn(async () => []),
        deleteBackup: vi.fn(async () => true),
        ...overrides,
    });

    it('成功：带 _auto_ 文件名上传，返回大小和时间，清掉失败记录', async () => {
        localStorage.setItem('em_auto_cloud_backup_v1', JSON.stringify({ lastError: 'old', lastErrorAt: 1 }));
        const provider = makeProvider();
        const result = await runAutoCloudBackup({
            config: webdav, provider, now: () => NOW,
            exportTextBackup: async () => new Blob(['hello']),
        });
        expect(result).toEqual({ ok: true, size: 5, at: NOW });
        expect(provider.uploadBackup).toHaveBeenCalledWith(webdav, expect.any(Blob), `Sully_Backup_auto_text_only_${NOW}.zip`);
        expect(readAutoBackupState()).toMatchObject({ lastAttemptAt: NOW });
        expect(readAutoBackupState().lastError).toBeUndefined();
    });

    it('上传失败：不抛错，记下原因和尝试时间', async () => {
        const provider = makeProvider({ uploadBackup: vi.fn(async () => ({ ok: false, message: '401 凭据失效' })) });
        const result = await runAutoCloudBackup({
            config: webdav, provider, now: () => NOW,
            exportTextBackup: async () => new Blob(['x']),
        });
        expect(result).toEqual({ ok: false, error: '401 凭据失效' });
        expect(readAutoBackupState()).toMatchObject({ lastAttemptAt: NOW, lastError: '401 凭据失效', lastErrorAt: NOW });
    });

    it('打包失败也一样不抛错', async () => {
        const result = await runAutoCloudBackup({
            config: webdav, provider: makeProvider(), now: () => NOW,
            exportTextBackup: async () => { throw new Error('IndexedDB 打不开'); },
        });
        expect(result).toEqual({ ok: false, error: 'IndexedDB 打不开' });
    });

    it('清理失败不影响备份成功', async () => {
        const provider = makeProvider({ listBackups: vi.fn(async () => { throw new Error('PROPFIND 失败'); }) });
        const result = await runAutoCloudBackup({
            config: webdav, provider, now: () => NOW,
            exportTextBackup: async () => new Blob(['x']),
        });
        expect(result.ok).toBe(true);
    });
});
