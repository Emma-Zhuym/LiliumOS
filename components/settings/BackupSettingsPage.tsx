// [EM-START: settings-subpages-f]
/**
 * 设置 → 备份与恢复。原来两大块彩色卡片展开两屏，现在分成：状态卡 / 云端 / 这台手机上的文件 /
 * 视频模型 / 提醒和清理 / 格式化。样稿 docs/design/settings-subpages-mock.html。
 *
 * 只管长相：导出、导入、云端备份、恢复、模型包这些动作和它们的弹窗都还在 apps/Settings.tsx 里，从 props 进来。
 */

import React from 'react';
import type { CloudBackupConfig } from '../../types';
import type { AvatarModelBackupInventory, AvatarModelBackupProgress } from '../../utils/avatarModelBackup';
import { readAutoBackupState, staleBackupDays, AUTO_BACKUP_KEEP, MANUAL_BACKUP_KEEP } from '../../utils/autoCloudBackup';
import { relativeAgo } from '../../utils/emSettingsPages';
import { F, R, STATUS } from '../../utils/clayTokens';
import { SETTINGS_HUE } from './SettingsHome';
import { Group, Hero, HeroAction, Page, Row, Stepper, ToggleRow } from './SettingsParts';

export interface BackupSettingsPageProps {
    cloud: CloudBackupConfig;
    onCloudBackup: (mode: 'text_only' | 'full') => void;
    onOpenCloudRestore: () => void;
    onEditGithub: () => void;
    onEditWebdav: () => void;
    onSwitchToGithub: () => void;
    onSwitchToWebdav: () => void;
    onExport: (mode: 'text_only' | 'media_only' | 'full') => void;
    onPickImportFile: () => void;
    exportBackendConnection: boolean;
    setExportBackendConnection: (on: boolean) => void;
    models: AvatarModelBackupInventory | null;
    modelBusy: boolean;
    modelProgress: AvatarModelBackupProgress | null;
    onExportModels: () => void;
    onPickModelFiles: () => void;
    reminderDays: number;
    reminderMin: number;
    reminderMax: number;
    onReminderDays: (days: number) => void;
    daysSinceExport: number | null;
    cleaningResidue: boolean;
    onCleanupResidue: () => void;
    onReset: () => void;
    formatBytes: (bytes: number) => string;
}

const mb = (bytes?: number) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '');

const BackupSettingsPage: React.FC<BackupSettingsPageProps> = p => {
    const now = Date.now();
    const cloud = p.cloud;
    const github = cloud.provider === 'github';
    const auto = readAutoBackupState();
    const stale = staleBackupDays(cloud, now);
    const failed = Boolean(auto.lastError && auto.lastErrorAt && (!cloud.lastBackupTime || auto.lastErrorAt > cloud.lastBackupTime));
    const where = github
        ? (cloud.githubOwner ? `@${cloud.githubOwner} / ${cloud.githubRepo || 'sully-backup'}` : 'GitHub')
        : (cloud.webdavUrl ? cloud.webdavUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'WebDAV');

    const heroTitle = !cloud.enabled ? '云端备份没开'
        : cloud.lastBackupTime ? `上次备份 ${relativeAgo(cloud.lastBackupTime, now)}` : '云端还没备份成功过';
    const heroSub = !cloud.enabled
        ? '数据只在这台手机上。接上 GitHub 或 WebDAV，每天会自动备一份'
        : [cloud.lastBackupTime && new Date(cloud.lastBackupTime).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), mb(cloud.lastBackupSize), github ? 'GitHub' : 'WebDAV'].filter(Boolean).join(' · ');
    const percent = p.modelProgress ? Math.min(100, Math.round((p.modelProgress.done / Math.max(1, p.modelProgress.total)) * 100)) : 0;

    return (
        <Page testId="settings-backup-page">
            <Hero title={heroTitle} sub={heroSub}
                dot={cloud.enabled && (stale !== null || failed) ? 'bad' : null}
                actions={cloud.enabled ? <HeroAction onClick={() => p.onCloudBackup('text_only')}>立即备份</HeroAction> : undefined} />

            {cloud.enabled && (stale !== null || failed) && (
                <div role="status" style={{ background: STATUS.warning.tint, color: STATUS.warning.ink, borderRadius: R.smallCard, padding: '10px 14px', fontSize: 13, lineHeight: '20px' }}>
                    {stale !== null && <p style={{ margin: 0 }}>{stale === Infinity ? '云端备份还没成功过，现在手动备一次吧。' : `已经 ${stale} 天没备份成功了，现在手动备一次吧。`}</p>}
                    {failed && <p className="break-words" style={{ margin: 0 }}>自动备份上次没成功：{auto.lastError}</p>}
                </div>
            )}

            {cloud.enabled ? (
                <Group title={github ? '云端 · GitHub' : '云端 · WebDAV'}
                    foot={`每天打开 App 时自动备一份纯文字，留最近 ${AUTO_BACKUP_KEEP} 份；手点的另留 ${MANUAL_BACKUP_KEEP} 份。${cloud.githubUseProxy ? '现在走中转：凭据和备份会经过中转服务。' : ''}`}>
                    <Row title="存在哪" value={where} onClick={github ? p.onEditGithub : p.onEditWebdav} />
                    <Row title="备份完整的一份" sub="含图片和美化素材，比较大" tone="link" onClick={() => p.onCloudBackup('full')} />
                    <Row title="从云端恢复" onClick={p.onOpenCloudRestore} />
                    {github && cloud.githubOwner && (
                        <Row title="在 GitHub 上看" tone="link" href={`https://github.com/${cloud.githubOwner}/${cloud.githubRepo || 'sully-backup'}`} />
                    )}
                    {github
                        ? <Row title={cloud.webdavUrl ? '切回 WebDAV' : '改用 WebDAV'} tone="link" onClick={p.onSwitchToWebdav} />
                        : <Row title={cloud.githubToken ? '切到 GitHub' : '改用 GitHub'} sub="分片上传，大备份也传得上去；WebDAV 上的旧备份不动" tone="link" onClick={p.onSwitchToGithub} />}
                </Group>
            ) : (
                <Group title="接上云端" foot="备份存在你自己的账号下。">
                    <Row title="GitHub" sub="私有仓库，大备份分片传" onClick={p.onEditGithub} />
                    <Row title="WebDAV" sub="坚果云、NAS 这类" onClick={p.onEditWebdav} />
                </Group>
            )}

            <Group title="这台手机上的文件"
                foot={p.exportBackendConnection
                    ? '开着导出的文件别分享给别人：拿到的人能连上你那台 Worker，也能解开里面的聊天记录。'
                    : `只导出文字时图片全去掉，文件小很多；旧版 JSON 备份也能导入。${p.daysSinceExport == null ? '' : ` 上次导出是 ${p.daysSinceExport} 天前。`}`}
                footTone={p.exportBackendConnection ? 'danger' : 'plain'}>
                <Row title="导出完整 ZIP" sub="文字 + 图片；视频模型在下面单独导" tone="link" onClick={() => p.onExport('full')} />
                <Row title="只导出文字" tone="link" onClick={() => p.onExport('text_only')} />
                <Row title="只导出图片与美化素材" sub="相册、表情包、头像、气泡、壁纸、图标" tone="link" onClick={() => p.onExport('media_only')} />
                <Row title="从文件恢复" value=".zip / .json" onClick={p.onPickImportFile} />
                <ToggleRow title="带上主动消息 2.0 的连接" sub="换手机恢复时才打开（云端备份一直带着）" checked={p.exportBackendConnection} onChange={p.setExportBackendConnection} />
            </Group>

            <Group title="视频模型（VRM / Live2D）" testId="avatar-model-backup-section"
                foot={p.models && p.models.missingCount > 0
                    ? `有 ${p.models.missingCount} 个角色只剩模型索引，文件已经丢了，导不出来。`
                    : '模型太大，不跟普通备份走。恢复时先导普通数据，再导模型包；一次选几个包会按顺序导。'}
                footTone={p.models && p.models.missingCount > 0 ? 'danger' : 'plain'}>
                <Row title="本机有" value={p.models ? `${p.models.availableCount} 个 · ${p.formatBytes(p.models.totalBytes)}` : '正在数…'} />
                {p.models?.models.map(m => (
                    <Row key={m.characterId} title={m.characterName} sub={`${m.format} · ${m.fileName}`}
                        value={m.available ? p.formatBytes(m.byteLength) : '文件缺失'} valueTone={m.available ? 'plain' : 'bad'} />
                ))}
                <Row title="导出模型包" tone="link" disabled={p.modelBusy || !p.models?.availableCount} onClick={p.onExportModels} />
                <Row title="导入模型包" tone="link" disabled={p.modelBusy} onClick={p.onPickModelFiles} />
                {p.modelProgress && (
                    <div aria-live="polite" style={{ padding: '10px 14px 12px' }}>
                        <div className="flex justify-between" style={{ fontSize: 12, color: F.textSecondary, marginBottom: 6, gap: 12 }}>
                            <span className="truncate">{p.modelProgress.label}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{percent}%</span>
                        </div>
                        <div style={{ height: 6, borderRadius: R.pill, background: F.surfaceSunken, overflow: 'hidden' }}>
                            <div style={{ width: `${percent}%`, height: '100%', borderRadius: R.pill, background: SETTINGS_HUE.main, transition: 'width 200ms' }} />
                        </div>
                    </div>
                )}
            </Group>

            <Group>
                <Row title="备份提醒" sub="超过这么久没导出就提醒一次"
                    right={<Stepper value={`每 ${p.reminderDays} 天`} decLabel="少一天" incLabel="多一天"
                        decDisabled={p.reminderDays <= p.reminderMin} incDisabled={p.reminderDays >= p.reminderMax}
                        onDec={() => p.onReminderDays(Math.max(p.reminderMin, p.reminderDays - 1))}
                        onInc={() => p.onReminderDays(Math.min(p.reminderMax, p.reminderDays + 1))} />} />
                <Row title={p.cleaningResidue ? '正在扫描…' : '清理表情包残留'} sub="删掉的角色留下的表情分类，先列出来再删" tone="link"
                    disabled={p.cleaningResidue} onClick={p.onCleanupResidue} />
            </Group>

            <Group foot="清空这台手机上所有角色、聊天和设置。点了会再问你一次。">
                <Row title="格式化系统（出厂设置）" tone="danger" onClick={p.onReset} />
            </Group>
        </Page>
    );
};

export default BackupSettingsPage;
// [EM-END: settings-subpages-f]
