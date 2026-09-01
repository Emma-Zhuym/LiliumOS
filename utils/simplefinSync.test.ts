import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceAccount, FinanceTransaction } from '../types';
import { claimSimpleFinSetupToken, fetchSimpleFinAccounts, forgetSimpleFinConnection } from './simplefinClient';
import { normalizeSimpleFinSnapshot } from './simplefinSync';

const SYNCED_AT = new Date('2026-08-15T12:00:00-05:00').getTime();

const snapshot = {
  errlist: [],
  connections: [{ conn_id: 'demo', name: 'Demo Bank' }],
  accounts: [{
    id: 'credit-1',
    name: 'Discover it Card',
    conn_id: 'demo',
    currency: 'USD',
    balance: '345.67',
    'available-balance': '4654.33',
    'balance-date': 1_776_450_000,
    transactions: [{
      id: 'posted-1',
      posted: 1_776_360_000,
      amount: '-82.37',
      description: 'TARGET 0001',
      extra: { category: 'Shopping' },
    }],
  }],
};

describe('normalizeSimpleFinSnapshot', () => {
  it('imports credit balances as liabilities and stores provider metadata', () => {
    const normalized = normalizeSimpleFinSnapshot(snapshot, [], [], SYNCED_AT);
    expect(normalized.accounts[0]).toMatchObject({
      id: 'simplefin:demo:credit-1',
      type: 'credit',
      source: 'simplefin',
      syncedBalance: -345.67,
      availableBalance: 4654.33,
    });
    expect(normalized.transactions[0]).toMatchObject({
      type: 'expense',
      amount: 82.37,
      categoryId: 'cat_uncategorized',
      sourceDescription: 'TARGET 0001',
      sourceCategory: 'Shopping',
      needsCategoryReview: true,
      categoryReviewStatus: 'unrecognized',
    });
    expect(normalized.newTransactionCount).toBe(1);
  });

  it('preserves LiliumOS category and note choices on later syncs', () => {
    const account: FinanceAccount = {
      id: 'simplefin:demo:credit-1',
      name: 'Discover',
      nickname: '日常返现卡',
      type: 'savings',
      currency: 'USD',
      initialBalance: 0,
      color: '#000',
      icon: '🪙',
      source: 'simplefin',
    };
    const transaction: FinanceTransaction = {
      id: 'simplefin-tx:demo:credit-1:posted-1',
      type: 'expense',
      amount: 82.37,
      currency: 'USD',
      accountId: account.id,
      categoryId: 'cat_pet_supplies',
      note: '猫砂和清洁用品',
      timestamp: 1_776_360_000_000,
      dateStr: '2026-04-15',
      source: 'simplefin',
      externalId: 'posted-1',
    };
    const normalized = normalizeSimpleFinSnapshot(snapshot, [account], [transaction], SYNCED_AT);
    expect(normalized.transactions[0]).toMatchObject({
      id: transaction.id,
      categoryId: 'cat_pet_supplies',
      note: '猫砂和清洁用品',
      needsCategoryReview: false,
    });
    expect(normalized.newTransactionCount).toBe(0);
    expect(normalized.accounts[0]).toMatchObject({
      nickname: '日常返现卡',
      type: 'savings',
      icon: '🪙',
      color: '#000',
      externalName: 'Discover it Card',
      syncedBalance: 345.67,
    });
  });

  it('only asks for recent classification on the first historical import', () => {
    const transactionAt = snapshot.accounts[0].transactions[0].posted * 1000;
    const normalized = normalizeSimpleFinSnapshot(snapshot, [], [], SYNCED_AT, transactionAt + 1);
    expect(normalized.transactions[0].needsCategoryReview).toBe(false);
    expect(normalized.transactions[0].categoryReviewStatus).toBeUndefined();
    expect(normalized.newTransactionCount).toBe(0);
  });

  it('applies a category after three matching merchant confirmations', () => {
    const wholeFoodsSnapshot = {
      ...snapshot,
      accounts: [{
        ...snapshot.accounts[0],
        transactions: [{
          ...snapshot.accounts[0].transactions[0],
          id: 'whole-foods-new',
          description: 'WHOLE FOODS MARKET 9999',
        }],
      }],
    };
    const history: FinanceTransaction[] = [0, 1, 2].map(index => ({
      id: `whole-foods-${index}`,
      type: 'expense',
      amount: 25 + index,
      currency: 'USD',
      accountId: 'simplefin:demo:credit-1',
      categoryId: 'cat_food',
      note: `WHOLE FOODS MARKET ${1000 + index}`,
      timestamp: SYNCED_AT - (index + 1) * 24 * 60 * 60 * 1000,
      dateStr: '2026-08-14',
      source: 'simplefin',
      externalId: `whole-foods-${index}`,
      sourceDescription: `WHOLE FOODS MARKET ${1000 + index}`,
      needsCategoryReview: false,
      categoryReviewStatus: 'coarse',
    }));

    const normalized = normalizeSimpleFinSnapshot(wholeFoodsSnapshot, [], history, SYNCED_AT);
    expect(normalized.transactions[0]).toMatchObject({
      categoryId: 'cat_food',
      needsCategoryReview: false,
      categoryReviewStatus: 'auto',
      autoCategoryConfidence: 0.98,
    });
    expect(normalized.newTransactionCount).toBe(0);
  });

  it('reuses a matching pending row when the posted transaction gets a new id', () => {
    const pending: FinanceTransaction = {
      id: 'simplefin-tx:demo:credit-1:pending-1',
      type: 'expense',
      amount: 82.37,
      currency: 'USD',
      accountId: 'simplefin:demo:credit-1',
      categoryId: 'cat_shopping',
      note: 'TARGET 0001',
      timestamp: 1_776_360_000_000,
      dateStr: '2026-04-15',
      source: 'simplefin',
      externalId: 'pending-1',
      sourceDescription: 'TARGET 0001',
      pending: true,
    };
    const normalized = normalizeSimpleFinSnapshot(snapshot, [], [pending], SYNCED_AT);
    expect(normalized.transactions[0]).toMatchObject({
      id: pending.id,
      externalId: 'posted-1',
      pending: false,
      categoryId: 'cat_shopping',
    });
  });

  it('keeps local categorization when a provider reissues an otherwise identical id', () => {
    const previous: FinanceTransaction = {
      id: 'simplefin-tx:demo:credit-1:old-provider-id',
      type: 'expense',
      amount: 82.37,
      currency: 'USD',
      accountId: 'simplefin:demo:credit-1',
      categoryId: 'cat_shopping',
      note: '给猫买的东西',
      timestamp: 1_776_360_000_000,
      dateStr: '2026-04-15',
      source: 'simplefin',
      externalId: 'old-provider-id',
      sourceDescription: 'TARGET 0001',
      pending: false,
    };
    const normalized = normalizeSimpleFinSnapshot(snapshot, [], [previous], SYNCED_AT);
    expect(normalized.transactions[0]).toMatchObject({
      id: previous.id,
      externalId: 'posted-1',
      categoryId: 'cat_shopping',
      note: '给猫买的东西',
    });
  });

  it('keeps a Lyft authorization hold for audit but excludes it when the posted ride arrives', () => {
    const lyftSnapshot = {
      ...snapshot,
      accounts: [{
        ...snapshot.accounts[0],
        transactions: [
          {
            id: 'lyft-hold-754',
            posted: 0,
            transacted_at: 1_777_244_400,
            amount: '-7.54',
            description: 'LYFT TEMP AUTH HOLD',
            pending: true,
          },
          {
            id: 'lyft-posted-754',
            posted: 1_777_330_800,
            transacted_at: 1_777_244_400,
            amount: '-7.54',
            description: 'LYFT *PRIORITY 08-26 LYFT.COM CA',
          },
        ],
      }],
    };

    const normalized = normalizeSimpleFinSnapshot(lyftSnapshot, [], [], SYNCED_AT);
    const hold = normalized.transactions.find(transaction => transaction.externalId === 'lyft-hold-754');
    const posted = normalized.transactions.find(transaction => transaction.externalId === 'lyft-posted-754');
    expect(hold).toMatchObject({
      pending: true,
      excludedFromReporting: true,
      supersededByExternalId: 'lyft-posted-754',
      needsCategoryReview: false,
    });
    expect(posted).toMatchObject({ pending: false, excludedFromReporting: false });
    expect(normalized.newTransactionCount).toBe(1);
  });

  it('repairs an existing hold/posted duplicate without deleting either source record', () => {
    const accountId = 'simplefin:demo:credit-1';
    const hold: FinanceTransaction = {
      id: 'local-lyft-hold',
      type: 'expense',
      amount: 7.54,
      currency: 'USD',
      accountId,
      categoryId: 'cat_transport',
      note: '去学校的 Lyft',
      timestamp: 1_777_244_400_000,
      dateStr: '2026-04-25',
      source: 'simplefin',
      externalId: 'lyft-hold-754',
      sourceDescription: 'LYFT TEMP AUTH HOLD',
      pending: true,
      needsCategoryReview: false,
      categoryReviewStatus: 'coarse',
    };
    const posted: FinanceTransaction = {
      ...hold,
      id: 'local-lyft-posted',
      categoryId: 'cat_uncategorized',
      note: 'LYFT *PRIORITY 08-26 LYFT.COM CA',
      timestamp: 1_777_330_800_000,
      externalId: 'lyft-posted-754',
      sourceDescription: 'LYFT *PRIORITY 08-26 LYFT.COM CA',
      pending: false,
      needsCategoryReview: true,
      categoryReviewStatus: 'unrecognized',
    };
    const lyftSnapshot = {
      ...snapshot,
      accounts: [{
        ...snapshot.accounts[0],
        transactions: [{
          id: 'lyft-posted-754',
          posted: 1_777_330_800,
          transacted_at: 1_777_244_400,
          amount: '-7.54',
          description: 'LYFT *PRIORITY 08-26 LYFT.COM CA',
        }],
      }],
    };

    const normalized = normalizeSimpleFinSnapshot(lyftSnapshot, [], [hold, posted], SYNCED_AT);
    const repairedHold = normalized.transactions.find(transaction => transaction.id === hold.id);
    const repairedPosted = normalized.transactions.find(transaction => transaction.id === posted.id);
    expect(repairedHold).toMatchObject({
      excludedFromReporting: true,
      supersededByExternalId: 'lyft-posted-754',
      needsCategoryReview: false,
    });
    expect(repairedPosted).toMatchObject({
      categoryId: 'cat_transport',
      note: '去学校的 Lyft',
      pending: false,
      excludedFromReporting: false,
    });
  });

  it('leaves equally plausible same-amount holds visible instead of guessing', () => {
    const postedAt = 1_777_330_800;
    const ambiguousSnapshot = {
      ...snapshot,
      accounts: [{
        ...snapshot.accounts[0],
        transactions: [
          { id: 'hold-a', posted: 0, transacted_at: postedAt - 60, amount: '-7.54', description: 'LYFT TEMP AUTH HOLD', pending: true },
          { id: 'hold-b', posted: 0, transacted_at: postedAt + 60, amount: '-7.54', description: 'LYFT TEMP AUTH HOLD', pending: true },
          { id: 'posted', posted: postedAt, transacted_at: postedAt, amount: '-7.54', description: 'LYFT *PRIORITY LYFT.COM CA' },
        ],
      }],
    };

    const normalized = normalizeSimpleFinSnapshot(ambiguousSnapshot, [], [], SYNCED_AT);
    expect(normalized.transactions.filter(transaction => transaction.excludedFromReporting)).toHaveLength(0);
  });
});

describe('SimpleFIN client', () => {
  beforeEach(() => {
    localStorage.clear();
    forgetSimpleFinConnection();
  });

  it('claims a one-time setup token and sends credentials only as Basic auth', async () => {
    const claimUrl = 'https://bridge.example/simplefin/claim/demo';
    const setupToken = btoa(claimUrl);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('https://demo-user:demo-pass@bridge.example/simplefin'))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { headers: { 'content-type': 'application/json' } }));

    await claimSimpleFinSetupToken(setupToken, fetchImpl as typeof fetch);
    await fetchSimpleFinAccounts({ startDate: 100, endDate: 200, fetchImpl: fetchImpl as typeof fetch });

    const [requestUrl, init] = fetchImpl.mock.calls[1];
    expect(requestUrl).toContain('https://bridge.example/simplefin/accounts?');
    expect(requestUrl).not.toContain('demo-user');
    expect(requestUrl).toContain('version=2');
    expect(requestUrl).toContain('pending=1');
    expect(init.headers.Authorization).toBe(`Basic ${btoa('demo-user:demo-pass')}`);
  });

  it('explains that an email sign-in code is not a setup token', async () => {
    await expect(claimSimpleFinSetupToken('123456'))
      .rejects.toThrow('可能是邮件里的登录验证码');
  });
});
