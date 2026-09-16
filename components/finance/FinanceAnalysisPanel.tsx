import React, { useEffect, useState } from 'react';
import type { FinanceAnalysisTreatment, FinanceTransaction } from '../../types';
import { F, S, R, HUE, STATUS } from '../../utils/clayTokens';
import {
  ANALYSIS_TREATMENT_LABELS, ANALYSIS_VIEW_LABELS, analysisTreatment, isManuallyExcluded,
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

export function FinanceAnalysisPanel({ result, currency, ready, saving, error, onSettingsChange, onTreatmentChange }: {
  result: FinanceAnalysisResult;
  currency: string;
  ready: boolean;
  saving: boolean;
  error: string | null;
  onSettingsChange: (patch: Partial<FinanceAnalysisSettings>) => void;
  onTreatmentChange: (transaction: FinanceTransaction, treatment: FinanceAnalysisTreatment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [excludedOnly, setExcludedOnly] = useState(false);
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
  const rows = result.posted.filter(t => (!excludedOnly || isManuallyExcluded(t) || result.outlierIds.has(t.id))
    && `${t.note} ${t.sourceDescription || ''} ${t.dateStr} ${t.amount}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));

  return (
    <section aria-label="花销分析口径" className="mb-4 p-4"
      style={{ background: F.surface, borderRadius: R.bigCard, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold" style={{ color: F.textPrimary }}>花销口径</h3>
        <span role="status" className="text-xs" style={{ color: F.textTertiary }}>{!ready ? '读取设置…' : saving ? '保存中…' : '仅影响分析'}</span>
      </div>
      <p className="text-xs mb-3 leading-relaxed" style={{ color: F.textSecondary }}>原始流水和账户余额保留。点选口径，下面的图表同步切换。</p>
      <div role="group" aria-label="选择分析口径" className="p-1 space-y-1 mb-3"
        style={{ background: F.surfaceSunken, borderRadius: R.large, boxShadow: S.sunken }}>
        {result.comparisons.map(item => (
          <button key={item.view} type="button" aria-pressed={result.settings.view === item.view}
            disabled={!ready} onClick={() => onSettingsChange({ view: item.view })}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
            style={{ minHeight: 44, borderRadius: R.medium,
              background: result.settings.view === item.view ? F.surfaceRaised : 'transparent',
              boxShadow: result.settings.view === item.view ? S.raisedSoft : 'none', color: F.textPrimary }}>
            <span className="text-xs">{ANALYSIS_VIEW_LABELS[item.view]}<span className="ml-2" style={{ color: F.textTertiary }}>{item.count} 笔</span></span>
            <span className="text-sm font-semibold tabular-nums">{money(item.total)}</span>
          </button>
        ))}
      </div>
      <label className="block text-xs mb-2" style={{ color: F.textSecondary }}>
        大额筛选方法
        <select aria-label="大额筛选方法" value={result.settings.method} disabled={!ready}
          onChange={event => onSettingsChange({ method: event.target.value as 'iqr' | 'percentile' })}
          className="w-full mt-2 px-3 py-2 text-sm"
          style={{ minHeight: 44, background: F.surfaceSunken, color: F.textPrimary, borderRadius: R.input,
            border: `1px solid ${F.borderSoft}`, boxShadow: S.sunken }}>
          <option value="iqr">IQR · 偏离平常金额</option>
          <option value="percentile">Percentile · 按金额排名</option>
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
      {result.settings.method === 'iqr' && <p className="text-xs mb-2 leading-relaxed" style={{ color: F.textSecondary }}>
        按中间一半消费的金额跨度识别大额，不固定排除多少笔。界线 = P75 + 1.5 ×（P75 − P25）。
        {result.iqr === 0 && '当前中间一半金额相同，界线可能偏严格，请检查候选明细。'}
      </p>}
      <p id="finance-percentile-help" className="text-xs leading-relaxed" style={{ color: F.textSecondary }}>
        手动排除后 {result.sampleSize} 笔支出参与计算；{result.threshold === null ? '暂无阈值。' : `阈值约 ${money(result.threshold)}，高于阈值的交易列为大额候选。`}
        等于阈值仍保留；“始终保留”不被自动排除。{result.settings.method === 'percentile' && 'P100 不排大额。'}
      </p>
      <p className="text-xs mt-2 leading-relaxed" style={{ color: F.textSecondary }}>
        手动排除支出 {money(result.manualExcludedExpenseTotal)}；大额筛选再排 {result.outliers.length} 笔 / {money(result.outlierTotal)}。这是统计范围的差额，不是省下的钱。
      </p>
      {result.smallSample && <p className="text-xs mt-2" style={{ color: STATUS.warning.ink }}>样本不足 20 笔，少数交易会明显影响阈值；请对照完整支出判断。</p>}
      {result.pending.length > 0 && <p className="text-xs mt-2" style={{ color: F.textTertiary }}>{result.pending.length} 笔待入账暂不参与这三组统计。</p>}
      <p className="text-xs mt-2 leading-relaxed" style={{ color: F.textTertiary }}>收入不做大额筛选；在排除视图中，已手动标记的代收款等收入也不计入。退款仍按原有收入口径展示，暂不净抵原消费。</p>
      {error && <p role="alert" className="text-xs mt-2" style={{ color: STATUS.danger.ink }}>{error}</p>}
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
        className="w-full mt-3 px-3 py-2 text-xs font-medium"
        style={{ minHeight: 44, background: F.surfaceRaised, borderRadius: R.button,
          border: `1px solid ${F.borderSoft}`, color: HUE.indigo.ink, boxShadow: S.raisedSoft }}>
        {expanded ? '收起明细' : '查看明细 / 手动标记'}
      </button>
      {expanded && <div className="mt-3">
        <input aria-label="搜索分析明细" placeholder="搜索商户、备注、日期或金额" value={query} onChange={event => setQuery(event.target.value)}
          className="w-full px-3 py-2 text-xs" style={{ minHeight: 44, borderRadius: R.input, background: F.surfaceSunken,
            color: F.textPrimary, boxShadow: S.sunken, border: `1px solid ${F.borderSoft}` }} />
        <label className="flex items-center gap-2 text-xs py-3" style={{ color: F.textSecondary, minHeight: 44 }}>
          <input type="checkbox" checked={excludedOnly} onChange={event => setExcludedOnly(event.target.checked)} />仅看手动排除 / 大额候选
        </label>
        <p className="text-xs mb-3 leading-relaxed" style={{ color: F.textTertiary }}>代充：收到的钱和替对方付的钱分别标记“代收代付”。家具可选“一次性支出”；房租等要保留的大额可选“始终保留”。选择“正常计入”可恢复。</p>
        {rows.length === 0 && <p className="p-4 text-xs" style={{ background: F.surfaceSunken, borderRadius: R.medium, color: F.textTertiary }}>没有符合条件的已入账交易。</p>}
        <div className="max-h-96 overflow-y-auto">
          {rows.map(t => <div key={t.id} className="py-3" style={{ borderTop: `1px solid ${F.divider}` }}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <span className="text-xs break-words min-w-0" style={{ color: F.textPrimary }}>{t.note || t.sourceDescription || '未命名交易'}</span>
              <span className="text-xs font-semibold shrink-0 tabular-nums" style={{ color: F.textPrimary }}>{t.type === 'expense' ? '−' : '+'}{money(t.amount)}</span>
            </div>
            <div className="text-xs mb-2" style={{ color: F.textTertiary }}>{t.dateStr} · {ANALYSIS_TREATMENT_LABELS[analysisTreatment(t)]}{result.outlierIds.has(t.id) ? ` · ${result.settings.method === 'iqr' ? '高于 IQR 界线' : `高于 P${result.settings.percentile}`}` : ''}</div>
            <FinanceTreatmentSelect value={t.analysisTreatment} disabled={!ready || saving}
              label={`分析标记：${t.note || t.sourceDescription || t.id} ${t.amount}`}
              onChange={value => onTreatmentChange(t, value)} />
          </div>)}
        </div>
      </div>}
    </section>
  );
}
