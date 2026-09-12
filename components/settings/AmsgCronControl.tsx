// [EM-START: amsg-cron-control]
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ClayDialog from '../os/ClayDialog';
import { ActiveMsgClient, type AmsgCronTriggerState } from '../../utils/activeMsgClient';
import { F, R, S, STATUS } from '../../utils/clayTokens';

export default function AmsgCronControl({ refreshKey, disabled, onNeedsCredentials, onBusyChange, notify }: {
    refreshKey: string;
    disabled?: boolean;
    onNeedsCredentials: () => void;
    onBusyChange: (busy: boolean) => void;
    notify: (message: string, type: 'success' | 'error' | 'info') => void;
}) {
    const [state, setState] = useState<AmsgCronTriggerState | null>(null);
    const [checking, setChecking] = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const version = useRef(0), locked = useRef(false);
    const read = useCallback(async () => {
        const current = ++version.current;
        setChecking(true); setBusy(false); setState(null); setConfirming(false);
        try {
            const result = await ActiveMsgClient.getCronTriggerState();
            if (version.current === current) { setState(result); setError(''); }
        } catch (cause) {
            if (version.current === current) setError(cause instanceof Error ? cause.message : '暂时读不到后台任务状态');
        } finally { if (version.current === current) setChecking(false); }
    }, []);
    useEffect(() => {
        void read();
        return () => {
            version.current++;
            if (locked.current) { locked.current = false; onBusyChange(false); }
        };
    }, [read, refreshKey, onBusyChange]);
    const apply = async (enabled: boolean) => {
        if (locked.current || disabled) return;
        locked.current = true; setBusy(true); onBusyChange(true); setConfirming(false);
        const current = version.current;
        try {
            const result = await ActiveMsgClient.setCronTriggerEnabled(enabled);
            if (current !== version.current) return;
            if (result.ok) { setState({ supported: true, enabled }); setError(''); notify(result.message, 'success'); }
            else {
                setError(result.message); notify(result.message, 'error');
                if (result.code === 'CF_TOKEN_MISSING') onNeedsCredentials();
                // A failed receipt does not establish whether Cloudflare applied the change.
                setState(null);
            }
        } catch (cause) {
            if (current === version.current) { setState(null); setError(cause instanceof Error ? cause.message : '操作未确认，请重新读取状态'); }
        } finally {
            if (current === version.current) { locked.current = false; setBusy(false); onBusyChange(false); }
        }
    };
    // Old Workers and an unreachable endpoint both return null. Do not call either a confirmed pause.
    if (!state && !error) return checking ? <p role="status" className="py-2 text-xs" style={{ color: F.textTertiary }}>正在读取后台任务状态…</p> : null;
    const known = state?.supported && typeof state.enabled === 'boolean';
    return <section className="space-y-3 p-3" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken, color: F.textSecondary }}>
        <p className="text-sm font-semibold" style={{ color: F.textPrimary }}>后台定时任务</p>
        {known && <p className="text-xs">{state!.enabled ? '定时触发已开启' : '定时触发已暂停'}</p>}
        <p className="text-xs leading-5">暂停会保留已排任务；恢复后按各自的到期规则处理。即时聊天仍可使用，但定时补发和失败兜底也会暂停；正在执行的任务可能继续完成。</p>
        {error && <p role="alert" className="text-xs leading-5" style={{ color: STATUS.warning.ink }}>{error}</p>}
        {known ? <button type="button" disabled={disabled || busy || checking} onClick={() => state!.enabled ? setConfirming(true) : void apply(true)} className="min-h-11 w-full text-xs font-semibold disabled:opacity-50" style={{ background: F.surface, borderRadius: R.button, boxShadow: S.raisedSoft, color: F.textPrimary }}>{busy ? '正在处理…' : state!.enabled ? '暂停后台任务' : '恢复后台任务'}</button>
            : state?.code === 'CF_TOKEN_MISSING' ? <button type="button" disabled={disabled || busy} onClick={onNeedsCredentials} className="min-h-11 w-full text-xs font-semibold disabled:opacity-50" style={{ background: F.surface, borderRadius: R.button, boxShadow: S.raisedSoft, color: F.textPrimary }}>为后端补充管理凭据</button>
                : <p className="text-xs leading-5">{state?.message || '暂时无法确认当前状态。'}</p>}
        <button type="button" disabled={disabled || busy || checking} onClick={() => void read()} className="min-h-11 text-xs underline disabled:opacity-50">重新读取状态</button>
        <p className="text-xs leading-5" style={{ color: F.textTertiary }}>重新部署后可能会恢复定时触发，需要时请再次检查。</p>
        <ClayDialog isOpen={confirming} title="暂停后台任务" onClose={() => setConfirming(false)} footer={<button type="button" disabled={disabled || busy} onClick={() => void apply(false)} className="h-12 w-full text-sm font-semibold disabled:opacity-50" style={{ background: F.textPrimary, color: F.surface, borderRadius: R.button }}>确认暂停</button>}>
            <p className="text-sm leading-6">暂停这台后端的定时触发，所有角色的定时任务会先留在队列里。需要继续时，再点“恢复后台任务”。</p>
        </ClayDialog>
    </section>;
}
// [EM-END: amsg-cron-control]
