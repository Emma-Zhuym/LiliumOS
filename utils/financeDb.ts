/**
 * financeDb.ts — LiliumOS 记账系统的 IndexedDB 操作
 *
 * 独立数据库，不动上游 AetherOS_Data。
 * 三个 store：accounts / categories / transactions
 */

import { FinanceAccount, FinanceCategory, FinanceTransaction, FinanceTxType, RecurringRule } from '../types';

// Physical name stays for existing installations; migrate it only with a dedicated IndexedDB copy step.
const LEGACY_DB_NAME = 'SullyEM_Finance';
const DB_VERSION = 4;

const STORE_ACCOUNTS = 'accounts';
const STORE_CATEGORIES = 'categories';
const STORE_TX = 'transactions';
const STORE_TA_COMMENTS = 'ta_comments';
const STORE_SETTINGS = 'settings';
const STORE_RECURRING = 'recurring_rules';

// ── 默认预设分类 ──

const DEFAULT_CATEGORIES: FinanceCategory[] = [
  { id: 'cat_uncategorized', name: '未分类', icon: '📥' },
  { id: 'cat_food', name: '餐饮', icon: '🍜' },
  { id: 'cat_food_takeout', name: '外卖', icon: '🥡', parentId: 'cat_food' },
  { id: 'cat_food_dine', name: '堂食', icon: '🍽️', parentId: 'cat_food' },
  { id: 'cat_food_coffee', name: '咖啡', icon: '☕', parentId: 'cat_food' },
  { id: 'cat_food_snack', name: '超市零食', icon: '🛒', parentId: 'cat_food' },

  { id: 'cat_transport', name: '交通', icon: '🚗' },
  { id: 'cat_transport_metro', name: '地铁/公交', icon: '🚇', parentId: 'cat_transport' },
  { id: 'cat_transport_taxi', name: '打车', icon: '🚕', parentId: 'cat_transport' },
  { id: 'cat_transport_gas', name: '加油', icon: '⛽', parentId: 'cat_transport' },
  { id: 'cat_transport_flight', name: '机票', icon: '✈️', parentId: 'cat_transport' },

  { id: 'cat_shopping', name: '购物', icon: '🛍️' },
  { id: 'cat_shopping_clothes', name: '服饰', icon: '👗', parentId: 'cat_shopping' },
  { id: 'cat_shopping_electronics', name: '电子', icon: '📱', parentId: 'cat_shopping' },
  { id: 'cat_shopping_daily', name: '日用品', icon: '🧴', parentId: 'cat_shopping' },

  { id: 'cat_fun', name: '娱乐', icon: '🎮' },
  { id: 'cat_fun_sub', name: '订阅/会员', icon: '📺', parentId: 'cat_fun' },
  { id: 'cat_fun_game', name: '游戏', icon: '🕹️', parentId: 'cat_fun' },
  { id: 'cat_fun_movie', name: '电影', icon: '🎬', parentId: 'cat_fun' },

  { id: 'cat_medical', name: '医疗', icon: '🏥' },
  { id: 'cat_study', name: '学习', icon: '📚' },

  { id: 'cat_transfer', name: '转账', icon: '🔄' },
  { id: 'cat_transfer_credit_payment', name: '信用卡还款', icon: '💳', parentId: 'cat_transfer' },

  { id: 'cat_income', name: '收入', icon: '💰' },
  { id: 'cat_income_salary', name: '工资', icon: '💵', parentId: 'cat_income' },
  { id: 'cat_income_scholarship', name: '奖学金', icon: '🎓', parentId: 'cat_income' },
  { id: 'cat_income_transfer', name: '转账收入', icon: '🔄', parentId: 'cat_income' },
  { id: 'cat_income_refund', name: '退款', icon: '↩️', parentId: 'cat_income' },
];

// ── 打开数据库 ──

function openFinanceDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_ACCOUNTS)) {
        db.createObjectStore(STORE_ACCOUNTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
        db.createObjectStore(STORE_CATEGORIES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TX)) {
        const txStore = db.createObjectStore(STORE_TX, { keyPath: 'id' });
        txStore.createIndex('accountId', 'accountId', { unique: false });
        txStore.createIndex('dateStr', 'dateStr', { unique: false });
        txStore.createIndex('categoryId', 'categoryId', { unique: false });
      }
      // v2: TA读评论持久化
      if (!db.objectStoreNames.contains(STORE_TA_COMMENTS)) {
        db.createObjectStore(STORE_TA_COMMENTS, { keyPath: 'id' });
      }
      // v3: 设置
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      // v4: 周期性交易规则
      if (!db.objectStoreNames.contains(STORE_RECURRING)) {
        db.createObjectStore(STORE_RECURRING, { keyPath: 'id' });
      }
    };
  });
}

// ── 通用 helpers ──

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openFinanceDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function put<T>(storeName: string, data: T): Promise<void> {
  const db = await openFinanceDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(data);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function del(storeName: string, id: string): Promise<void> {
  const db = await openFinanceDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getById<T>(storeName: string, id: string): Promise<T | null> {
  const db = await openFinanceDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ── 分类初始化 ──

async function ensureDefaultCategories(): Promise<void> {
  const existing = await getAll<FinanceCategory>(STORE_CATEGORIES);
  const existingIds = new Set(existing.map(category => category.id));
  const missing = DEFAULT_CATEGORIES.filter(category => !existingIds.has(category.id));
  if (missing.length === 0) return;
  const db = await openFinanceDB();
  const tx = db.transaction(STORE_CATEGORIES, 'readwrite');
  const store = tx.objectStore(STORE_CATEGORIES);
  for (const cat of missing) {
    store.put(cat);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── 公开 API ──

export const FinanceDB = {
  init: ensureDefaultCategories,

  // 账户
  getAccounts: () => getAll<FinanceAccount>(STORE_ACCOUNTS),
  getAccount: (id: string) => getById<FinanceAccount>(STORE_ACCOUNTS, id),
  saveAccount: (a: FinanceAccount) => put(STORE_ACCOUNTS, a),
  saveAccounts: async (accounts: FinanceAccount[]) => {
    if (accounts.length === 0) return;
    const db = await openFinanceDB();
    const tx = db.transaction(STORE_ACCOUNTS, 'readwrite');
    for (const account of accounts) tx.objectStore(STORE_ACCOUNTS).put(account);
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  deleteAccount: (id: string) => del(STORE_ACCOUNTS, id),

  // 分类
  getCategories: () => getAll<FinanceCategory>(STORE_CATEGORIES),
  saveCategory: (c: FinanceCategory) => put(STORE_CATEGORIES, c),
  deleteCategory: (id: string) => del(STORE_CATEGORIES, id),

  // 交易
  getTransactions: () => getAll<FinanceTransaction>(STORE_TX),
  getTransaction: (id: string) => getById<FinanceTransaction>(STORE_TX, id),
  saveTransaction: (t: FinanceTransaction) => put(STORE_TX, t),
  saveTransactions: async (transactions: FinanceTransaction[]) => {
    if (transactions.length === 0) return;
    const db = await openFinanceDB();
    const tx = db.transaction(STORE_TX, 'readwrite');
    for (const transaction of transactions) tx.objectStore(STORE_TX).put(transaction);
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  deleteTransaction: (id: string) => del(STORE_TX, id),

  getTransactionsByAccount: async (accountId: string): Promise<FinanceTransaction[]> => {
    const db = await openFinanceDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TX, 'readonly');
      const index = tx.objectStore(STORE_TX).index('accountId');
      const req = index.getAll(accountId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  getTransactionsByDateRange: async (from: string, to: string): Promise<FinanceTransaction[]> => {
    const db = await openFinanceDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TX, 'readonly');
      const index = tx.objectStore(STORE_TX).index('dateStr');
      const range = IDBKeyRange.bound(from, to);
      const req = index.getAll(range);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  // 设置
  getSetting: async <T = unknown>(key: string): Promise<T | null> => {
    const row = await getById<{ key: string; value: T }>(STORE_SETTINGS, key);
    return row?.value ?? null;
  },
  saveSetting: <T = unknown>(key: string, value: T) => put(STORE_SETTINGS, { key, value }),

  // TA读评论
  getTAComment: (id: string) => getById<{ id: string; text: string; createdAt: number }>(STORE_TA_COMMENTS, id),
  saveTAComment: (comment: { id: string; text: string; createdAt: number }) => put(STORE_TA_COMMENTS, comment),
  getAllTAComments: () => getAll<{ id: string; text: string; createdAt: number }>(STORE_TA_COMMENTS),

  // 备份导出：一次性读出全部 store
  exportAll: async () => {
    const [accounts, categories, transactions, taComments, settings, recurringRules] = await Promise.all([
      getAll<FinanceAccount>(STORE_ACCOUNTS),
      getAll<FinanceCategory>(STORE_CATEGORIES),
      getAll<FinanceTransaction>(STORE_TX),
      getAll<{ id: string; text: string; createdAt: number }>(STORE_TA_COMMENTS),
      getAll<{ key: string; value: unknown }>(STORE_SETTINGS),
      getAll<RecurringRule>(STORE_RECURRING),
    ]);
    return { accounts, categories, transactions, taComments, settings, recurringRules };
  },

  // 备份导入：清空后写入全部数据
  importAll: async (data: {
    accounts?: FinanceAccount[];
    categories?: FinanceCategory[];
    transactions?: FinanceTransaction[];
    taComments?: { id: string; text: string; createdAt: number }[];
    settings?: { key: string; value: unknown }[];
    recurringRules?: RecurringRule[];
  }) => {
    const db = await openFinanceDB();
    const requestedStores = [
      data.accounts !== undefined ? STORE_ACCOUNTS : null,
      data.categories !== undefined ? STORE_CATEGORIES : null,
      data.transactions !== undefined ? STORE_TX : null,
      data.taComments !== undefined ? STORE_TA_COMMENTS : null,
      data.settings !== undefined ? STORE_SETTINGS : null,
      data.recurringRules !== undefined ? STORE_RECURRING : null,
    ];
    const storeNames = requestedStores
      .filter((s): s is string => s !== null && db.objectStoreNames.contains(s));
    if (storeNames.length === 0) return;
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) tx.objectStore(name).clear();
    if (data.accounts) for (const a of data.accounts) tx.objectStore(STORE_ACCOUNTS).put(a);
    if (data.categories) for (const c of data.categories) tx.objectStore(STORE_CATEGORIES).put(c);
    if (data.transactions) for (const t of data.transactions) tx.objectStore(STORE_TX).put(t);
    if (data.taComments) for (const c of data.taComments) tx.objectStore(STORE_TA_COMMENTS).put(c);
    if (data.settings) for (const s of data.settings) tx.objectStore(STORE_SETTINGS).put(s);
    if (data.recurringRules) for (const r of data.recurringRules) tx.objectStore(STORE_RECURRING).put(r);
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // 余额计算
  calcAccountBalance: async (account: FinanceAccount): Promise<number> => {
    if (account.source === 'simplefin' && Number.isFinite(account.syncedBalance)) {
      return account.syncedBalance as number;
    }
    const allTx = await getAll<FinanceTransaction>(STORE_TX);
    let balance = account.initialBalance;
    for (const t of allTx) {
      if (t.accountId === account.id) {
        if (t.type === 'income' || t.type === 'refund') balance += t.amount;
        else if (t.type === 'expense') balance -= t.amount;
        else if (t.type === 'transfer') balance -= t.amount;
      }
      if (t.type === 'transfer' && t.toAccountId === account.id) {
        balance += (t.toAmount ?? t.amount);
      }
    }
    return balance;
  },

  // 周期性交易规则
  getRecurringRules: () => getAll<RecurringRule>(STORE_RECURRING),
  saveRecurringRule: (r: RecurringRule) => put(STORE_RECURRING, r),
  deleteRecurringRule: (id: string) => del(STORE_RECURRING, id),

  /** 检查并自动补录到期的周期性交易，返回补录数量 */
  processRecurringRules: async (): Promise<number> => {
    const rules = await getAll<RecurringRule>(STORE_RECURRING);
    const today = new Date().toISOString().split('T')[0];
    let count = 0;

    for (const rule of rules) {
      if (!rule.enabled) continue;
      let nextDate = rule.nextDate;

      // 补录所有到期日期（可能错过多个周期）
      while (nextDate <= today) {
        const tx: FinanceTransaction = {
          id: `recurring_${rule.id}_${nextDate}`,
          type: rule.type,
          amount: rule.amount,
          currency: rule.currency,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          note: `${rule.note}（自动记录）`,
          timestamp: new Date(nextDate + 'T12:00:00').getTime(),
          dateStr: nextDate,
        };
        // Only insert if not already exists
        const existing = await getById<FinanceTransaction>(STORE_TX, tx.id);
        if (!existing) {
          await put(STORE_TX, tx);
          count++;
        }
        nextDate = advanceDate(nextDate, rule.frequency);
      }

      // Update rule's nextDate
      if (nextDate !== rule.nextDate) {
        await put(STORE_RECURRING, { ...rule, nextDate });
      }
    }
    return count;
  },

  // CSV 导出
  exportCSV: async (): Promise<string> => {
    const [txs, accs, cats] = await Promise.all([
      getAll<FinanceTransaction>(STORE_TX),
      getAll<FinanceAccount>(STORE_ACCOUNTS),
      getAll<FinanceCategory>(STORE_CATEGORIES),
    ]);
    const accMap = Object.fromEntries(accs.map(a => [a.id, a.name]));
    const catMap = Object.fromEntries(cats.map(c => [c.id, c.name]));

    const header = '日期,类型,金额,币种,账户,分类,备注';
    const typeLabels: Record<string, string> = { expense: '支出', income: '收入', refund: '退款', transfer: '转账' };
    const rows = txs
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(t => [
        t.dateStr,
        typeLabels[t.type] || t.type,
        t.amount.toFixed(2),
        t.currency,
        accMap[t.accountId] || '',
        catMap[t.categoryId] || '',
        `"${(t.note || '').replace(/"/g, '""')}"`,
      ].join(','));

    return [header, ...rows].join('\n');
  },
};

function advanceDate(dateStr: string, freq: RecurringRule['frequency']): string {
  const d = new Date(dateStr + 'T12:00:00');
  switch (freq) {
    case 'daily':    d.setDate(d.getDate() + 1); break;
    case 'weekly':   d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly':  d.setMonth(d.getMonth() + 1); break;
    case 'yearly':   d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split('T')[0];
}
