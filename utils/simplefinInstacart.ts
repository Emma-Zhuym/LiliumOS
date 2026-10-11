import type { FinanceTransaction } from '../types';

// Observed authorization/final descriptors. Keep this deliberately narrow: a
// merchant name alone is not evidence that two different amounts are duplicates.
const HOLD_DESCRIPTION = /^instacart\s+159$/i;
const POSTED_DESCRIPTION = /^instacart\s*\*159\s+888-246-7822\s+CA$/i;
// Weighed orders settle after delivery: the final debit can land on a later day
// (scheduled delivery, bank posting lag, or simply crossing local midnight).
const SETTLE_WINDOW_DAYS = 7;

const dayIndex = (dateStr: string): number => Date.UTC(
  Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)),
) / 86400000;

const byTime = (a: FinanceTransaction, b: FinanceTransaction) =>
  a.dateStr.localeCompare(b.dateStr) || a.timestamp - b.timestamp || a.id.localeCompare(b.id);

/** Preserve source rows, excluding a hold once its final debit has arrived.
 * Each hold claims the earliest unclaimed final debit on the same day or up to
 * SETTLE_WINDOW_DAYS later; holds are paired oldest first, one final each.
 * Extra final debits (for example, a separate tip) stay intact, and a hold with
 * no final yet stays reportable. Do not infer pending from the short
 * description or overwrite provider status.
 */
export function reconcileInstacartHolds(
  transactions: FinanceTransaction[],
  syncedAt: number,
): FinanceTransaction[] {
  const groups = new Map<string, { holds: FinanceTransaction[]; finals: FinanceTransaction[] }>();
  for (const transaction of transactions) {
    if (transaction.source !== 'simplefin' || transaction.type !== 'expense'
      || !Number.isFinite(transaction.amount) || transaction.amount <= 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(transaction.dateStr)) continue;
    const description = transaction.sourceDescription?.trim() || '';
    const isHold = HOLD_DESCRIPTION.test(description);
    // A pending final is still the settled charge; an excluded one is a superseded copy.
    const isFinal = POSTED_DESCRIPTION.test(description) && !transaction.excludedFromReporting;
    if (!isHold && !isFinal) continue;
    const key = JSON.stringify([transaction.accountId, transaction.currency]);
    const group = groups.get(key) || { holds: [], finals: [] };
    if (isHold) group.holds.push(transaction);
    if (isFinal) group.finals.push(transaction);
    groups.set(key, group);
  }

  const updates: FinanceTransaction[] = [];
  for (const { holds, finals } of groups.values()) {
    const unclaimed = [...finals].sort(byTime);
    // Already-excluded holds still claim their final so pairing stays stable across syncs.
    for (const hold of [...holds].sort(byTime)) {
      const holdDay = dayIndex(hold.dateStr);
      const index = unclaimed.findIndex(final => {
        const gap = dayIndex(final.dateStr) - holdDay;
        return gap >= 0 && gap <= SETTLE_WINDOW_DAYS;
      });
      if (index < 0) continue;
      unclaimed.splice(index, 1);
      if (hold.excludedFromReporting && hold.needsCategoryReview === false) continue;
      updates.push({
        ...hold,
        excludedFromReporting: true,
        needsCategoryReview: false,
        sourceUpdatedAt: syncedAt,
      });
    }
  }
  return updates;
}
