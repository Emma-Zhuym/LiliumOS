import { FinanceDB } from './financeDb';

export const FINANCE_REVIEW_CHANGED_EVENT = 'sullyem:finance-review-changed';

export interface FinanceReviewChangedDetail {
  newTransactionCount?: number;
}

async function migrateRecentUnreviewedTransactions(): Promise<void> {
  const transactions = await FinanceDB.getTransactions();
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const missingState = transactions.filter(transaction =>
    transaction.source === 'simplefin' && transaction.needsCategoryReview == null,
  );
  if (missingState.length === 0) return;
  await FinanceDB.saveTransactions(missingState.map(transaction => ({
    ...transaction,
    needsCategoryReview: transaction.timestamp >= recentCutoff,
  })));
}

export async function getFinanceReviewCount(): Promise<number> {
  await migrateRecentUnreviewedTransactions();
  const transactions = await FinanceDB.getTransactions();
  return transactions.filter(transaction =>
    transaction.source === 'simplefin' && transaction.needsCategoryReview === true,
  ).length;
}

export function announceFinanceReviewChanged(detail: FinanceReviewChangedDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<FinanceReviewChangedDetail>(FINANCE_REVIEW_CHANGED_EVENT, { detail }));
}
