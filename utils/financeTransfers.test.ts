import { describe, expect, it } from 'vitest';
import type { FinanceAccount, FinanceCategory, FinanceTransaction } from '../types';
import {
  CREDIT_CARD_PAYMENT_CATEGORY_ID,
  findCreditCardPaymentCounterpart,
  reportingTransactionType,
} from './financeTransfers';

const categories = new Map<string, FinanceCategory>([
  ['cat_transfer', { id: 'cat_transfer', name: '转账' }],
  [CREDIT_CARD_PAYMENT_CATEGORY_ID, {
    id: CREDIT_CARD_PAYMENT_CATEGORY_ID,
    name: '信用卡还款',
    parentId: 'cat_transfer',
  }],
]);

function transaction(patch: Partial<FinanceTransaction>): FinanceTransaction {
  return {
    id: 'tx',
    type: 'expense',
    amount: 500,
    currency: 'USD',
    accountId: 'checking',
    categoryId: CREDIT_CARD_PAYMENT_CATEGORY_ID,
    note: 'Payment',
    timestamp: Date.now(),
    dateStr: '2026-08-15',
    ...patch,
  };
}

describe('finance transfer semantics', () => {
  it('reports repayment categories as transfers instead of spending or income', () => {
    expect(reportingTransactionType(transaction({}), categories)).toBe('transfer');
    expect(reportingTransactionType(transaction({ type: 'income', accountId: 'credit' }), categories)).toBe('transfer');
  });

  it('pairs an exact checking debit with a nearby credit-card payment credit', () => {
    const accounts = new Map<string, FinanceAccount>([
      ['checking', { id: 'checking', name: 'Checking', type: 'checking', currency: 'USD', initialBalance: 0, color: '#000' }],
      ['credit', { id: 'credit', name: 'Credit', type: 'credit', currency: 'USD', initialBalance: 0, color: '#000' }],
    ]);
    const debit = transaction({ id: 'debit' });
    const credit = transaction({
      id: 'credit-side',
      type: 'income',
      accountId: 'credit',
      categoryId: 'cat_uncategorized',
      timestamp: debit.timestamp + 24 * 60 * 60 * 1000,
    });
    expect(findCreditCardPaymentCounterpart(debit, [debit, credit], accounts)?.id).toBe(credit.id);
  });

  it('does not guess when two equally close counterparts exist', () => {
    const accounts = new Map<string, FinanceAccount>([
      ['checking', { id: 'checking', name: 'Checking', type: 'checking', currency: 'USD', initialBalance: 0, color: '#000' }],
      ['credit-a', { id: 'credit-a', name: 'Credit A', type: 'credit', currency: 'USD', initialBalance: 0, color: '#000' }],
      ['credit-b', { id: 'credit-b', name: 'Credit B', type: 'credit', currency: 'USD', initialBalance: 0, color: '#000' }],
    ]);
    const debit = transaction({ id: 'debit' });
    const first = transaction({ id: 'first', type: 'income', accountId: 'credit-a', timestamp: debit.timestamp + 1000 });
    const second = transaction({ id: 'second', type: 'income', accountId: 'credit-b', timestamp: debit.timestamp - 1000 });
    expect(findCreditCardPaymentCounterpart(debit, [debit, first, second], accounts)).toBeUndefined();
  });
});
