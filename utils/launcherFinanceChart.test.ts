import { describe, expect, it } from 'vitest';
import type { FinanceCategory, FinanceTransaction } from '../types';
import { buildLauncherExpenseChart } from './launcherFinanceChart';

const categories: FinanceCategory[] = [
  { id: 'fixed', name: '每月固定' },
  { id: 'rent', name: '房租', parentId: 'fixed' },
  { id: 'food', name: '餐饮' },
  { id: 'other-rent', name: '房租' },
];
const tx = (id: string, patch: Partial<FinanceTransaction> = {}): FinanceTransaction => ({
  id, type: 'expense', amount: 10, currency: 'USD', accountId: 'a', categoryId: 'food',
  note: '', timestamp: 0, dateStr: '2026-09-03', ...patch,
});

describe('desktop expense chart', () => {
  it('excludes only the nested monthly rent category without changing the ledger', () => {
    const rows = [
      tx('rent', { categoryId: 'rent', amount: 2000 }),
      tx('food', { amount: 30 }),
      tx('named-rent', { categoryId: 'other-rent', amount: 15 }),
      tx('hold', { amount: 100, excludedFromReporting: true }),
      tx('transfer', { amount: 300, type: 'transfer' }),
      tx('other-currency', { amount: 50, currency: 'CNY' }),
      tx('other-month', { amount: 70, dateStr: '2026-08-03' }),
    ];
    const chart = buildLauncherExpenseChart(rows, categories, 2026, 9, 'USD');
    expect(chart.days[2]).toBe(45);
    expect(chart.total).toBe(45);
    expect(chart.rentCategoryFound).toBe(true);
    expect(chart.categories.map(item => [item.name, item.amount])).toEqual([['餐饮', 30], ['房租', 15]]);
    expect(rows[0].amount).toBe(2000);
  });
});
