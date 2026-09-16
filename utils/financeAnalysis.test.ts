import { beforeEach, describe, expect, it } from 'vitest';
import type { FinanceCategory, FinanceTransaction } from '../types';
import { FinanceDB } from './financeDb';
import { normalizeSimpleFinSnapshot } from './simplefinSync';
import { executeFinanceChatTool, getFinanceAwareness } from './financeChatTools';
import { buildFinanceAnalysis, expensePercentile, FINANCE_ANALYSIS_KEY,
  financeAnalysisCacheKey, normalizeFinanceAnalysisSettings } from './financeAnalysis';

const categories = new Map<string, FinanceCategory>([
  ['food', { id: 'food', name: '餐饮' }], ['cat_transfer', { id: 'cat_transfer', name: '转账' }],
]);
const options = { from: '2026-06-01', to: '2026-06-30', currency: 'USD', view: 'trimmed' as const, percentile: 95 };
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
    expect(normalizeFinanceAnalysisSettings(null)).toEqual({ view: 'manual', percentile: 95 });
    expect(normalizeFinanceAnalysisSettings({ view: 'oops', percentile: 0 })).toEqual({ view: 'manual', percentile: 95 });
    expect(normalizeFinanceAnalysisSettings({ view: 'all', percentile: 99 })).toEqual({ view: 'all', percentile: 99 });
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
    await FinanceDB.saveSetting(FINANCE_ANALYSIS_KEY, { view: 'trimmed', percentile: 95 });
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
