import { beforeEach, describe, expect, it } from 'vitest';
import type { FinanceTransaction } from '../types';
import { FinanceDB } from './financeDb';
import {
  FINANCE_REVIEW_RECENT_MS,
  getFinanceReviewCount,
  isAmazonTransaction,
  learnedCategoryForTransaction,
  reviewStatusForCategory,
} from './financeReview';

function transaction(id: string, source: FinanceTransaction['source'], needsCategoryReview: boolean): FinanceTransaction {
  return {
    id,
    type: 'expense',
    amount: 10,
    currency: 'USD',
    accountId: 'account-1',
    categoryId: 'cat_uncategorized',
    note: id,
    timestamp: Date.now(),
    dateStr: '2026-08-15',
    source,
    needsCategoryReview,
  };
}

describe('finance review badge', () => {
  beforeEach(async () => {
    await FinanceDB.importAll({ accounts: [], categories: [], transactions: [], settings: [], recurringRules: [], taComments: [] });
  });

  it('counts only synced transactions still awaiting category confirmation', async () => {
    await FinanceDB.saveTransactions([
      transaction('pending-simplefin', 'simplefin', true),
      transaction('reviewed-simplefin', 'simplefin', false),
      transaction('manual', 'manual', true),
    ]);

    await expect(getFinanceReviewCount()).resolves.toBe(1);
  });

  it('adopts only the last seven days of synced rows created before review tracking existed', async () => {
    const recent = transaction('recent-legacy', 'simplefin', false);
    delete recent.needsCategoryReview;
    const old = transaction('old-legacy', 'simplefin', false);
    old.timestamp = Date.now() - FINANCE_REVIEW_RECENT_MS - 1;
    delete old.needsCategoryReview;
    await FinanceDB.saveTransactions([recent, old]);

    await expect(getFinanceReviewCount()).resolves.toBe(1);
    await expect(FinanceDB.getTransaction('old-legacy')).resolves.toMatchObject({ needsCategoryReview: false });
  });

  it('keeps old unresolved rows out of the attention badge after seven days', async () => {
    const old = transaction('old-unrecognized', 'simplefin', true);
    old.timestamp = Date.now() - FINANCE_REVIEW_RECENT_MS - 1;
    old.categoryReviewStatus = 'unrecognized';
    await FinanceDB.saveTransaction(old);

    await expect(getFinanceReviewCount()).resolves.toBe(0);
  });

  it('does not count snoozed or automatically categorized rows', async () => {
    const snoozed = transaction('snoozed', 'simplefin', false);
    snoozed.categoryReviewStatus = 'snoozed';
    const automatic = transaction('automatic', 'simplefin', false);
    automatic.categoryReviewStatus = 'auto';
    automatic.categoryId = 'cat_food';
    await FinanceDB.saveTransactions([snoozed, automatic]);

    await expect(getFinanceReviewCount()).resolves.toBe(0);
  });

  it('does not count an authorization hold after a posted transaction supersedes it', async () => {
    const hold = transaction('lyft-hold', 'simplefin', true);
    hold.excludedFromReporting = true;
    hold.supersededByExternalId = 'lyft-posted';
    await FinanceDB.saveTransaction(hold);

    await expect(getFinanceReviewCount()).resolves.toBe(0);
  });
});

describe('progressive category review', () => {
  it('treats a top-level category as complete without requiring a child category', () => {
    expect(reviewStatusForCategory('cat_shopping', [
      { id: 'cat_shopping', name: '购物' },
      { id: 'cat_shopping_daily', name: '日用品', parentId: 'cat_shopping' },
    ])).toBe('coarse');
    expect(reviewStatusForCategory('cat_shopping_daily', [
      { id: 'cat_shopping', name: '购物' },
      { id: 'cat_shopping_daily', name: '日用品', parentId: 'cat_shopping' },
    ])).toBe('categorized');
  });

  it('learns a stable merchant only after three matching human confirmations', () => {
    const history = [0, 1, 2].map(index => ({
      ...transaction(`whole-foods-${index}`, 'simplefin', false),
      categoryId: 'cat_food',
      sourceDescription: `WHOLE FOODS MARKET ${1000 + index}`,
      categoryReviewStatus: 'coarse' as const,
      timestamp: Date.now() - index * 1000,
    }));

    expect(learnedCategoryForTransaction('WHOLE FOODS MARKET 9999', history)).toEqual({
      categoryId: 'cat_food',
      confidence: 0.98,
    });
    expect(learnedCategoryForTransaction('WHOLE FOODS MARKET 9999', history.slice(0, 2))).toBeNull();
  });

  it('never auto-learns multi-category Amazon purchases', () => {
    const history = [0, 1, 2].map(index => ({
      ...transaction(`amazon-${index}`, 'simplefin', false),
      categoryId: 'cat_shopping',
      sourceDescription: `AMAZON MKTPL ${1000 + index}`,
      categoryReviewStatus: 'coarse' as const,
    }));

    expect(learnedCategoryForTransaction('AMAZON MKTPL 9999', history)).toBeNull();
    expect(isAmazonTransaction(history[0])).toBe(true);
  });
});
