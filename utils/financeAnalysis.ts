import type { FinanceAnalysisTreatment, FinanceCategory, FinanceTransaction } from '../types';
import { isFinanceTransactionReportable, reportingTransactionType } from './financeTransfers';

export type FinanceAnalysisView = 'all' | 'manual' | 'trimmed';
export interface FinanceAnalysisSettings { view: FinanceAnalysisView; percentile: number }
export const FINANCE_ANALYSIS_KEY = 'financeAnalysisSettings';
export const DEFAULT_FINANCE_ANALYSIS: FinanceAnalysisSettings = { view: 'manual', percentile: 95 };
export const ANALYSIS_VIEW_LABELS: Record<FinanceAnalysisView, string> = {
  all: '全部支出', manual: '手动排除后', trimmed: '再排大额后',
};
export const ANALYSIS_TREATMENT_LABELS: Record<FinanceAnalysisTreatment, string> = {
  auto: '正常计入', keep: '始终保留', pass_through: '代收代付', one_off: '一次性支出', other: '其他排除',
};

export function analysisTreatment(transaction: Pick<FinanceTransaction, 'analysisTreatment'>): FinanceAnalysisTreatment {
  const value = transaction.analysisTreatment;
  return value && Object.prototype.hasOwnProperty.call(ANALYSIS_TREATMENT_LABELS, value) ? value : 'auto';
}

export function isManuallyExcluded(transaction: Pick<FinanceTransaction, 'analysisTreatment'>): boolean {
  return ['pass_through', 'one_off', 'other'].includes(analysisTreatment(transaction));
}

export function normalizeFinanceAnalysisSettings(value: unknown): FinanceAnalysisSettings {
  const source = value && typeof value === 'object' ? value as Partial<FinanceAnalysisSettings> : {};
  return {
    view: source.view === 'all' || source.view === 'trimmed' || source.view === 'manual'
      ? source.view : DEFAULT_FINANCE_ANALYSIS.view,
    percentile: typeof source.percentile === 'number' && Number.isFinite(source.percentile)
      && source.percentile >= 50 && source.percentile <= 100 ? source.percentile : 95,
  };
}

/** R's type-7 sample quantile: interpolate at zero-based index (n - 1) * p. */
export function expensePercentile(amounts: number[], percentile: number): number | null {
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100) return null;
  const sorted = amounts.filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * percentile / 100;
  const low = Math.floor(index);
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
}

export interface FinanceAnalysisOptions extends FinanceAnalysisSettings {
  from: string;
  to: string;
  currency: string;
  accountId?: string | null;
}

export function buildFinanceAnalysis(
  transactions: FinanceTransaction[],
  categories: ReadonlyMap<string, FinanceCategory>,
  options: FinanceAnalysisOptions,
) {
  const settings = normalizeFinanceAnalysisSettings(options);
  const scoped = transactions.filter(t => isFinanceTransactionReportable(t)
    && t.dateStr >= options.from && t.dateStr <= options.to && t.currency === options.currency
    && (!options.accountId || t.accountId === options.accountId)
    && Number.isFinite(t.amount) && t.amount > 0
    && reportingTransactionType(t, categories) !== 'transfer');
  const pending = scoped.filter(t => t.pending);
  const posted = scoped.filter(t => !t.pending);
  const expenses = posted.filter(t => reportingTransactionType(t, categories) === 'expense');
  const manualExpenses = expenses.filter(t => !isManuallyExcluded(t));
  const threshold = expensePercentile(manualExpenses.map(t => t.amount), settings.percentile);
  // Strictly greater: ties at the threshold stay together. Never iterate/recompute
  // after trimming, and never persist percentile results onto source transactions.
  const outliers = manualExpenses.filter(t => analysisTreatment(t) !== 'keep'
    && threshold !== null && t.amount > threshold);
  const outlierIds = new Set(outliers.map(t => t.id));
  const trimmedExpenses = manualExpenses.filter(t => !outlierIds.has(t.id));
  const rowsByView = { all: expenses, manual: manualExpenses, trimmed: trimmedExpenses };
  const selected = posted.filter(t => settings.view === 'all' || (
    !isManuallyExcluded(t) && (settings.view !== 'trimmed' || !outlierIds.has(t.id))
  ));
  const sum = (rows: FinanceTransaction[]) => rows.reduce((total, t) => total + t.amount, 0);
  const comparisons = (['all', 'manual', 'trimmed'] as const).map(view => ({
    view, count: rowsByView[view].length, total: sum(rowsByView[view]),
  }));
  return {
    settings, posted, pending, expenses, manualExpenses, outliers, outlierIds, selected,
    selectedExpenses: rowsByView[settings.view],
    selectedIncome: selected.filter(t => ['income', 'refund'].includes(reportingTransactionType(t, categories))),
    manualExcluded: posted.filter(isManuallyExcluded),
    manualExcludedExpenseTotal: sum(expenses.filter(isManuallyExcluded)),
    outlierTotal: sum(outliers), comparisons, threshold, sampleSize: manualExpenses.length,
    smallSample: manualExpenses.length > 0 && manualExpenses.length < 20,
  };
}

export type FinanceAnalysisResult = ReturnType<typeof buildFinanceAnalysis>;

export function describeFinanceAnalysis(result: FinanceAnalysisResult, currency: string): string {
  const { settings, sampleSize, threshold } = result;
  return `分析口径：${ANALYSIS_VIEW_LABELS[settings.view]}；仅已入账记录，币种 ${currency}。`
    + `原始支出 ${result.comparisons[0].total.toFixed(2)}，手动排除后 ${result.comparisons[1].total.toFixed(2)}，`
    + `P${settings.percentile} 后 ${result.comparisons[2].total.toFixed(2)}。`
    + `分位数样本 ${sampleSize} 笔，阈值 ${threshold === null ? '无' : threshold.toFixed(2)}；`
    + '仅筛选分析，不代表钱没花、节省了钱或交易有错；代收代付不代表个人消费或劳动收入。';
}

/** Content-sensitive key: comments must not survive edits to the report's rows or scope. */
export function financeAnalysisCacheKey(result: FinanceAnalysisResult, options: FinanceAnalysisOptions): string {
  const data = JSON.stringify([options, result.posted.map(t => [
    t.id, t.amount, t.dateStr, t.categoryId, t.type, t.note, t.sourceDescription, t.analysisTreatment,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return `analysis-v1-${(hash >>> 0).toString(16)}`;
}
