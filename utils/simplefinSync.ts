import type { FinanceAccount, FinanceTransaction } from '../types';
import { HUE } from './clayTokens';
import { FinanceDB } from './financeDb';
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
  const incomingAt = (incoming.transacted_at || incoming.posted || 0) * 1000;
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
  const pendingMatches = incoming.pending ? [] : existing.filter(transaction =>
    transaction.source === 'simplefin'
    && transaction.accountId === accountId
    && transaction.pending === true
    && Math.abs(transaction.amount - incomingAmount) < 0.005
    && normalizeDescription(transaction.sourceDescription || transaction.note) === incomingDescription
    && Math.abs(transaction.timestamp - incomingAt) <= 7 * 24 * 60 * 60 * 1000,
  );
  const candidates = [...fingerprintMatches, ...pendingMatches];
  const locallyEdited = candidates.find(transaction =>
    transaction.categoryId !== 'cat_uncategorized'
    || Boolean(transaction.note && transaction.note !== transaction.sourceDescription),
  );
  return locallyEdited
    || direct
    || candidates.find(transaction => transaction.pending === true)
    || candidates[0];
}

export function normalizeSimpleFinSnapshot(
  snapshot: SimpleFinAccountSet,
  currentAccounts: FinanceAccount[],
  currentTransactions: FinanceTransaction[],
  syncedAt: number,
): { accounts: FinanceAccount[]; transactions: FinanceTransaction[] } {
  const existingAccounts = new Map(currentAccounts.map(account => [account.id, account]));
  const accounts: FinanceAccount[] = [];
  const transactions: FinanceTransaction[] = [];

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

    for (const sourceTransaction of sourceAccount.transactions || []) {
      const numericAmount = Number(sourceTransaction.amount);
      if (!Number.isFinite(numericAmount)) continue;
      const existingTransaction = findExistingTransaction(sourceTransaction, id, currentTransactions);
      const eventSeconds = sourceTransaction.transacted_at || sourceTransaction.posted || Math.floor(syncedAt / 1000);
      transactions.push({
        ...existingTransaction,
        id: existingTransaction?.id || `simplefin-tx:${sourceAccount.conn_id}:${sourceAccount.id}:${sourceTransaction.id}`,
        type: inferTransactionType(sourceTransaction),
        amount: Math.abs(numericAmount),
        currency: sourceAccount.currency || existingTransaction?.currency || 'USD',
        accountId: id,
        categoryId: existingTransaction?.categoryId || 'cat_uncategorized',
        note: existingTransaction?.note || sourceTransaction.description,
        timestamp: eventSeconds * 1000,
        dateStr: dateKeyFromSeconds(eventSeconds),
        source: 'simplefin',
        externalId: sourceTransaction.id,
        externalAccountId: sourceAccount.id,
        sourceDescription: sourceTransaction.description,
        sourceCategory: sourceCategory(sourceTransaction),
        pending: Boolean(sourceTransaction.pending || sourceTransaction.posted === 0),
        importedAt: existingTransaction?.importedAt || syncedAt,
        sourceUpdatedAt: syncedAt,
      });
    }
  });

  return { accounts, transactions };
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
      ? Math.floor((previousState.lastSuccessAt - 5 * 24 * 60 * 60 * 1000) / 1000)
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
    const normalized = normalizeSimpleFinSnapshot(snapshot, currentAccounts, currentTransactions, attemptedAt);
    await Promise.all([
      FinanceDB.saveAccounts(normalized.accounts),
      FinanceDB.saveTransactions(normalized.transactions),
    ]);

    const errors = snapshot.errlist.map(error => error.msg).filter(Boolean);
    const result: SimpleFinSyncResult = {
      accountCount: normalized.accounts.length,
      transactionCount: normalized.transactions.length,
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
