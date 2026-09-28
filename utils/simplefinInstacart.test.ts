import { describe, expect, it } from 'vitest';
import type { FinanceTransaction } from '../types';
import type { SimpleFinTransaction } from './simplefinClient';
import { normalizeSimpleFinSnapshot } from './simplefinSync';
import { reconcileInstacartHolds } from './simplefinInstacart';

// Synthetic amounts/dates: do not put personal bank records in fixtures.
const eventAt = new Date('2026-06-10T12:00:00Z').getTime();
const syncedAt = eventAt + 30 * 86400000;
const finalDescription = 'INSTACART*159 888-246-7822 CA';
const hold = (overrides: Partial<FinanceTransaction> = {}): FinanceTransaction => ({
  id: 'hold', externalId: 'hold', source: 'simplefin', type: 'expense',
  accountId: 'simplefin:demo:card', currency: 'USD', amount: 40,
  timestamp: eventAt, dateStr: '2026-06-10', sourceDescription: 'INSTACART 159',
  note: '保留本地备注', categoryId: 'cat_food', categoryReviewStatus: 'coarse',
  needsCategoryReview: false, pending: false, ...overrides,
});
const posted = (overrides: Partial<FinanceTransaction> = {}) => hold({
  id: 'final', externalId: 'final', amount: 70, sourceDescription: finalDescription,
  note: finalDescription, ...overrides,
});
const snapshot = (transactions: SimpleFinTransaction[]) => ({
  errlist: [], connections: [], accounts: [{
    id: 'card', conn_id: 'demo', name: 'Demo card', currency: 'USD',
    balance: '100', 'balance-date': syncedAt / 1000, transactions,
  }],
});
const incoming = (id: string, amount: string, description: string, pending = false): SimpleFinTransaction => ({
  id, amount, description, pending, posted: pending ? 0 : eventAt / 1000,
  transacted_at: eventAt / 1000,
});

describe('Instacart adjusted authorizations', () => {
  it.each([true, false])('excludes an adjusted hold, retaining both final debits (pending=%s)', pending => {
    const result = normalizeSimpleFinSnapshot(snapshot([
      incoming('hold', '-40', 'INSTACART 159', pending),
      incoming('final', '-70', finalDescription),
      incoming('tip', '-9', finalDescription),
    ]), [], [], syncedAt);
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions.find(tx => tx.externalId === 'hold')).toMatchObject({
      amount: 40, pending, excludedFromReporting: true, needsCategoryReview: false,
    });
    const reportable = result.transactions.filter(tx => !tx.excludedFromReporting);
    expect(reportable.map(tx => tx.amount).sort((a, b) => a - b)).toEqual([9, 70]);
    expect(reportable.reduce((sum, tx) => sum + tx.amount, 0)).toBe(79);
    expect(result.newTransactionCount).toBe(2);
  });

  it('repairs local history outside the fetched window without changing source or local edits', () => {
    const original = hold({ needsCategoryReview: true, categoryReviewStatus: 'snoozed' });
    const history = [original, posted(), posted({ id: 'tip', externalId: 'tip', amount: 9 })];
    const result = normalizeSimpleFinSnapshot(snapshot([]), [], history, syncedAt);
    expect(result.transactions).toEqual([{
      ...original, excludedFromReporting: true, needsCategoryReview: false, sourceUpdatedAt: syncedAt,
    }]);
    expect(original.excludedFromReporting).toBeUndefined();
    expect(result.newTransactionCount).toBe(0);
    expect(normalizeSimpleFinSnapshot(snapshot([]), [], [result.transactions[0], ...history.slice(1)], syncedAt)
      .transactions).toEqual([]);
  });

  it('keeps a repaired hold excluded when the provider sends it again', () => {
    const history = [hold({ excludedFromReporting: true }), posted()];
    const result = normalizeSimpleFinSnapshot(snapshot([
      incoming('hold', '-40', 'INSTACART 159'),
    ]), [], history, syncedAt);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      id: 'hold', excludedFromReporting: true, note: '保留本地备注', categoryId: 'cat_food',
    });
  });

  it('handles two separate days independently and leaves every final row unchanged', () => {
    const secondHold = hold({ id: 'hold-2', dateStr: '2026-06-25', amount: 30 });
    const finals = [posted(), posted({ id: 'final-2', dateStr: '2026-06-25', amount: 60 }),
      posted({ id: 'tip', dateStr: '2026-06-25', amount: 8 })];
    const updates = reconcileInstacartHolds([hold(), ...finals, secondHold], syncedAt);
    expect(updates.map(tx => tx.id).sort()).toEqual(['hold', 'hold-2']);
    expect(finals.every(tx => tx.excludedFromReporting === undefined)).toBe(true);
  });

  it.each([
    { accountId: 'other-account' }, { currency: 'EUR' }, { dateStr: '2026-06-09' },
    { dateStr: '2026-06-18' }, { type: 'refund' as const }, { excludedFromReporting: true },
    { source: undefined }, { sourceDescription: 'INSTACART*160 888-246-7822 CA' },
    { sourceDescription: 'INSTACART MEMBERSHIP' },
  ])('does not match an incompatible final transaction: %j', overrides => {
    expect(reconcileInstacartHolds([hold(), posted(overrides)], syncedAt)).toEqual([]);
  });

  it.each(['2026-06-11', '2026-06-17'])('matches a weighed final that settles on a later day (%s)', dateStr => {
    const updates = reconcileInstacartHolds([hold(), posted({ dateStr })], syncedAt);
    expect(updates.map(tx => tx.id)).toEqual(['hold']);
  });

  it('matches a final that is still pending', () => {
    expect(reconcileInstacartHolds([hold(), posted({ pending: true })], syncedAt).map(tx => tx.id))
      .toEqual(['hold']);
  });

  it('excludes a next-day final through the full sync path', () => {
    const nextDay = eventAt + 86400000;
    const result = normalizeSimpleFinSnapshot(snapshot([
      incoming('hold', '-40', 'INSTACART 159'),
      { ...incoming('final', '-70', finalDescription), posted: nextDay / 1000, transacted_at: nextDay / 1000 },
    ]), [], [], syncedAt);
    const reportable = result.transactions.filter(tx => !tx.excludedFromReporting);
    expect(reportable.map(tx => tx.externalId)).toEqual(['final']);
  });

  it('pairs holds and finals one to one, oldest first', () => {
    const second = hold({ id: 'second-hold', timestamp: eventAt + 3600000 });
    expect(reconcileInstacartHolds([second, hold(), posted()], syncedAt).map(tx => tx.id)).toEqual(['hold']);
    expect(reconcileInstacartHolds([second, hold(), posted(), posted({ id: 'final-2', dateStr: '2026-06-12' })], syncedAt)
      .map(tx => tx.id).sort()).toEqual(['hold', 'second-hold']);
  });

  it('keeps an already-excluded hold paired so a later hold waits for its own final', () => {
    const later = hold({ id: 'later', dateStr: '2026-06-12', timestamp: eventAt + 2 * 86400000 });
    const finals = [posted({ dateStr: '2026-06-12' })];
    expect(reconcileInstacartHolds([hold({ excludedFromReporting: true }), ...finals, later], syncedAt))
      .toEqual([]);
  });

  it('does not hide an unmatched hold or infer a source descriptor from a user note', () => {
    expect(reconcileInstacartHolds([hold()], syncedAt)).toEqual([]);
    expect(reconcileInstacartHolds([
      hold({ sourceDescription: undefined, note: 'INSTACART 159' }), posted(),
    ], syncedAt)).toEqual([]);
  });
});
