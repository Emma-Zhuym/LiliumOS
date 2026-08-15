import { beforeEach, describe, expect, it } from 'vitest';
import type { FinanceTransaction } from '../types';
import { FinanceDB } from './financeDb';
import { getFinanceReviewCount } from './financeReview';

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

  it('adopts only recent synced rows created before review tracking existed', async () => {
    const recent = transaction('recent-legacy', 'simplefin', false);
    delete recent.needsCategoryReview;
    const old = transaction('old-legacy', 'simplefin', false);
    old.timestamp = Date.now() - 2 * 24 * 60 * 60 * 1000;
    delete old.needsCategoryReview;
    await FinanceDB.saveTransactions([recent, old]);

    await expect(getFinanceReviewCount()).resolves.toBe(1);
    await expect(FinanceDB.getTransaction('old-legacy')).resolves.toMatchObject({ needsCategoryReview: false });
  });
});
