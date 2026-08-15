import { beforeEach, describe, expect, it } from 'vitest';
import type { FinanceTransaction, Message } from '../types';
import { FinanceDB } from './financeDb';
import { buildFinanceChatSystemBlock, getFinanceAwareness, shouldEnableFinanceTools } from './financeChatTools';

function userMessage(content: string): Message {
  return { id: 1, charId: 'char-1', role: 'user', type: 'text', content, timestamp: Date.now() };
}

describe('finance chat awareness', () => {
  beforeEach(async () => {
    await FinanceDB.importAll({ accounts: [], categories: [], transactions: [], settings: [], recurringRules: [], taComments: [] });
  });

  it('activates direct finance questions but not ordinary conversation', () => {
    expect(shouldEnableFinanceTools([userMessage('我今天在 Target 花了多少？')])).toBe(true);
    expect(shouldEnableFinanceTools([userMessage('今天下雨了，好困')])).toBe(false);
  });

  it('presents new ledger activity once per character', async () => {
    const transaction: FinanceTransaction = {
      id: 'tx-new',
      type: 'expense',
      amount: 32.5,
      currency: 'USD',
      accountId: 'account-1',
      categoryId: 'cat_uncategorized',
      note: 'Target',
      timestamp: Date.now() - 60_000,
      dateStr: '2026-08-15',
      sourceDescription: 'Target',
    };
    await FinanceDB.saveTransaction(transaction);

    const first = await getFinanceAwareness('char-1');
    const second = await getFinanceAwareness('char-1');
    const anotherCharacter = await getFinanceAwareness('char-2');

    expect(first).toMatchObject({ hasLedger: true });
    expect(first.pulse).toContain('用户个人账本新增 1 笔记录');
    expect(first.pulse).toContain('Target -USD 32.50');
    expect(second.pulse).toBeNull();
    expect(anotherCharacter.pulse).toContain('用户个人账本新增 1 笔记录');
  });

  it('lets the character browse the user ledger without waiting for a finance topic', () => {
    const block = buildFinanceChatSystemBlock('用户个人账本新增 1 笔记录。');
    expect(block).toContain('用户的个人账本');
    expect(block).toContain('可以出于好奇');
    expect(block).toContain('不必等用户先提到钱');
  });
});
