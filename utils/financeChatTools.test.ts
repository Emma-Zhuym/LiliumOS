import { beforeEach, describe, expect, it } from 'vitest';
import type { FinanceTransaction, Message } from '../types';
import { FinanceDB } from './financeDb';
import {
  buildFinanceChatSystemBlock,
  buildFinanceHeartbeatContext,
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
    expect(shouldEnableFinanceTools([userMessage('帮我查账')])).toBe(true);
    expect(shouldEnableFinanceTools([userMessage('查一下最近的流水')])).toBe(true);
    expect(shouldEnableFinanceTools([userMessage('看看账本')])).toBe(true);
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

  it('does not expose superseded authorization holds to characters or spending summaries', async () => {
    const base: FinanceTransaction = {
      id: 'lyft-posted',
      type: 'expense',
      amount: 7.54,
      currency: 'USD',
      accountId: 'card',
      categoryId: 'cat_uncategorized',
      note: 'LYFT *PRIORITY',
      timestamp: Date.now() - 60_000,
      dateStr: '2026-08-26',
      source: 'simplefin',
      sourceDescription: 'LYFT *PRIORITY',
      pending: false,
    };
    await FinanceDB.saveTransactions([
      base,
      {
        ...base,
        id: 'lyft-hold',
        note: 'LYFT TEMP AUTH HOLD',
        sourceDescription: 'LYFT TEMP AUTH HOLD',
        pending: true,
        excludedFromReporting: true,
        supersededByExternalId: 'lyft-posted-provider-id',
      },
    ]);

    const awareness = await getFinanceAwareness('char-hold');
    expect(awareness.pulse).toContain('新增 1 笔记录');
    expect(awareness.pulse).not.toContain('TEMP AUTH HOLD');

    const recent = await executeFinanceChatTool('finance_get_recent_transactions') as any;
    expect(recent.count).toBe(1);
    expect(recent.transactions[0].merchant).toBe('LYFT *PRIORITY');
  });

  it('lets the character browse the user ledger without waiting for a finance topic', () => {
    const block = buildFinanceChatSystemBlock('用户个人账本新增 1 笔记录。', true);
    expect(block).toContain('用户的个人账本');
    expect(block).toContain('可以出于好奇');
    expect(block).toContain('不必等用户先提到钱');
    expect(block).toContain('先调用一个最合适的财务工具看一眼');
    expect(block).toContain('故事情节、角色自己的钱');
    for (const tool of FINANCE_CHAT_TOOLS) {
      expect(tool.function.description).toMatch(/主动|不必等用户/);
      expect(tool.function.description).not.toMatch(/只在当前聊天|除非用户主动|否则不要调用/);
    }
  });

  it('builds a bounded read-only ledger glimpse for heartbeat without counting transfers as spending', async () => {
    const now = Date.parse('2026-10-14T20:00:00.000Z');
    await FinanceDB.saveCategory({ id: 'cat_transfer', name: '转账', icon: '🔄' });
    await FinanceDB.saveTransactions([
      {
        id: 'coffee', type: 'expense', amount: 6.5, currency: 'USD', accountId: 'card',
        categoryId: 'cat_uncategorized', note: 'Coffee Shop', sourceDescription: 'Coffee Shop',
        timestamp: now - 60_000, dateStr: '2026-10-14', pending: true,
      },
      {
        id: 'move-money', type: 'expense', amount: 100, currency: 'USD', accountId: 'card',
        categoryId: 'cat_transfer', note: 'Transfer', sourceDescription: 'Transfer',
        timestamp: now - 120_000, dateStr: '2026-10-14',
      },
      {
        id: 'old', type: 'expense', amount: 999, currency: 'USD', accountId: 'card',
        categoryId: 'cat_uncategorized', note: 'Old', sourceDescription: 'Old',
        timestamp: now - 8 * 24 * 60 * 60 * 1000, dateStr: '2026-10-06',
      },
    ]);

    const context = await buildFinanceHeartbeatContext(now);
    expect(context?.windowDays).toBe(7);
    expect(context?.recent).toHaveLength(2);
    expect(context?.recent[0]).toMatchObject({ merchant: 'Coffee Shop', pending: true, type: 'expense' });
    expect(context?.recent[1]).toMatchObject({ merchant: 'Transfer', type: 'transfer' });
    expect(context?.totals).toEqual([{ currency: 'USD', amount: 6.5 }]);
  });
});
