// [EM-START: github-backup-route-clay]
import React from 'react';
import { F, HUE, R, S } from '../../utils/clayTokens';

export default function GithubBackupRoute({ enabled, workerUrl, disabled, onChange }: {
    enabled: boolean;
    workerUrl: string;
    disabled?: boolean;
    onChange: (enabled: boolean) => void;
}) {
    return <section className="space-y-3 p-3" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken, color: F.textSecondary }}>
        <div className="flex items-center gap-3">
            <p id="github-backup-route-label" className="flex-1 text-xs font-semibold" style={{ color: F.textPrimary }}>通过 Cloudflare 中转备份</p>
            <button type="button" role="switch" aria-checked={enabled} aria-labelledby="github-backup-route-label" aria-describedby="github-backup-route-description" disabled={disabled} onClick={() => onChange(!enabled)} className="flex h-11 w-12 shrink-0 items-center disabled:opacity-50">
                <span className="flex h-7 w-12 items-center px-1" style={{ borderRadius: R.pill, background: enabled ? HUE.blue.main : F.surfaceSunken, boxShadow: S.sunken }}><span className="block h-5 w-5" style={{ borderRadius: R.pill, background: F.surfaceRaised, boxShadow: S.raisedSoft, marginLeft: enabled ? 20 : 0 }} /></span>
            </button>
        </div>
        <p id="github-backup-route-description" className="text-xs leading-5">默认直接连接 GitHub。开启后，你的 GitHub Token 和备份内容会经过下面这台中转服务；请只在信任它时开启。切换后下一次备份立即使用新线路。</p>
        <p className="break-all text-xs leading-5">中转地址：{workerUrl}</p>
        <p className="text-xs leading-5" style={{ color: F.textTertiary }}>两种线路都会将超过 32 MB 的备份分片上传，恢复时自动拼回。</p>
    </section>;
}
// [EM-END: github-backup-route-clay]
