import React, { useState } from 'react';
import type { APIConfig, CharacterProfile } from '../../types';
import { collectVRDiagnostics } from '../../utils/vrWorld/diagnostics';
import { F, R, S } from '../../utils/clayTokens';

export default function VRDiagnostics({ characters, api }: { characters: CharacterProfile[]; api: APIConfig }) {
    const [busy, setBusy] = useState(false), [report, setReport] = useState(''), [status, setStatus] = useState('');
    const collect = async () => {
        if (busy) return;
        setBusy(true); setStatus('');
        try {
            const text = await collectVRDiagnostics(characters, api); setReport(text);
            try { await navigator.clipboard.writeText(text); setStatus('诊断已复制'); }
            catch { setStatus('复制不可用，可从下方选择全文'); }
        } catch (error: any) { setStatus(error?.message || '读取诊断失败'); }
        finally { setBusy(false); }
    };
    return <section className="space-y-3 p-5" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, color: F.textPrimary, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
        <h3 className="text-sm font-semibold">活动诊断</h3><p className="text-xs leading-relaxed" style={{ color: F.textSecondary }}>查看当前调度、连续失败与间隔拦截记录，不请求模型。</p>
        <button disabled={busy} onClick={() => void collect()} className="min-h-11 w-full px-4 text-sm" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.button, boxShadow: S.raisedSoft }}>{busy ? '读取中…' : '读取并复制诊断'}</button>
        {status && <p role="status" className="text-xs">{status}</p>}{report && <textarea aria-label="彼方诊断全文" readOnly value={report} rows={8} className="w-full p-3 text-xs" style={{ background: F.surfaceSunken, color: F.textPrimary, borderRadius: R.input, boxShadow: S.sunken }} />}
    </section>;
}
