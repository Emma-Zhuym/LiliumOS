import { beforeEach, describe, expect, it } from 'vitest';
import type { FinanceCategory, FinanceTransaction } from '../types';
import { FinanceDB } from './financeDb';
import { normalizeSimpleFinSnapshot } from './simplefinSync';
import { executeFinanceChatTool, getFinanceAwareness } from './financeChatTools';
import { buildFinanceAnalysis, expensePercentile, FINANCE_ANALYSIS_KEY,
  financeSpendingSeries, financeAnalysisCacheKey, normalizeFinanceAnalysisSettings } from './financeAnalysis';

const categories = new Map<string, FinanceCategory>([
  ['food', { id: 'food', name: '餐饮' }], ['cat_transfer', { id: 'cat_transfer', name: '转账' }],
]);
const options = { from: '2026-06-01', to: '2026-06-30', currency: 'USD', view: 'trimmed' as const, method: 'percentile' as const, percentile: 95 };
const transaction = (id: string, amount: number, patch: Partial<FinanceTransaction> = {}): FinanceTransaction => ({
  id, type: 'expense', amount, currency: 'USD', accountId: 'card', categoryId: 'food',
  dateStr: '2026-06-12', timestamp: Date.now() - 60000, note: id, ...patch,
});

describe('expense percentile and scope', () => {
  it('uses type-7 interpolation without mutating the input', () => {
    const amounts = [100, 10, 30, 20];
    expect(expensePercentile(amounts, 50)).toBe(25);
    expect(expensePercentile(amounts, 95)).toBeCloseTo(89.5);
    expect(amounts).toEqual([100, 10, 30, 20]);
    expect(expensePercentile([], 95)).toBeNull();
    expect(expensePercentile([NaN, Infinity, -1, 0, 8], 95)).toBe(8);
    expect(expensePercentile([1, 2], NaN)).toBeNull();
  });

  it('compares all, manual and trimmed without counting an exclusion twice', () => {
    const rows = [transaction('a', 10), transaction('b', 20), transaction('c', 30), transaction('large', 100),
      transaction('furniture', 500, { analysisTreatment: 'one_off' }),
      transaction('advance-payment', 200, { analysisTreatment: 'pass_through' }),
      transaction('advance-receipt', 200, { type: 'income', analysisTreatment: 'pass_through' }),
      transaction('salary', 1000, { type: 'income' })];
    const result = buildFinanceAnalysis(rows, categories, options);
    expect(result.comparisons).toEqual([
      { view: 'all', count: 6, total: 860 }, { view: 'manual', count: 4, total: 160 },
      { view: 'trimmed', count: 3, total: 60 },
    ]);
    expect(result.sampleSize).toBe(4);
    expect(result.threshold).toBeCloseTo(89.5);
    expect(result.manualExcludedExpenseTotal).toBe(700);
    expect(result.outlierTotal).toBe(100);
    expect(result.selectedIncome.map(t => t.id)).toEqual(['salary']);
    expect(buildFinanceAnalysis(rows, categories, { ...options, view: 'all' }).selectedIncome).toHaveLength(2);
    expect(rows.every(t => t.excludedFromReporting === undefined)).toBe(true);
  });

  it('keeps ties at the threshold, protected large expenses and all rows at P100', () => {
    const equal = [transaction('a', 20), transaction('b', 20), transaction('c', 20)];
    expect(buildFinanceAnalysis(equal, categories, options).outliers).toHaveLength(0);
    const rows = [transaction('a', 10), transaction('rent', 1000, { analysisTreatment: 'keep' })];
    const result = buildFinanceAnalysis(rows, categories, options);
    expect(result.selectedExpenses).toHaveLength(2);
    expect(result.sampleSize).toBe(2);
    expect(buildFinanceAnalysis([transaction('a', 10), transaction('b', 1000)], categories,
      { ...options, percentile: 100 }).outliers).toHaveLength(0);
    expect(buildFinanceAnalysis([transaction('alone', 20)], categories, options).outliers).toHaveLength(0);
  });

  it('scopes by date, currency and account before calculating; excludes transfers, pending and provider holds', () => {
    const rows = [transaction('valid', 12), transaction('other-account', 900, { accountId: 'elsewhere' }),
      transaction('other-currency', 5000, { currency: 'CNY' }), transaction('older', 300, { dateStr: '2026-05-31' }),
      transaction('future', 300, { dateStr: '2026-07-01' }), transaction('pending', 400, { pending: true }),
      transaction('hold', 400, { excludedFromReporting: true }), transaction('transfer', 400, { type: 'transfer' }),
      transaction('repayment', 400, { categoryId: 'cat_transfer' }), transaction('invalid', NaN)];
    const result = buildFinanceAnalysis(rows, categories, { ...options, accountId: 'card' });
    expect(result.sampleSize).toBe(1);
    expect(result.comparisons[0].total).toBe(12);
    expect(result.pending.map(t => t.id)).toEqual(['pending']);
  });

  it('does not use refunds or income as percentile samples and warns for small samples', () => {
    const result = buildFinanceAnalysis([transaction('expense', 15), transaction('refund', 200, { type: 'refund' })], categories, options);
    expect(result.sampleSize).toBe(1);
    expect(result.selectedIncome).toHaveLength(1);
    expect(result.smallSample).toBe(true);
    expect(buildFinanceAnalysis(Array.from({ length: 20 }, (_, i) => transaction(String(i), 10)), categories, options).smallSample).toBe(false);
  });

  it('treats legacy rows as included and validates saved settings', () => {
    expect(normalizeFinanceAnalysisSettings(null)).toEqual({ view: 'manual', method: 'iqr', percentile: 95 });
    expect(normalizeFinanceAnalysisSettings({ view: 'oops', percentile: 0 })).toEqual({ view: 'manual', method: 'iqr', percentile: 95 });
    expect(normalizeFinanceAnalysisSettings({ view: 'all', percentile: 99 })).toEqual({ view: 'all', method: 'iqr', percentile: 99 });
    expect(buildFinanceAnalysis([transaction('old', 20)], categories, { ...options, view: 'manual' }).selectedExpenses).toHaveLength(1);
  });

  it('invalidates cached commentary when the scope or a manual choice changes', () => {
    const rows = [transaction('a', 10)];
    const result = buildFinanceAnalysis(rows, categories, options);
    const key = financeAnalysisCacheKey(result, options);
    expect(financeAnalysisCacheKey(result, { ...options, percentile: 90 })).not.toBe(key);
    expect(financeAnalysisCacheKey(buildFinanceAnalysis([transaction('a', 10, { analysisTreatment: 'other' })], categories, options), options)).not.toBe(key);
  });
});

describe('analysis choices survive storage and provider sync', () => {
  beforeEach(async () => {
    await FinanceDB.importAll({ accounts: [], categories: [...categories.values()], transactions: [], settings: [], recurringRules: [], taComments: [] });
  });

  it('changes a marker without changing balance, amounts or hiding raw transactions; round-trips backup', async () => {
    const account = { id: 'card', name: 'Demo', currency: 'USD', type: 'checking' as const, initialBalance: 1000, color: '' };
    await FinanceDB.saveAccount(account);
    await FinanceDB.saveTransactions([transaction('out', 200), transaction('in', 200, { type: 'income' })]);
    await FinanceDB.setAnalysisTreatment('out', 'pass_through');
    await FinanceDB.setAnalysisTreatment('in', 'pass_through');
    await FinanceDB.saveSetting(FINANCE_ANALYSIS_KEY, { view: 'trimmed', percentile: 90 });
    expect(await FinanceDB.calcAccountBalance(account)).toBe(1000);
    const backup = await FinanceDB.exportAll();
    await FinanceDB.importAll({ transactions: [], settings: [] });
    await FinanceDB.importAll(backup);
    expect((await FinanceDB.getTransactions()).map(t => t.analysisTreatment)).toEqual(['pass_through', 'pass_through']);
    expect(await FinanceDB.getSetting(FINANCE_ANALYSIS_KEY)).toEqual({ view: 'trimmed', percentile: 90 });
    expect(await FinanceDB.calcAccountBalance(account)).toBe(1000);
    await FinanceDB.setAnalysisTreatment('out', 'auto');
    expect((await FinanceDB.getTransaction('out'))?.analysisTreatment).toBe('auto');
  });

  it('protects the latest local choice against stale provider writes, including reset', async () => {
    const original = transaction('a', 20, { source: 'simplefin' });
    await FinanceDB.saveTransaction(original);
    await FinanceDB.setAnalysisTreatment('a', 'one_off');
    await FinanceDB.saveSyncedTransactions([{ ...original, amount: 22 }]);
    expect(await FinanceDB.getTransaction('a')).toMatchObject({ amount: 22, analysisTreatment: 'one_off' });
    await FinanceDB.setAnalysisTreatment('a', 'auto');
    await FinanceDB.saveSyncedTransactions([{ ...original, analysisTreatment: 'one_off', amount: 24 }]);
    expect(await FinanceDB.getTransaction('a')).toMatchObject({ amount: 24, analysisTreatment: 'auto' });
    await expect(FinanceDB.setAnalysisTreatment('missing', 'other')).rejects.toThrow();
  });

  it('preserves a local marker when a pending transaction receives a new provider id', () => {
    const original = transaction('local', 20, { accountId: 'simplefin:demo:card', source: 'simplefin', externalId: 'hold',
      pending: true, sourceDescription: 'SHOP', categoryId: 'cat_uncategorized', note: 'SHOP', analysisTreatment: 'other' });
    const result = normalizeSimpleFinSnapshot({ errlist: [], connections: [], accounts: [{
      id: 'card', conn_id: 'demo', name: 'Demo', currency: 'USD', balance: '100', 'balance-date': Date.now() / 1000,
      transactions: [{ id: 'posted', amount: '-20', description: 'SHOP', posted: original.timestamp / 1000 }],
    }] }, [], [original], Date.now());
    expect(result.transactions[0]).toMatchObject({ id: 'local', externalId: 'posted', pending: false, analysisTreatment: 'other' });
  });

  it('uses the same saved view for chat summaries and keeps currencies separate', async () => {
    await FinanceDB.saveTransactions([transaction('a', 10), transaction('b', 20), transaction('large', 100),
      transaction('third-party', 500, { analysisTreatment: 'pass_through', timestamp: Date.now() - 1000 }), transaction('cny', 999, { currency: 'CNY' })]);
    await FinanceDB.saveSetting(FINANCE_ANALYSIS_KEY, { view: 'trimmed', method: 'percentile', percentile: 95 });
    const summary = await executeFinanceChatTool('finance_get_spending_summary', { start_date: options.from, end_date: options.to }) as any;
    expect(summary.by_currency.USD.total).toBe(30);
    expect(summary.by_currency.CNY.total).toBe(999);
    expect(summary.analysis_by_currency.USD.sample_size).toBe(3);
    const full = await executeFinanceChatTool('finance_get_spending_summary', { start_date: options.from, end_date: options.to, view: 'all', currency: 'USD' }) as any;
    expect(full.by_currency.USD.total).toBe(630);
    expect(full.by_currency.CNY).toBeUndefined();
    const awareness = await getFinanceAwareness('new-character');
    expect(awareness.pulse).toContain('代收代付');
    expect(awareness.pulse).not.toContain('USD 630.00');
  });
});


describe('IQR upper fence', () => {
  const iqrOptions = { ...options, method: 'iqr' as const };
  it('finds several furniture purchases that P95 misses', () => {
    const amounts = [...Array(7).fill(20), ...Array(7).fill(30), 50, 55, 60, 110, 120, 130];
    const rows = amounts.map((amount, i) => transaction(String(i), amount));
    const result = buildFinanceAnalysis(rows, categories, iqrOptions);
    expect(result.q1).toBe(20);
    expect(result.q3).toBe(51.25);
    expect(result.threshold).toBe(98.125);
    expect(result.outliers.map(t => t.amount)).toEqual([110, 120, 130]);
    expect(buildFinanceAnalysis(rows, categories, options).outliers.map(t => t.amount)).toEqual([130]);
    expect(financeAnalysisCacheKey(result, iqrOptions)).not.toBe(financeAnalysisCacheKey(result, options));
  });
  it('does not remove a fixed fraction of regular spending, and retains the exact fence', () => {
    const rows = [10, 20, 30, 40, 70].map((amount, i) => transaction(String(i), amount));
    const result = buildFinanceAnalysis(rows, categories, iqrOptions);
    expect(result.threshold).toBe(70);
    expect(result.outliers).toEqual([]);
  });
  it('handles empty, single and zero-spread samples explicitly', () => {
    expect(buildFinanceAnalysis([], categories, iqrOptions).threshold).toBeNull();
    expect(buildFinanceAnalysis([transaction('one', 120)], categories, iqrOptions).outliers).toEqual([]);
    const result = buildFinanceAnalysis([20, 20, 20, 20, 120].map((amount, i) => transaction(String(i), amount)), categories, iqrOptions);
    expect(result.iqr).toBe(0);
    expect(result.outliers.map(t => t.amount)).toEqual([120]);
  });
  it('respects manual exclusions and protected expenses without iteratively trimming', () => {
    const rows = [...Array.from({ length: 20 }, (_, i) => transaction(String(i), 20 + i)),
      transaction('large', 120), transaction('rent', 900, { analysisTreatment: 'keep' }),
      transaction('excluded', 10000, { analysisTreatment: 'one_off' }),
      transaction('income', 10000, { type: 'income' })];
    const result = buildFinanceAnalysis(rows, categories, iqrOptions);
    expect(result.sampleSize).toBe(22);
    expect(result.outliers.map(t => t.id)).toEqual(['large']);
    expect(result.selectedExpenses.some(t => t.id === 'rent')).toBe(true);
    expect(result.selectedIncome).toHaveLength(1);
  });
  it('upgrades saved percentile-only settings to IQR and preserves an explicit later choice', () => {
    expect(normalizeFinanceAnalysisSettings({ view: 'trimmed', percentile: 90 })).toEqual({ view: 'trimmed', method: 'iqr', percentile: 90 });
    expect(normalizeFinanceAnalysisSettings({ method: 'percentile', percentile: 90 }).method).toBe('percentile');
    expect(normalizeFinanceAnalysisSettings({ method: 'invalid' }).method).toBe('iqr');
  });
  it('uses saved IQR in chat summaries and allows an explicit percentile comparison', async () => {
    const amounts = [...Array(7).fill(20), ...Array(7).fill(30), 50, 55, 60, 110, 120, 130];
    await FinanceDB.importAll({ accounts: [], categories: [...categories.values()], transactions: amounts.map((amount, i) => transaction(String(i), amount)), settings: [] });
    await FinanceDB.saveSetting(FINANCE_ANALYSIS_KEY, { view: 'trimmed', method: 'iqr', percentile: 95 });
    const args = { start_date: options.from, end_date: options.to };
    const summary = await executeFinanceChatTool('finance_get_spending_summary', args) as any;
    expect(summary.method).toBe('iqr');
    expect(summary.by_currency.USD.total).toBe(515);
    expect(summary.analysis_by_currency.USD.threshold).toBe(98.125);
    expect(summary.analysis_by_currency.USD.outlier_excluded_count).toBe(3);
    const comparison = await executeFinanceChatTool('finance_get_spending_summary', { ...args, method: 'percentile' }) as any;
    expect(comparison.by_currency.USD.total).toBe(745);
  });
});


describe('calendar spending chart', () => {
  it('fills missing days and preserves the baseline when exclusions change', () => {
    const rows = [transaction('daily', 20, { dateStr: '2026-06-02' }), transaction('furniture', 120, { dateStr: '2026-06-02', analysisTreatment: 'one_off' })];
    const report = buildFinanceAnalysis(rows, categories, { ...options, view: 'manual' });
    const series = financeSpendingSeries(report, '2026-06-01', '2026-06-03');
    expect(series.map(day => day.selected)).toEqual([0, 20, 0]);
    expect(series.map(day => day.all)).toEqual([0, 140, 0]);
    expect(financeSpendingSeries(buildFinanceAnalysis(rows, categories, { ...options, view: 'all' }), '2026-06-01', '2026-06-03')[1].selected).toBe(140);
  });
  it('groups calendar years by month and crosses leap-day boundaries', () => {
    const report = buildFinanceAnalysis([transaction('june', 25)], categories, options);
    const months = financeSpendingSeries(report, '2026-01-01', '2026-12-31', true);
    expect(months).toHaveLength(12);
    expect(months[5].all).toBe(25);
    expect(financeSpendingSeries(report, '2024-02-28', '2024-03-01').map(day => day.date)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  });
});
