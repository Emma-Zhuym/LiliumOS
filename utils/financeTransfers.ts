import type { FinanceAccount, FinanceCategory, FinanceTransaction, FinanceTxType } from '../types';

export const TRANSFER_CATEGORY_ID = 'cat_transfer';
export const CREDIT_CARD_PAYMENT_CATEGORY_ID = 'cat_transfer_credit_payment';

export function isTransferCategory(
  categoryId: string,
  categories: ReadonlyMap<string, FinanceCategory>,
): boolean {
  const seen = new Set<string>();
  let currentId: string | undefined = categoryId;
  while (currentId && !seen.has(currentId)) {
    if (currentId === TRANSFER_CATEGORY_ID) return true;
    seen.add(currentId);
    currentId = categories.get(currentId)?.parentId;
  }
  return false;
}

export function reportingTransactionType(
  transaction: FinanceTransaction,
  categories: ReadonlyMap<string, FinanceCategory>,
): FinanceTxType {
  if (transaction.type === 'transfer' || isTransferCategory(transaction.categoryId, categories)) {
    return 'transfer';
  }
  return transaction.type;
}

export function findCreditCardPaymentCounterpart(
  transaction: FinanceTransaction,
  transactions: FinanceTransaction[],
  accounts: ReadonlyMap<string, FinanceAccount>,
): FinanceTransaction | undefined {
  const sourceAccount = accounts.get(transaction.accountId);
  if (!sourceAccount) return undefined;
  const sourceIsDebit = transaction.type === 'expense';
  const sourceIsCredit = transaction.type === 'income' || transaction.type === 'refund';
  if (!sourceIsDebit && !sourceIsCredit) return undefined;

  const maxGapMs = 3 * 24 * 60 * 60 * 1000;
  const candidates = transactions
    .filter(candidate => {
      if (candidate.id === transaction.id || candidate.accountId === transaction.accountId) return false;
      if (candidate.currency !== transaction.currency) return false;
      if (Math.abs(candidate.amount - transaction.amount) >= 0.005) return false;
      if (Math.abs(candidate.timestamp - transaction.timestamp) > maxGapMs) return false;
      const candidateIsDebit = candidate.type === 'expense';
      const candidateIsCredit = candidate.type === 'income' || candidate.type === 'refund';
      if (!((sourceIsDebit && candidateIsCredit) || (sourceIsCredit && candidateIsDebit))) return false;
      const candidateAccount = accounts.get(candidate.accountId);
      if (!candidateAccount) return false;
      return (sourceAccount.type === 'credit') !== (candidateAccount.type === 'credit');
    })
    .sort((a, b) => Math.abs(a.timestamp - transaction.timestamp) - Math.abs(b.timestamp - transaction.timestamp));

  if (candidates.length === 0) return undefined;
  if (
    candidates.length > 1
    && Math.abs(candidates[0].timestamp - transaction.timestamp) === Math.abs(candidates[1].timestamp - transaction.timestamp)
  ) return undefined;
  return candidates[0];
}
