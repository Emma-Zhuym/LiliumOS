import type { FinanceCategory, FinanceTransaction } from '../types';
import { isFinanceTransactionReportable, reportingTransactionType } from './financeTransfers';

export interface LauncherExpenseChart {
  days: number[];
  categories: { id: string; name: string; amount: number }[];
  total: number;
  excludedCategoryNames: string[];
}

/** Desktop-only view of expenses. The underlying ledger is never changed. */
export function buildLauncherExpenseChart(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  year: number,
  month: number,
  currency: string,
  excludedCategoryIds: string[] = [],
): LauncherExpenseChart {
  const categoryMap = new Map(categories.map(category => [category.id, category]));
  const selectedIds = new Set(excludedCategoryIds.filter(id => categoryMap.has(id)));
  const excludedIds = new Set(selectedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentId && excludedIds.has(category.parentId) && !excludedIds.has(category.id)) {
        excludedIds.add(category.id);
        changed = true;
      }
    }
  }
  const excludedCategoryNames = [...selectedIds].map(id => {
    const category = categoryMap.get(id);
    if (!category) return '';
    const parent = category.parentId ? categoryMap.get(category.parentId) : undefined;
    return parent ? `${parent.name}／${category.name}` : category.name;
  }).filter(Boolean);
  const days = Array.from({ length: new Date(year, month, 0).getDate() }, () => 0);
  const byCategory = new Map<string, number>();
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  let total = 0;

  for (const transaction of transactions) {
    if (!isFinanceTransactionReportable(transaction)
      || !transaction.dateStr.startsWith(monthPrefix)
      || transaction.currency !== currency
      || reportingTransactionType(transaction, categoryMap) !== 'expense'
      || excludedIds.has(transaction.categoryId)) continue;
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
    excludedCategoryNames,
  };
}
