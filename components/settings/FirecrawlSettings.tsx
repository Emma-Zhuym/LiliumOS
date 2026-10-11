import React, { useState } from 'react';
import { Globe } from '@phosphor-icons/react';
import { F, R, S, STATUS } from '../../utils/clayTokens';
import { getFirecrawlApiKey, setFirecrawlApiKey, getFirecrawlCreditUsage, FIRECRAWL_API_KEYS_URL } from '../../utils/firecrawl';

export default function FirecrawlSettings() {
    const [key, setKey] = useState(getFirecrawlApiKey);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const save = async () => {
        setBusy(true);
        setResult(null);
        try {
            const usage = await getFirecrawlCreditUsage(key.trim());
            setFirecrawlApiKey(key.trim());
            setResult({ ok: true, text: `已启用，剩余额度 ${usage.remainingCredits.toLocaleString()} / ${usage.planCredits.toLocaleString()}` });
        } catch (error) {
            setResult({ ok: false, text: error instanceof Error ? error.message : '连接失败，请稍后再试' });
        } finally {
            setBusy(false);
        }
    };
    return (
        <details style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.smallCard, boxShadow: S.raisedSoft, color: F.textSecondary }}>
            <summary className="flex items-center gap-3 p-4 cursor-pointer" style={{ minHeight: 64 }}>
                <Globe size={20} /><span className="text-sm font-semibold">Firecrawl 网页读取</span>
            </summary>
            <div className="space-y-3 px-4 pb-4">
                <p className="text-xs leading-relaxed">可选的动态网页读取服务。保存自己的 Key 后，普通网页提取失败时会尝试使用；未配置时继续沿用现有方式。</p>
                <a href={FIRECRAWL_API_KEYS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs underline" style={{ minHeight: 44 }}>打开 Firecrawl 获取 Key</a>
                <label className="block text-xs">API Key
                    <input type="password" autoComplete="off" value={key} disabled={busy} onChange={event => { setKey(event.target.value); setResult(null); }} className="block w-full mt-2 p-3 text-sm" style={{ borderRadius: R.input, background: F.surfaceSunken, boxShadow: S.sunken, color: F.textPrimary }} />
                </label>
                <div className="flex gap-3">
                    <button type="button" disabled={busy} onClick={() => { setFirecrawlApiKey(''); setKey(''); setResult({ ok: true, text: '已停用，网页读取继续使用原有方式' }); }} className="px-4 text-sm" style={{ minHeight: 48, borderRadius: R.button, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>停用</button>
                    <button type="button" disabled={busy || !key.trim()} onClick={() => void save()} className="flex-1 px-4 text-sm disabled:opacity-50" style={{ minHeight: 48, borderRadius: R.button, background: F.textPrimary, color: F.surface }}>{busy ? '检查中…' : '保存并检查额度'}</button>
                </div>
                {result && <p role="status" className="text-xs leading-relaxed" style={{ color: result.ok ? STATUS.success.ink : STATUS.danger.ink }}>{result.text}</p>}
            </div>
        </details>
    );
}
