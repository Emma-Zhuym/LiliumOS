import React, { useState } from 'react';
import { ChartBar } from '@phosphor-icons/react';
import { F, HUE, R, S } from '../../utils/clayTokens';
import { financeSpendingSeries, spendingReferenceValues, type FinanceAnalysisResult } from '../../utils/financeAnalysis';

export function FinanceSpendingChart({ result, from, to, monthly, currency }: {
  result: FinanceAnalysisResult; from: string; to: string; monthly: boolean; currency: string;
}) {
  const series = financeSpendingSeries(result, from, to, monthly);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reference, setReference] = useState<'median' | 'mean' | 'none'>('median');
  const referenceValues = spendingReferenceValues(series);
  const referenceAmount = reference === 'none' ? 0 : referenceValues[reference];
  const active = series.find(day => day.date === selectedDate);
  const max = Math.max(1, ...series.map(day => day.all));
  const width = 320, top = 24, height = 128, bottom = top + height;
  const step = 300 / Math.max(1, series.length);
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));
  const money = (amount: number) => amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return <div className="mt-5">
    <div className="flex justify-between items-baseline gap-2 mb-1 text-xs" style={{ color: F.textTertiary }}>
      <span>{monthly ? '每月支出' : '每日支出'} · {currency}</span>
      <span aria-live="polite" className="tabular-nums" style={{ color: active ? HUE.indigo.ink : F.textTertiary }}>
        {active ? `${active.label} · ${money(active.selected)}` : `${result.selectedExpenses.length} 笔消费`}
      </span>
    </div>
    <svg viewBox={`0 0 ${width} 184`} className="w-full block" aria-label={`${monthly ? '每月' : '每日'}支出柱状图`}>
      {[0, 0.5, 1].map(ratio => <g key={ratio}>
        <line x1="10" x2="310" y1={bottom - ratio * height} y2={bottom - ratio * height} stroke={F.divider} strokeDasharray={ratio === 0 ? undefined : '3 5'} />
        {ratio === 1 && <text x="310" y="13" textAnchor="end" fill={F.textTertiary} fontSize="10">{money(max === 1 && !series.some(d => d.all) ? 0 : max)}</text>}
      </g>)}
      {series.map((day, index) => {
        const x = 10 + index * step;
        const barWidth = step * 0.58;
        return <g key={day.date} role="button" tabIndex={0}
          aria-label={`${day.label} 支出 ${currency} ${money(day.selected)}，全部 ${money(day.all)}`}
          onClick={() => setSelectedDate(day.date)} onFocus={() => setSelectedDate(day.date)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedDate(day.date); } }}
          style={{ cursor: 'pointer' }}>
          <rect x={x} y={top} width={step} height={height + 24} fill="transparent" />
          <rect x={x + (step - barWidth) / 2} y={bottom - day.all / max * height} width={barWidth} height={day.all / max * height} fill={HUE.indigo.tint} rx={R.small} />
          <rect x={x + (step - barWidth) / 2} y={bottom - day.selected / max * height} width={barWidth} height={day.selected / max * height} fill={day.date === selectedDate ? HUE.indigo.ink : HUE.indigo.main} rx={R.small} />
          {(index % labelEvery === 0 || index === series.length - 1) && <text x={x + step / 2} y={174} textAnchor="middle" fontSize="9" fill={F.textTertiary}>{monthly ? day.label : Number(day.date.slice(8))}</text>}
        </g>;
      })}
      {reference !== 'none' && result.expenses.length > 0 && <g pointerEvents="none" aria-label={`${reference === 'median' ? '中位数' : '均值'} ${money(referenceAmount)}`}>
        <line x1="10" x2="310" y1={bottom - referenceAmount / max * height} y2={bottom - referenceAmount / max * height}
          stroke={HUE.indigo.ink} strokeWidth="1" strokeDasharray="5 4" />
      </g>}
    </svg>
    <div className="flex items-center gap-2 text-[11px] mb-2" style={{ color: F.textTertiary }}>
      <select aria-label="图表参考线" value={reference} onChange={event => setReference(event.target.value as typeof reference)}
        title="按当前视图的每日合计计算，包含零支出日期；年视图按月计算。"
        className="px-2 text-xs" style={{ minHeight: 44, color: F.textSecondary, background: F.surfaceSunken, borderRadius: R.input }}>
        <option value="median">{monthly ? '月' : '日'}中位数</option>
        <option value="mean">{monthly ? '月' : '日'}均值</option>
        <option value="none">不显示参考线</option>
      </select>
      {reference !== 'none' && <span className="tabular-nums" aria-live="polite">{currency} {referenceAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
    </div>
    {!result.expenses.length && <div className="flex items-center justify-center gap-2 p-4 text-xs" style={{ color: F.textTertiary, background: F.surfaceSunken, borderRadius: R.medium, boxShadow: S.sunken }}><ChartBar size={18} />这段时间还没有支出</div>}
    {result.settings.view !== 'all' && result.expenses.length > 0 && <div className="flex items-center justify-end gap-1 text-[10px]" style={{ color: F.textTertiary }}><span className="w-2 h-2" style={{ background: HUE.indigo.tint, borderRadius: R.small }} />浅色为全部支出</div>}
  </div>;
}
