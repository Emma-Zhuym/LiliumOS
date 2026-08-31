import type { FinanceCategory, FinanceCategoryReviewStatus, FinanceTransaction } from '../types';
import { FinanceDB } from './financeDb';

export const FINANCE_REVIEW_CHANGED_EVENT = 'liliumos:finance-review-changed';

export interface FinanceReviewChangedDetail {
  newTransactionCount?: number;
}

export const FINANCE_REVIEW_RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const HUMAN_REVIEW_STATES = new Set<FinanceCategoryReviewStatus>(['coarse', 'categorized']);
const AMBIGUOUS_MERCHANT_PATTERN = /\b(amazon|amzn|target|walmart|wal mart|costco|paypal|venmo|cash app)\b/i;

export function financeMerchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/\b(pending|purchase|debit|credit|visa|mastercard|card|pos)\b/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/[^a-z0-9\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAmazonTransaction(transaction: Pick<FinanceTransaction, 'sourceDescription' | 'note'>): boolean {
  return /\b(amazon|amzn)\b/i.test(transaction.sourceDescription || transaction.note || '');
}

export function learnedCategoryForTransaction(
  description: string,
  transactions: FinanceTransaction[],
): { categoryId: string; confidence: number } | null {
  const merchantKey = financeMerchantKey(description);
  if (!merchantKey || AMBIGUOUS_MERCHANT_PATTERN.test(merchantKey)) return null;

  const reviewed = transactions
    .filter(transaction =>
      transaction.source === 'simplefin'
      && financeMerchantKey(transaction.sourceDescription || transaction.note) === merchantKey
      && transaction.categoryId !== 'cat_uncategorized'
      && transaction.categoryReviewStatus !== 'auto'
      && (
        HUMAN_REVIEW_STATES.has(transaction.categoryReviewStatus as FinanceCategoryReviewStatus)
        || (transaction.categoryReviewStatus == null && transaction.needsCategoryReview === false)
      )
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);

  if (reviewed.length < 3) return null;
  const categoryId = reviewed[0].categoryId;
  return reviewed.every(transaction => transaction.categoryId === categoryId)
    ? { categoryId, confidence: 0.98 }
    : null;
}

export function reviewStatusForCategory(
  categoryId: string,
  categories: FinanceCategory[],
): FinanceCategoryReviewStatus {
  if (!categoryId || categoryId === 'cat_uncategorized') return 'unrecognized';
  return categories.some(category => category.id === categoryId && Boolean(category.parentId))
    ? 'categorized'
    : 'coarse';
}

export function isPendingFinanceReview(transaction: FinanceTransaction, now = Date.now()): boolean {
  if (transaction.source !== 'simplefin') return false;
  if (now - transaction.timestamp > FINANCE_REVIEW_RECENT_MS) return false;
  if (transaction.categoryReviewStatus != null) return transaction.categoryReviewStatus === 'unrecognized';
  return transaction.needsCategoryReview === true;
}

async function migrateRecentUnreviewedTransactions(): Promise<void> {
  const transactions = await FinanceDB.getTransactions();
  const recentCutoff = Date.now() - FINANCE_REVIEW_RECENT_MS;
  const missingState = transactions.filter(transaction =>
    transaction.source === 'simplefin' && transaction.needsCategoryReview == null,
  );
  if (missingState.length === 0) return;
  await FinanceDB.saveTransactions(missingState.map(transaction => ({
    ...transaction,
    needsCategoryReview: transaction.timestamp >= recentCutoff,
    categoryReviewStatus: transaction.timestamp >= recentCutoff ? 'unrecognized' : undefined,
  })));
}

export async function getFinanceReviewCount(): Promise<number> {
  await migrateRecentUnreviewedTransactions();
  const transactions = await FinanceDB.getTransactions();
  return transactions.filter(transaction => isPendingFinanceReview(transaction)).length;
}

export function announceFinanceReviewChanged(detail: FinanceReviewChangedDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<FinanceReviewChangedDetail>(FINANCE_REVIEW_CHANGED_EVENT, { detail }));
}
