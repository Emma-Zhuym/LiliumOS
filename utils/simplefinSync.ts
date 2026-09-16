import type { FinanceAccount, FinanceTransaction } from '../types';
import { HUE } from './clayTokens';
import { FinanceDB } from './financeDb';
import { reconcileInstacartHolds } from './simplefinInstacart';
import { announceFinanceReviewChanged, learnedCategoryForTransaction } from './financeReview';
import {
  fetchSimpleFinAccounts,
  hasSimpleFinConnection,
  type SimpleFinAccount,
  type SimpleFinAccountSet,
  type SimpleFinTransaction,
} from './simplefinClient';

export interface SimpleFinSyncState {
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  accountCount?: number;
  transactionCount?: number;
  errors?: string[];
  lastError?: string;
}

export interface SimpleFinSyncResult {
  accountCount: number;
  transactionCount: number;
  newTransactionCount: number;
  errors: string[];
  syncedAt: number;
}

export const SIMPLEFIN_SYNC_STATE_KEY = 'simplefinSyncState';
export const SIMPLEFIN_STALE_MS = 6 * 60 * 60 * 1000;

const SIMPLEFIN_ACCOUNT_COLORS = [
  HUE.blue.main,
  HUE.teal.main,
  HUE.indigo.main,
  HUE.mint.main,
  HUE.purple.main,
];

const AUTHORIZATION_HOLD_PATTERN = /\b(?:pending|temp(?:orary)?\s+auth(?:orization)?|auth(?:orization)?\s+hold|preauth(?:orization)?)\b/i;
const MERCHANT_NOISE = new Set([
  'pending', 'temp', 'temporary', 'auth', 'authorization', 'hold', 'preauth', 'preauthorization',
  'purchase', 'debit', 'credit', 'visa', 'mastercard', 'card', 'pos', 'com', 'ca', 'help',
]);
const PENDING_REPLACEMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const dateKeyFromSeconds = (seconds: number): string => {
  const date = new Date(seconds * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const simpleFinAccountKey = (connectionId: string, accountId: string): string =>
  `simplefin:${connectionId}:${accountId}`;

function inferAccountType(name: string): FinanceAccount['type'] {
  const value = name.toLowerCase();
  if (/broker|invest|retire|\bira\b|401|fidelity|vanguard|schwab/.test(value)) return 'investment';
  if (/credit|card|visa|mastercard|discover it|amex/.test(value)) return 'credit';
  if (/saving|money market/.test(value)) return 'savings';
  if (/cash management|\bcma\b|checking|spend/.test(value)) return 'checking';
  return 'checking';
}

function normalizedBalance(account: SimpleFinAccount, type: FinanceAccount['type']): number {
  const raw = Number(account.balance);
  if (!Number.isFinite(raw)) return 0;
  return type === 'credit' ? -Math.abs(raw) : raw;
}

function normalizeDescription(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, ' ').trim();
}

function merchantStem(value: string): string {
  const normalized = normalizeDescription(value).replace(/\bubr\b/g, 'uber');
  return normalized.split(' ').find(token =>
    token.length >= 3
    && !/^\d+$/.test(token)
    && !MERCHANT_NOISE.has(token)
  ) || '';
}

function isIncomingPending(transaction: SimpleFinTransaction): boolean {
  return Boolean(
    transaction.pending
    || transaction.posted === 0
    || AUTHORIZATION_HOLD_PATTERN.test(transaction.description),
  );
}

function isStoredPending(transaction: FinanceTransaction): boolean {
  return Boolean(
    transaction.pending
    || AUTHORIZATION_HOLD_PATTERN.test(transaction.sourceDescription || transaction.note),
  );
}

function incomingEventAt(transaction: SimpleFinTransaction): number {
  return (transaction.transacted_at || transaction.posted || 0) * 1000;
}

function isPendingReplacement(
  pendingAmount: number,
  pendingDescription: string,
  pendingAt: number,
  postedAmount: number,
  postedDescription: string,
  postedAt: number,
): boolean {
  const pendingMerchant = merchantStem(pendingDescription);
  return Boolean(
    pendingMerchant
    && pendingMerchant === merchantStem(postedDescription)
    && Math.abs(pendingAmount - postedAmount) < 0.005
    && Math.abs(pendingAt - postedAt) <= PENDING_REPLACEMENT_WINDOW_MS,
  );
}

function hasLocalTransactionEdits(transaction: FinanceTransaction | undefined): boolean {
  return Boolean(transaction && (
    transaction.categoryId !== 'cat_uncategorized'
    || (transaction.note && transaction.note !== transaction.sourceDescription)
  ));
}

function closestUniqueByTime<T>(candidates: T[], getTime: (candidate: T) => number, targetAt: number): T | undefined {
  const sorted = [...candidates]
    .sort((a, b) => Math.abs(getTime(a) - targetAt) - Math.abs(getTime(b) - targetAt));
  if (sorted.length > 1 && Math.abs(getTime(sorted[0]) - targetAt) === Math.abs(getTime(sorted[1]) - targetAt)) {
    return undefined;
  }
  return sorted[0];
}

function matchedIncomingAuthorizationHolds(transactions: SimpleFinTransaction[]): Map<string, string> {
  const matches = new Map<string, string>();
  const usedPending = new Set<string>();
  const pending = transactions.filter(isIncomingPending);
  const posted = transactions.filter(transaction => !isIncomingPending(transaction));

  for (const postedTransaction of posted) {
    const postedAt = incomingEventAt(postedTransaction);
    const candidates = pending
      .filter(transaction => !usedPending.has(transaction.id))
      .filter(transaction => isPendingReplacement(
        Math.abs(Number(transaction.amount)),
        transaction.description,
        incomingEventAt(transaction),
        Math.abs(Number(postedTransaction.amount)),
        postedTransaction.description,
        postedAt,
      ));
    const candidate = closestUniqueByTime(candidates, incomingEventAt, postedAt);
    if (!candidate) continue;
    matches.set(candidate.id, postedTransaction.id);
    usedPending.add(candidate.id);
  }
  return matches;
}

function sourceCategory(transaction: SimpleFinTransaction): string | undefined {
  const category = transaction.extra?.category;
  return typeof category === 'string' && category.trim() ? category.trim() : undefined;
}

function inferTransactionType(transaction: SimpleFinTransaction): FinanceTransaction['type'] {
  const amount = Number(transaction.amount);
  if (amount < 0) return 'expense';
  return /refund|reversal|cash ?back|returned/i.test(transaction.description) ? 'refund' : 'income';
}

function findExistingTransaction(
  incoming: SimpleFinTransaction,
  accountId: string,
  existing: FinanceTransaction[],
): FinanceTransaction | undefined {
  const direct = existing.find(transaction =>
    transaction.source === 'simplefin'
    && transaction.accountId === accountId
    && transaction.externalId === incoming.id,
  );
  const incomingAmount = Math.abs(Number(incoming.amount));
  const incomingAt = incomingEventAt(incoming);
  const incomingDescription = normalizeDescription(incoming.description);
  const sameTransaction = (transaction: FinanceTransaction) =>
    transaction.source === 'simplefin'
    && transaction.accountId === accountId
    && Math.abs(transaction.amount - incomingAmount) < 0.005
    && normalizeDescription(transaction.sourceDescription || transaction.note) === incomingDescription
    && Math.abs(transaction.timestamp - incomingAt) <= 60 * 1000;

  // Some providers replace ids when pending transactions post. A stable local fingerprint
  // also keeps user categorization intact when a provider reissues an otherwise identical id.
  const fingerprintMatches = existing.filter(sameTransaction);
  const pendingCandidates = isIncomingPending(incoming) ? [] : existing.filter(transaction =>
    transaction.source === 'simplefin'
    && transaction.accountId === accountId
    && isStoredPending(transaction)
    && isPendingReplacement(
      transaction.amount,
      transaction.sourceDescription || transaction.note,
      transaction.timestamp,
      incomingAmount,
      incoming.description,
      incomingAt,
    ),
  );
  const closestPending = closestUniqueByTime(pendingCandidates, transaction => transaction.timestamp, incomingAt);
  const pendingMatches = closestPending ? [closestPending] : [];
  const candidates = [...fingerprintMatches, ...pendingMatches];
  const locallyEdited = candidates.find(transaction =>
    transaction.categoryId !== 'cat_uncategorized'
    || Boolean(transaction.note && transaction.note !== transaction.sourceDescription),
  );
  return direct
    || locallyEdited
    || candidates.find(transaction => transaction.pending === true)
    || candidates[0];
}

export function normalizeSimpleFinSnapshot(
  snapshot: SimpleFinAccountSet,
  currentAccounts: FinanceAccount[],
  currentTransactions: FinanceTransaction[],
  syncedAt: number,
  reviewSince = Number.NEGATIVE_INFINITY,
): { accounts: FinanceAccount[]; transactions: FinanceTransaction[]; newTransactionCount: number } {
  const existingAccounts = new Map(currentAccounts.map(account => [account.id, account]));
  const accounts: FinanceAccount[] = [];
  const transactions: FinanceTransaction[] = [];
  const holdUpdates = new Map<string, FinanceTransaction>();
  const newReviewTransactionIds = new Set<string>();

  snapshot.accounts.forEach((sourceAccount, index) => {
    const id = simpleFinAccountKey(sourceAccount.conn_id, sourceAccount.id);
    const existing = existingAccounts.get(id);
    const inferredType = existing?.type || inferAccountType(sourceAccount.name);
    const rawBalance = Number(sourceAccount.balance);
    const rawAvailable = Number(sourceAccount['available-balance']);
    const account: FinanceAccount = {
      ...existing,
      id,
      name: existing?.name || sourceAccount.name,
      type: inferredType,
      currency: sourceAccount.currency || existing?.currency || 'USD',
      initialBalance: existing?.initialBalance || 0,
      color: existing?.color || SIMPLEFIN_ACCOUNT_COLORS[index % SIMPLEFIN_ACCOUNT_COLORS.length],
      source: 'simplefin',
      externalId: sourceAccount.id,
      externalConnectionId: sourceAccount.conn_id,
      externalName: sourceAccount.name,
      sourceBalance: Number.isFinite(rawBalance) ? rawBalance : undefined,
      syncedBalance: normalizedBalance(sourceAccount, inferredType),
      availableBalance: Number.isFinite(rawAvailable) ? rawAvailable : undefined,
      balanceUpdatedAt: sourceAccount['balance-date'] ? sourceAccount['balance-date'] * 1000 : syncedAt,
      lastSyncedAt: syncedAt,
    };
    accounts.push(account);

    const sourceTransactions = sourceAccount.transactions || [];
    const incomingHoldMatches = matchedIncomingAuthorizationHolds(sourceTransactions);
    for (const sourceTransaction of sourceTransactions) {
      const numericAmount = Number(sourceTransaction.amount);
      if (!Number.isFinite(numericAmount)) continue;
      const incomingPending = isIncomingPending(sourceTransaction);
      const incomingAt = incomingEventAt(sourceTransaction);
      const matchingExistingHoldCandidates = incomingPending ? [] : currentTransactions.filter(transaction =>
        transaction.source === 'simplefin'
        && transaction.accountId === id
        && isStoredPending(transaction)
        && isPendingReplacement(
          transaction.amount,
          transaction.sourceDescription || transaction.note,
          transaction.timestamp,
          Math.abs(numericAmount),
          sourceTransaction.description,
          incomingAt,
        ),
      );
      const closestExistingHold = closestUniqueByTime(
        matchingExistingHoldCandidates,
        transaction => transaction.timestamp,
        incomingAt,
      );
      const matchingExistingHolds = closestExistingHold ? [closestExistingHold] : [];
      const existingTransaction = findExistingTransaction(sourceTransaction, id, currentTransactions);
      const preservedTransaction = hasLocalTransactionEdits(existingTransaction)
        ? existingTransaction
        : matchingExistingHolds.find(hasLocalTransactionEdits) || existingTransaction;
      matchingExistingHolds.forEach(transaction => {
        if (transaction.id === existingTransaction?.id) return;
        holdUpdates.set(transaction.id, {
          ...transaction,
          pending: true,
          excludedFromReporting: true,
          supersededByExternalId: sourceTransaction.id,
          sourceUpdatedAt: syncedAt,
          needsCategoryReview: false,
        });
      });
      const eventSeconds = sourceTransaction.transacted_at || sourceTransaction.posted || Math.floor(syncedAt / 1000);
      const supersededByExternalId = incomingHoldMatches.get(sourceTransaction.id);
      const excludedFromReporting = incomingPending
        ? Boolean(supersededByExternalId || existingTransaction?.excludedFromReporting)
        : false;
      const learnedCategory = existingTransaction
        ? null
        : learnedCategoryForTransaction(sourceTransaction.description, currentTransactions);
      const needsCategoryReview = excludedFromReporting
        ? false
        : preservedTransaction
          ? preservedTransaction.categoryReviewStatus
            ? preservedTransaction.categoryReviewStatus === 'unrecognized'
            : preservedTransaction.needsCategoryReview === true
          : !learnedCategory && eventSeconds * 1000 > reviewSince;
      const localId = existingTransaction?.id || `simplefin-tx:${sourceAccount.conn_id}:${sourceAccount.id}:${sourceTransaction.id}`;
      if (!existingTransaction && needsCategoryReview) newReviewTransactionIds.add(localId);
      transactions.push({
        ...preservedTransaction,
        id: localId,
        type: inferTransactionType(sourceTransaction),
        amount: Math.abs(numericAmount),
        currency: sourceAccount.currency || preservedTransaction?.currency || 'USD',
        accountId: id,
        categoryId: preservedTransaction?.categoryId || learnedCategory?.categoryId || 'cat_uncategorized',
        note: preservedTransaction?.note || sourceTransaction.description,
        timestamp: eventSeconds * 1000,
        dateStr: dateKeyFromSeconds(eventSeconds),
        source: 'simplefin',
        externalId: sourceTransaction.id,
        externalAccountId: sourceAccount.id,
        sourceDescription: sourceTransaction.description,
        sourceCategory: sourceCategory(sourceTransaction),
        pending: incomingPending,
        excludedFromReporting,
        supersededByExternalId: incomingPending
          ? supersededByExternalId || existingTransaction?.supersededByExternalId
          : undefined,
        importedAt: existingTransaction?.importedAt || syncedAt,
        sourceUpdatedAt: syncedAt,
        needsCategoryReview,
        categoryReviewStatus: preservedTransaction?.categoryReviewStatus
          || (learnedCategory ? 'auto' : needsCategoryReview ? 'unrecognized' : undefined),
        categoryReviewedAt: preservedTransaction?.categoryReviewedAt
          || (learnedCategory ? syncedAt : undefined),
        autoCategoryConfidence: preservedTransaction?.autoCategoryConfidence
          ?? learnedCategory?.confidence,
      });
    }
  });

  const reconciledTransactions = new Map(transactions.map(transaction => [transaction.id, transaction]));
  holdUpdates.forEach((update, id) => {
    const refreshed = reconciledTransactions.get(id);
    reconciledTransactions.set(id, {
      ...update,
      ...refreshed,
      pending: true,
      excludedFromReporting: true,
      supersededByExternalId: update.supersededByExternalId,
      needsCategoryReview: false,
    });
  });
  // Include local history: an old authorization can outlive the fetch window.
  // Return only refreshed rows and repair updates; storage remains an upsert.
  const history = new Map(currentTransactions.map(transaction => [transaction.id, transaction]));
  reconciledTransactions.forEach((transaction, id) => history.set(id, transaction));
  for (const update of reconcileInstacartHolds([...history.values()], syncedAt)) {
    reconciledTransactions.set(update.id, update);
  }
  const resultTransactions = [...reconciledTransactions.values()];
  const newTransactionCount = resultTransactions.filter(transaction =>
    newReviewTransactionIds.has(transaction.id) && transaction.needsCategoryReview,
  ).length;
  return { accounts, transactions: resultTransactions, newTransactionCount };
}

export async function getSimpleFinSyncState(): Promise<SimpleFinSyncState> {
  return (await FinanceDB.getSetting<SimpleFinSyncState>(SIMPLEFIN_SYNC_STATE_KEY)) || {};
}

export async function syncSimpleFin(): Promise<SimpleFinSyncResult> {
  if (!hasSimpleFinConnection()) throw new Error('尚未连接 SimpleFIN');
  const attemptedAt = Date.now();
  const previousState = await getSimpleFinSyncState();
  await FinanceDB.saveSetting(SIMPLEFIN_SYNC_STATE_KEY, { ...previousState, lastAttemptAt: attemptedAt, lastError: undefined });

  try {
    const overlapStart = previousState.lastSuccessAt
      ? Math.floor((previousState.lastSuccessAt - 14 * 24 * 60 * 60 * 1000) / 1000)
      : Math.floor((attemptedAt - 89 * 24 * 60 * 60 * 1000) / 1000);
    const snapshot = await fetchSimpleFinAccounts({
      startDate: overlapStart,
      endDate: Math.floor(attemptedAt / 1000) + 24 * 60 * 60,
      pending: true,
    });
    const [currentAccounts, currentTransactions] = await Promise.all([
      FinanceDB.getAccounts(),
      FinanceDB.getTransactions(),
    ]);
    const reviewSince = previousState.lastSuccessAt ?? attemptedAt - 24 * 60 * 60 * 1000;
    const normalized = normalizeSimpleFinSnapshot(snapshot, currentAccounts, currentTransactions, attemptedAt, reviewSince);
    await Promise.all([
      FinanceDB.saveAccounts(normalized.accounts),
      FinanceDB.saveTransactions(normalized.transactions),
    ]);

    const errors = snapshot.errlist.map(error => error.msg).filter(Boolean);
    const result: SimpleFinSyncResult = {
      accountCount: normalized.accounts.length,
      transactionCount: normalized.transactions.length,
      newTransactionCount: normalized.newTransactionCount,
      errors,
      syncedAt: attemptedAt,
    };
    await FinanceDB.saveSetting<SimpleFinSyncState>(SIMPLEFIN_SYNC_STATE_KEY, {
      lastAttemptAt: attemptedAt,
      lastSuccessAt: attemptedAt,
      accountCount: result.accountCount,
      transactionCount: result.transactionCount,
      errors,
    });
    announceFinanceReviewChanged({ newTransactionCount: result.newTransactionCount });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await FinanceDB.saveSetting<SimpleFinSyncState>(SIMPLEFIN_SYNC_STATE_KEY, {
      ...previousState,
      lastAttemptAt: attemptedAt,
      lastError: message,
    });
    throw error;
  }
}

export async function syncSimpleFinIfStale(maxAgeMs = SIMPLEFIN_STALE_MS): Promise<SimpleFinSyncResult | null> {
  if (!hasSimpleFinConnection()) return null;
  const state = await getSimpleFinSyncState();
  if (state.lastSuccessAt && Date.now() - state.lastSuccessAt < maxAgeMs) return null;
  return syncSimpleFin();
}
