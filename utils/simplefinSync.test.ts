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
