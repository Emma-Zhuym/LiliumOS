import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, CaretDown } from '@phosphor-icons/react';
import { FinanceSpendingChart } from './FinanceSpendingChart';
import type { FinanceAnalysisTreatment } from '../../types';
import { F, S, R, HUE, STATUS } from '../../utils/clayTokens';
import {
  ANALYSIS_TREATMENT_LABELS, ANALYSIS_VIEW_LABELS, analysisTreatment,
  type FinanceAnalysisResult, type FinanceAnalysisSettings,
} from '../../utils/financeAnalysis';

export function FinanceTreatmentSelect({ value, onChange, disabled, label = '分析标记' }: {
  value?: FinanceAnalysisTreatment;
  onChange: (value: FinanceAnalysisTreatment) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <select aria-label={label} value={analysisTreatment({ analysisTreatment: value })}
      disabled={disabled} onChange={event => onChange(event.target.value as FinanceAnalysisTreatment)}
      className="w-full px-3 py-2 text-xs"
      style={{ minHeight: 44, borderRadius: R.input, background: F.surfaceSunken,
        boxShadow: S.sunken, color: F.textPrimary, border: `1px solid ${F.borderSoft}` }}>
      {Object.entries(ANALYSIS_TREATMENT_LABELS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
    </select>
  );
}

export function FinanceAnalysisPanel({ result, currency, ready, saving, error, onSettingsChange, from, to, monthly = false }: {
  result: FinanceAnalysisResult;
  from: string; to: string; monthly?: boolean;
  currency: string;
  ready: boolean;
  saving: boolean;
  error: string | null;
  onSettingsChange: (patch: Partial<FinanceAnalysisSettings>) => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [percentile, setPercentile] = useState(String(result.settings.percentile));
  const [inputError, setInputError] = useState(false);
  useEffect(() => { setPercentile(String(result.settings.percentile)); }, [result.settings.percentile]);
  const money = (amount: number) => `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const commitPercentile = () => {
    const value = Number(percentile);
    if (!percentile.trim() || !Number.isFinite(value) || value < 50 || value > 100) {
      setInputError(true); return;
    }
    setInputError(false);
    if (value !== result.settings.percentile) onSettingsChange({ percentile: value });
  };

  return (
    <section aria-label="花销分析口径" className="mb-4 p-4"
      style={{ background: F.surface, borderRadius: R.bigCard, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
      <div role="group" aria-label="选择分析口径" className="grid grid-cols-3 gap-1 p-1"
        style={{ background: F.surfaceSunken, borderRadius: R.large, boxShadow: S.sunken }}>
        {result.comparisons.map(item => (
          <button key={item.view} type="button" aria-pressed={result.settings.view === item.view}
            disabled={!ready} onClick={() => onSettingsChange({ view: item.view })}
            className="min-w-0 py-2 px-1 text-center active:scale-[0.98] transition-transform"
            style={{ minHeight: 58, borderRadius: R.medium, color: result.settings.view === item.view ? HUE.indigo.ink : F.textSecondary,
              background: result.settings.view === item.view ? F.surfaceRaised : 'transparent',
              boxShadow: result.settings.view === item.view ? S.raisedSoft : 'none' }}>
            <span className="block text-xs font-medium">{ANALYSIS_VIEW_LABELS[item.view]}</span>
            <span className="block text-[11px] mt-1 tabular-nums">{item.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </button>
        ))}
      </div>
      <FinanceSpendingChart result={result} from={from} to={to} monthly={monthly} currency={currency} />
      <button type="button" aria-label="筛选设置" aria-expanded={showSettings} onClick={() => setShowSettings(value => !value)}
        className="w-full flex items-center justify-between gap-3 mt-3 py-3 text-xs"
        style={{ minHeight: 44, color: F.textSecondary, borderTop: `1px solid ${F.divider}` }}>
        <span className="flex items-center gap-2"><SlidersHorizontal size={16} />大额筛选</span>
        <span className="flex items-center gap-2" style={{ color: HUE.indigo.ink }}>{result.settings.method === 'iqr' ? 'IQR' : `P${result.settings.percentile}`}<CaretDown size={14} style={{ transform: showSettings ? 'rotate(180deg)' : undefined }} /></span>
      </button>
      {(!ready || saving) && <p role="status" className="text-xs" style={{ color: F.textTertiary }}>{!ready ? '读取中…' : '保存中…'}</p>}
      {error && <p role="alert" className="text-xs" style={{ color: STATUS.danger.ink }}>{error}</p>}
      {showSettings && <div className="pt-1">
      <label className="flex items-center justify-between gap-3 text-xs mb-3" style={{ color: F.textSecondary }}>
        筛选方式
        <select aria-label="大额筛选方法" value={result.settings.method} disabled={!ready}
          onChange={event => onSettingsChange({ method: event.target.value as 'iqr' | 'percentile' })}
          className="px-3 py-2 text-xs"
          style={{ minHeight: 44, background: F.surfaceSunken, color: F.textPrimary, borderRadius: R.input,
            border: `1px solid ${F.borderSoft}`, boxShadow: S.sunken }}>
          <option value="iqr">IQR · 自动界线</option>
          <option value="percentile">百分位 · 自定比例</option>
        </select>
      </label>
      {result.settings.method === 'percentile' && <>
      <div className="flex items-center gap-3 mb-2">
        <label htmlFor="finance-percentile" className="text-xs flex-1" style={{ color: F.textSecondary }}>金额分位数 Percentile</label>
        <span className="text-xs" style={{ color: HUE.indigo.ink }}>P</span>
        <input id="finance-percentile" type="number" min={50} max={100} step="any" inputMode="decimal"
          value={percentile} disabled={!ready} onChange={event => setPercentile(event.target.value)}
          onBlur={commitPercentile} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          aria-invalid={inputError} aria-describedby="finance-percentile-help"
          className="w-20 px-3 py-2 text-sm tabular-nums"
          style={{ minHeight: 44, background: F.surfaceSunken, color: F.textPrimary, borderRadius: R.input,
            border: `1px solid ${F.borderSoft}`, boxShadow: S.sunken }} />
      </div>
      {inputError && <p role="alert" className="text-xs mb-2" style={{ color: STATUS.danger.ink }}>请输入 50–100；当前计算仍使用 P{result.settings.percentile}。</p>}
      </>}
      <div className="grid grid-cols-2 gap-3 p-3" style={{ background: F.surfaceSunken, borderRadius: R.medium }}>
        <div><div className="text-[11px] mb-1" style={{ color: F.textTertiary }}>大额界线 · 约</div><div className="text-sm font-semibold tabular-nums" style={{ color: F.textPrimary }}>{result.threshold === null ? '暂无' : money(result.threshold)}</div></div>
        <div><div className="text-[11px] mb-1" style={{ color: F.textTertiary }}>日常视图筛除</div><div className="text-sm font-semibold tabular-nums" style={{ color: F.textPrimary }}>{result.outliers.length} 笔</div></div>
      </div>
      <p className="text-[11px] mt-2" style={{ color: F.textTertiary }}>{result.sampleSize} 笔参与计算 · 筛除合计 {money(result.outlierTotal)}</p>
      {result.smallSample && <p className="text-xs mt-2" style={{ color: STATUS.warning.ink }}>样本较少，界线可能不稳定。</p>}
      {result.settings.method === 'iqr' && result.iqr === 0 && <p className="text-xs mt-2" style={{ color: STATUS.warning.ink }}>金额较集中，筛选可能偏严格。</p>}
      <details className="mt-3 text-xs" style={{ color: F.textTertiary }}>
        <summary className="cursor-pointer py-2">规则说明</summary>
        <div id="finance-percentile-help" className="leading-relaxed pb-2">
          <p>全部保留完整支出；个人排除手动标记；日常再筛去大额。手动标记在交易编辑页修改，流水和余额保留。</p>
          <p className="mt-2">{result.settings.method === 'iqr' ? 'IQR：P75 + 1.5 ×（P75 − P25），不固定排除多少笔。' : '按单笔金额排名筛选，P100 不排大额。'}等于界线或标记“始终保留”的交易仍计入。</p>
          <p className="mt-2">仅统计已入账记录；收入不做大额筛选，退款仍按收入展示。筛除差额不代表节省。</p>
        </div>
      </details>
      </div>}
    </section>
  );
}
