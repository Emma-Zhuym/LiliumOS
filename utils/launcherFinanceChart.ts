import type { FinanceCategory, FinanceTransaction } from '../types';
import { isFinanceTransactionReportable, reportingTransactionType } from './financeTransfers';

export interface LauncherExpenseChart {
  days: number[];
  categories: { id: string; name: string; amount: number }[];
  total: number;
  rentCategoryFound: boolean;
}

/** Desktop-only view of expenses. The underlying ledger is never changed. */
export function buildLauncherExpenseChart(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  year: number,
  month: number,
  currency: string,
): LauncherExpenseChart {
  const categoryMap = new Map(categories.map(category => [category.id, category]));
  const fixedIds = new Set(categories.filter(category => category.name.trim() === '每月固定').map(category => category.id));
  const rentIds = new Set(categories.filter(category => category.name.trim() === '房租' && category.parentId && fixedIds.has(category.parentId)).map(category => category.id));
  const days = Array.from({ length: new Date(year, month, 0).getDate() }, () => 0);
  const byCategory = new Map<string, number>();
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  let total = 0;

  for (const transaction of transactions) {
    if (!isFinanceTransactionReportable(transaction)
      || !transaction.dateStr.startsWith(monthPrefix)
      || transaction.currency !== currency
      || reportingTransactionType(transaction, categoryMap) !== 'expense'
      || rentIds.has(transaction.categoryId)) continue;
    const day = Number(transaction.dateStr.slice(8, 10));
    if (!Number.isInteger(day) || day < 1 || day > days.length) continue;
    days[day - 1] += transaction.amount;
    total += transaction.amount;
    const category = categoryMap.get(transaction.categoryId);
    const topId = category?.parentId || transaction.categoryId;
    byCategory.set(topId, (byCategory.get(topId) || 0) + transaction.amount);
  }

  return {
    days,
    categories: [...byCategory.entries()]
      .map(([id, amount]) => ({ id, name: categoryMap.get(id)?.name || '未分类', amount }))
      .sort((a, b) => b.amount - a.amount),
    total,
    rentCategoryFound: rentIds.size > 0,
  };
}
