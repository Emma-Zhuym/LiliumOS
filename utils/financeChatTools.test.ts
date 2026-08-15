import { beforeEach, describe, expect, it } from 'vitest';
import type { FinanceTransaction, Message } from '../types';
import { FinanceDB } from './financeDb';
import {
  buildFinanceChatSystemBlock,
  executeFinanceChatTool,
  FINANCE_CHAT_TOOLS,
  getFinanceAwareness,
  shouldEnableFinanceTools,
} from './financeChatTools';
import { CREDIT_CARD_PAYMENT_CATEGORY_ID } from './financeTransfers';

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

  it('treats a categorized credit-card payment as a transfer in awareness and summaries', async () => {
    await FinanceDB.saveCategory({ id: 'cat_transfer', name: '转账', icon: '🔄' });
    await FinanceDB.saveCategory({
      id: CREDIT_CARD_PAYMENT_CATEGORY_ID,
      name: '信用卡还款',
      icon: '💳',
      parentId: 'cat_transfer',
    });
    await FinanceDB.saveTransaction({
      id: 'tx-payment',
      type: 'expense',
      amount: 500,
      currency: 'USD',
      accountId: 'checking',
      categoryId: CREDIT_CARD_PAYMENT_CATEGORY_ID,
      note: 'Credit card payment',
      timestamp: Date.now() - 60_000,
      dateStr: '2026-08-15',
      sourceDescription: 'Credit card payment',
    });

    const awareness = await getFinanceAwareness('char-transfer');
    expect(awareness.pulse).toContain('Credit card payment ↔USD 500.00');
    expect(awareness.pulse).not.toContain('其中支出 USD 500.00');

    const recent = await executeFinanceChatTool('finance_get_recent_transactions') as any;
    expect(recent.transactions[0].type).toBe('transfer');
    const summary = await executeFinanceChatTool('finance_get_spending_summary', {
      start_date: '2026-08-01',
      end_date: '2026-08-31',
    }) as any;
    expect(summary.transaction_count).toBe(0);
    expect(summary.by_currency).toEqual({});
  });

  it('lets the character browse the user ledger without waiting for a finance topic', () => {
    const block = buildFinanceChatSystemBlock('用户个人账本新增 1 笔记录。');
    expect(block).toContain('用户的个人账本');
    expect(block).toContain('可以出于好奇');
    expect(block).toContain('不必等用户先提到钱');
    for (const tool of FINANCE_CHAT_TOOLS) {
      expect(tool.function.description).toMatch(/主动|不必等用户/);
      expect(tool.function.description).not.toMatch(/只在当前聊天|除非用户主动|否则不要调用/);
    }
  });
});
