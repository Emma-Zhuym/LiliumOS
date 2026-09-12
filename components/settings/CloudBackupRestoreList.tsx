// [EM-START: cloud-backup-status-clay]
import React from 'react';
import { CloudArrowDown } from '@phosphor-icons/react';
import type { CloudBackupFile } from '../../types';
import { F, R, S, STATUS } from '../../utils/clayTokens';

export type CloudBackupListState = 'idle' | 'loading' | 'ready' | 'error';

export default function CloudBackupRestoreList({ state, error, files, onRetry, onRestore, githubReleasesUrl }: {
    state: CloudBackupListState;
    error: string;
    files: CloudBackupFile[];
    onRetry: () => void;
    onRestore: (file: CloudBackupFile) => void;
    githubReleasesUrl?: string;
}) {
    if (state !== 'ready' || !files.length) return <div role={state === 'error' ? 'alert' : 'status'} className="flex min-h-40 flex-col items-center justify-center gap-3 p-5 text-center" style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, color: F.textSecondary }}>
        <CloudArrowDown size={18} weight="bold" />
        <p className="text-sm">{state === 'error' ? '云端备份列表读取失败' : state === 'ready' ? '还没有云端备份' : '正在读取云端备份…'}</p>
        {state === 'error' && <><p className="break-words text-xs leading-5">{error || '请检查连接后重试'}</p><button type="button" onClick={onRetry} className="min-h-11 px-5 text-xs font-semibold" style={{ background: F.surface, color: F.textPrimary, borderRadius: R.button, boxShadow: S.raisedSoft }}>重新读取</button></>}
    </div>;
    return <div style={{ color: F.textPrimary }}>
        <p className="mb-3 text-xs" style={{ color: F.textSecondary }}>选择要恢复的备份。上传不完整的文件暂时不能恢复。</p>
        <div className="max-h-[50vh] overflow-y-auto px-4" style={{ background: F.surface, borderRadius: R.bigCard, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
            {files.map((file, index) => <div key={`${file.href}:${file.name}`} className="py-3" style={{ borderTop: index ? `1px solid ${F.divider}` : undefined }}>
                <button type="button" disabled={file.status === 'incomplete'} onClick={() => onRestore(file)} className="min-h-16 w-full text-left disabled:cursor-default">
                    <p className="break-words text-sm font-semibold">{file.name}</p>
                    <p className="mt-1 text-xs" style={{ color: F.textTertiary }}>{file.lastModified ? new Date(file.lastModified).toLocaleString('zh-CN') : '未知时间'}{file.size > 0 ? ` · ${(file.size / 1024 / 1024).toFixed(1)} MB` : ''}</p>
                    {file.status === 'incomplete' && <span className="mt-2 inline-block px-2 py-1 text-xs" style={{ background: STATUS.warning.tint, color: STATUS.warning.ink, borderRadius: R.tiny }}>上传不完整</span>}
                </button>
                {file.status === 'incomplete' && <div className="mt-1 text-xs leading-5" style={{ color: F.textSecondary }}>
                    <p className="break-words">{file.statusMessage || '部分附件缺失或尚未上传完成，请重新备份。'}</p>
                    {githubReleasesUrl && <a href={githubReleasesUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">在 GitHub 查看备份</a>}
                </div>}
            </div>)}
        </div>
    </div>;
}
// [EM-END: cloud-backup-status-clay]
