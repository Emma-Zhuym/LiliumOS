import type { FinanceTransaction } from '../types';

// Observed authorization/final descriptors. Keep this deliberately narrow: a
// merchant name alone is not evidence that two different amounts are duplicates.
const HOLD_DESCRIPTION = /^instacart\s+159$/i;
const POSTED_DESCRIPTION = /^instacart\s*\*159\s+888-246-7822\s+CA$/i;

/** Preserve source rows, excluding only an unambiguous same-day hold group.
 * Multiple final debits are valid (for example, a separate tip) and stay intact.
 * Do not infer pending from the short description or overwrite provider status.
 */
export function reconcileInstacartHolds(
  transactions: FinanceTransaction[],
  syncedAt: number,
): FinanceTransaction[] {
  const groups = new Map<string, { holds: FinanceTransaction[]; posted: FinanceTransaction[] }>();
  for (const transaction of transactions) {
    if (transaction.source !== 'simplefin' || transaction.type !== 'expense'
      || !Number.isFinite(transaction.amount) || transaction.amount <= 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(transaction.dateStr)) continue;
    const description = transaction.sourceDescription?.trim() || '';
    const isHold = HOLD_DESCRIPTION.test(description);
    const isPosted = POSTED_DESCRIPTION.test(description)
      && !transaction.pending && !transaction.excludedFromReporting;
    if (!isHold && !isPosted) continue;
    const key = JSON.stringify([transaction.accountId, transaction.currency, transaction.dateStr]);
    const group = groups.get(key) || { holds: [], posted: [] };
    if (isHold) group.holds.push(transaction);
    if (isPosted) group.posted.push(transaction);
    groups.set(key, group);
  }

  const updates: FinanceTransaction[] = [];
  for (const { holds, posted } of groups.values()) {
    // Several holds on one day could belong to separate orders; do not guess.
    if (holds.length !== 1 || posted.length === 0) continue;
    const hold = holds[0];
    if (hold.excludedFromReporting && hold.needsCategoryReview === false) continue;
    updates.push({
      ...hold,
      excludedFromReporting: true,
      needsCategoryReview: false,
      sourceUpdatedAt: syncedAt,
    });
  }
  return updates;
}
