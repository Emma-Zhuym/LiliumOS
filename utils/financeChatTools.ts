import type { FinanceAccount, FinanceCategory, FinanceTransaction, Message } from '../types';
import { FinanceDB } from './financeDb';
import { getLocalDateKey } from './localDate';
import { getSimpleFinSyncState } from './simplefinSync';
import { reportingTransactionType } from './financeTransfers';

export const FINANCE_CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'finance_get_recent_transactions',
      description: '查看用户最近的真实账户交易。可以在用户聊到消费或生活近况时调用，也可以出于好奇、关心或想找日常话题而主动查看，不必等用户先提到钱。',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 90, description: '向前查看多少天，默认 7 天' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: '最多返回多少笔，默认 10 笔' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finance_search_transactions',
      description: '按商户、备注或分类搜索用户的真实交易。可以回答 Target、Amazon、咖啡等具体消费问题，也可以在你对某笔生活消费感到好奇时主动搜索。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '商户、备注或分类关键词' },
          start_date: { type: 'string', description: '开始日期 YYYY-MM-DD，可选' },
          end_date: { type: 'string', description: '结束日期 YYYY-MM-DD，可选' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: '最多返回多少笔，默认 10 笔' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finance_get_spending_summary',
      description: '汇总一段时间内的真实支出，并按 SullyEM 本地多层分类统计。可以在关心用户近期生活状态或想自然聊聊消费习惯时主动查看。',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: '开始日期 YYYY-MM-DD，默认本月第一天' },
          end_date: { type: 'string', description: '结束日期 YYYY-MM-DD，默认今天' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finance_get_account_snapshot',
      description: '查看用户当前账户余额及数据更新时间。可以在用户主动谈到账户时调用，也可以出于关心或好奇主动查看，不必等用户先提到余额或信用卡。',
      parameters: { type: 'object', properties: {} },
    },
  },
] as const;

export const FINANCE_CHAT_TOOL_NAMES = new Set<string>(FINANCE_CHAT_TOOLS.map(tool => tool.function.name));

const FINANCE_TOPIC_RE = /花钱|花了|花费|花销|消费|支出|收入|账单|账目|记账|余额|信用卡|银行卡|还款|退款|转账|预算|财务|多少钱|买了|购买|商户|transaction|spend|spending|expense|balance|credit card|refund|budget|bought|purchase/i;

function messageText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  try { return JSON.stringify(message.content); } catch { return ''; }
}

export function shouldEnableFinanceTools(messages: Message[]): boolean {
  const lastUser = [...messages].reverse().find(message => message.role === 'user');
  return Boolean(lastUser && FINANCE_TOPIC_RE.test(messageText(lastUser)));
}

interface FinanceAwarenessState {
  lastPresentedAt: number;
  lastTransactionTimestamp: number;
}

export interface FinanceAwareness {
  hasLedger: boolean;
  pulse: string | null;
}

function transactionFingerprint(transaction: FinanceTransaction): string {
  return [
    transaction.accountId,
    transaction.timestamp,
    transaction.amount.toFixed(2),
    transaction.currency,
    transaction.sourceDescription || transaction.note,
  ].join('|');
}

export async function getFinanceAwareness(charId: string): Promise<FinanceAwareness> {
  const [allTransactions, categories] = await Promise.all([
    FinanceDB.getTransactions(),
    FinanceDB.getCategories(),
  ]);
  const categoryMap = new Map(categories.map(category => [category.id, category]));
  const transactions = allTransactions
    .filter(transaction => transaction.timestamp <= Date.now() + 5 * 60 * 1000)
    .sort((a, b) => b.timestamp - a.timestamp);
  if (transactions.length === 0) return { hasLedger: false, pulse: null };

  const stateKey = `financeAwareness:${charId}`;
  const state = await FinanceDB.getSetting<FinanceAwarenessState>(stateKey);
  const newestTimestamp = transactions[0].timestamp;
  const baseline = state?.lastTransactionTimestamp ?? Date.now() - 24 * 60 * 60 * 1000;
  const seenFingerprints = new Set<string>();
  const fresh = transactions.filter(transaction => {
    if (transaction.timestamp <= baseline) return false;
    const fingerprint = transactionFingerprint(transaction);
    if (seenFingerprints.has(fingerprint)) return false;
    seenFingerprints.add(fingerprint);
    return true;
  });

  if (fresh.length === 0) {
    if (!state) {
      await FinanceDB.saveSetting<FinanceAwarenessState>(stateKey, {
        lastPresentedAt: Date.now(),
        lastTransactionTimestamp: newestTimestamp,
      });
    }
    return { hasLedger: true, pulse: null };
  }

  const totals: Record<string, number> = {};
  for (const transaction of fresh) {
    if (reportingTransactionType(transaction, categoryMap) === 'expense') {
      totals[transaction.currency] = (totals[transaction.currency] || 0) + transaction.amount;
    }
  }
  const totalText = Object.entries(totals)
    .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
    .join('、');
  const recentText = fresh.slice(0, 3).map(transaction => {
    const label = transaction.sourceDescription || transaction.note || '未命名交易';
    const type = reportingTransactionType(transaction, categoryMap);
    const sign = type === 'transfer' ? '↔' : type === 'expense' ? '-' : '+';
    return `${label} ${sign}${transaction.currency} ${transaction.amount.toFixed(2)}`;
  }).join('；');

  await FinanceDB.saveSetting<FinanceAwarenessState>(stateKey, {
    lastPresentedAt: Date.now(),
    lastTransactionTimestamp: newestTimestamp,
  });
  return {
    hasLedger: true,
    pulse: `用户个人账本新增 ${fresh.length} 笔记录${totalText ? `，其中支出 ${totalText}` : ''}。最近：${recentText}。`,
  };
}

export function buildFinanceChatSystemBlock(pulse?: string | null): string {
  return [
    '[本轮可使用本地财务查询工具]',
    '这是用户的个人账本，你可以随时查看。',
    '用户聊到消费、账户或生活近况时可以查；你也可以出于好奇、关心近况或想给日常聊天增加意外话题而主动翻看，不必等用户先提到钱。',
    '工具结果来自 SullyEM 本地账本，可能不是实时数据。留意 data_as_of，把查到的内容自然融入对话，不必像报表一样逐笔复述。',
    pulse ? `[用户个人账本近况，仅供生活感知]\n${pulse}\n你可以自然提及、继续查细节或暂时忽略，按你此刻的兴趣决定。` : '',
  ].filter(Boolean).join('\n');
}

function clampLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.floor(parsed))) : fallback;
}

function categoryPath(categoryId: string, categories: Map<string, FinanceCategory>): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current = categories.get(categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? categories.get(current.parentId) : undefined;
  }
  return names.join(' > ') || '未分类';
}

function accountDisplayName(account?: FinanceAccount): string {
  return account?.nickname?.trim() || account?.name || '未知账户';
}

function publicTransaction(
  transaction: FinanceTransaction,
  accounts: Map<string, FinanceAccount>,
  categories: Map<string, FinanceCategory>,
) {
  const type = reportingTransactionType(transaction, categories);
  return {
    date: transaction.dateStr,
    merchant: transaction.sourceDescription || transaction.note || '未命名交易',
    amount: transaction.amount,
    currency: transaction.currency,
    type,
    account: accountDisplayName(accounts.get(transaction.accountId)),
    category: categoryPath(transaction.categoryId, categories),
    pending: Boolean(transaction.pending),
    note: transaction.note && transaction.note !== transaction.sourceDescription ? transaction.note : undefined,
  };
}

async function loadFinanceData() {
  const [accounts, categories, transactions, syncState] = await Promise.all([
    FinanceDB.getAccounts(),
    FinanceDB.getCategories(),
    FinanceDB.getTransactions(),
    getSimpleFinSyncState(),
  ]);
  return {
    accounts,
    categories,
    transactions,
    syncState,
    accountMap: new Map(accounts.map(account => [account.id, account])),
    categoryMap: new Map(categories.map(category => [category.id, category])),
  };
}

export async function executeFinanceChatTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const data = await loadFinanceData();
  const dataAsOf = data.syncState.lastSuccessAt || null;

  if (name === 'finance_get_recent_transactions') {
    const days = Math.max(1, Math.min(90, Math.floor(Number(args.days) || 7)));
    const from = Date.now() - days * 24 * 60 * 60 * 1000;
    const transactions = data.transactions
      .filter(transaction => transaction.timestamp >= from)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, clampLimit(args.limit, 10))
      .map(transaction => publicTransaction(transaction, data.accountMap, data.categoryMap));
    return { data_as_of: dataAsOf, days, count: transactions.length, transactions };
  }

  if (name === 'finance_search_transactions') {
    const query = String(args.query || '').trim().toLocaleLowerCase();
    if (!query) return { data_as_of: dataAsOf, count: 0, transactions: [] };
    const startDate = typeof args.start_date === 'string' ? args.start_date : '';
    const endDate = typeof args.end_date === 'string' ? args.end_date : '';
    const transactions = data.transactions
      .filter(transaction => {
        if (startDate && transaction.dateStr < startDate) return false;
        if (endDate && transaction.dateStr > endDate) return false;
        const haystack = [
          transaction.sourceDescription,
          transaction.note,
          data.accountMap.get(transaction.accountId)?.name,
          categoryPath(transaction.categoryId, data.categoryMap),
        ].filter(Boolean).join(' ').toLocaleLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, clampLimit(args.limit, 10))
      .map(transaction => publicTransaction(transaction, data.accountMap, data.categoryMap));
    return { data_as_of: dataAsOf, query, count: transactions.length, transactions };
  }

  if (name === 'finance_get_spending_summary') {
    const today = getLocalDateKey(new Date());
    const defaultStart = `${today.slice(0, 7)}-01`;
    const startDate = typeof args.start_date === 'string' && args.start_date ? args.start_date : defaultStart;
    const endDate = typeof args.end_date === 'string' && args.end_date ? args.end_date : today;
    const spending = data.transactions.filter(transaction =>
      reportingTransactionType(transaction, data.categoryMap) === 'expense'
      && !transaction.pending
      && transaction.dateStr >= startDate
      && transaction.dateStr <= endDate,
    );
    const byCurrency: Record<string, { total: number; by_category: Record<string, number> }> = {};
    for (const transaction of spending) {
      const bucket = byCurrency[transaction.currency] ||= { total: 0, by_category: {} };
      const category = categoryPath(transaction.categoryId, data.categoryMap);
      bucket.total += transaction.amount;
      bucket.by_category[category] = (bucket.by_category[category] || 0) + transaction.amount;
    }
    return { data_as_of: dataAsOf, start_date: startDate, end_date: endDate, transaction_count: spending.length, by_currency: byCurrency };
  }

  if (name === 'finance_get_account_snapshot') {
    const accounts = await Promise.all(data.accounts
      .filter(account => !account.isArchived)
      .map(async account => ({
        name: accountDisplayName(account),
        provider_name: account.externalName && account.externalName !== accountDisplayName(account)
          ? account.externalName
          : undefined,
        type: account.type,
        currency: account.currency,
        balance: await FinanceDB.calcAccountBalance(account),
        available_balance: account.availableBalance,
        source: account.source || 'manual',
        balance_updated_at: account.balanceUpdatedAt || null,
      })));
    return { data_as_of: dataAsOf, count: accounts.length, accounts };
  }

  throw new Error(`未知财务工具：${name}`);
}
