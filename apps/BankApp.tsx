/**
 * BankApp.tsx — EM 记账重设计
 *
 * 三栏 Tab：资产 / 交易 / 分析+TA读
 * iOS 原生风格 + 柔化处理
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Wallet, Receipt, ChartPie, CaretLeft, CaretRight, CaretDown, Plus, Trash, Gear, CreditCard, PiggyBank, Money, Coffee, ChartLine, ArrowsClockwise, type Icon } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { FinanceDB } from '../utils/financeDb';
import { DB } from '../utils/db';
import { safeFetchJson, extractContent } from '../utils/safeApi';
import { normalizeUserImpression } from '../utils/impression';
import { MemoryNodeDB, bm25Search } from '../utils/memoryPalace';
import type { MemoryNode } from '../utils/memoryPalace/types';
import { FinanceAccount, FinanceCategory, FinanceTransaction, FinanceTxType, CharacterProfile, RecurringRule, RecurringFrequency } from '../types';
import { F, S, R, HUE, STATUS, MOTION } from '../utils/clayTokens';
import { syncSimpleFinIfStale } from '../utils/simplefinSync';
import { SimpleFinSettingsCard } from '../components/finance/SimpleFinSettingsCard';

type TabId = 'assets' | 'transactions' | 'analytics';

const TABS: { id: TabId; label: string; icon: Icon }[] = [
  { id: 'assets', label: '资产', icon: Wallet },
  { id: 'transactions', label: '交易', icon: Receipt },
  { id: 'analytics', label: '分析', icon: ChartPie },
];

const ACCOUNT_COLORS = [
  HUE.blue.main, HUE.red.main, HUE.green.main, HUE.amber.main, HUE.purple.main,
  HUE.rose.main, HUE.cyan.main, HUE.orange.main, HUE.indigo.main, HUE.teal.main,
];

const ACCOUNT_TYPE_LABELS: Record<FinanceAccount['type'], string> = {
  checking: '活期账户', savings: '定期/储蓄', credit: '信用账户', cash: '现金', investment: '投资账户',
};

const ALL_CURRENCIES = ['CNY', 'USD', 'JPY', 'EUR', 'GBP', 'KRW', 'HKD', 'TWD', 'CAD', 'AUD', 'SGD', 'CHF'];
const CURRENCY_LABELS: Record<string, string> = {
  CNY: '人民币 ¥', USD: '美元 $', JPY: '日元 ¥', EUR: '欧元 €', GBP: '英镑 £', KRW: '韩元 ₩',
  HKD: '港币 HK$', TWD: '新台币 NT$', CAD: '加元 C$', AUD: '澳元 A$', SGD: '新加坡元 S$', CHF: '瑞士法郎 CHF',
};
const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥', USD: '$', JPY: '¥', EUR: '€', GBP: '£', KRW: '₩',
  HKD: 'HK$', TWD: 'NT$', CAD: 'C$', AUD: 'A$', SGD: 'S$', CHF: 'CHF',
};

// ── BankApp 产品色（从 design system palette 取） ──
const BANK_HUE = {
  asset:   HUE.mint,
  expense: HUE.rose,
  income:  HUE.blue,
  chart:   HUE.purple,
};

const FREQ_LABELS: Record<RecurringFrequency, string> = {
  daily: '每天', weekly: '每周', biweekly: '每两周', monthly: '每月', yearly: '每年',
};

interface FinanceSettings {
  enabledCurrencies: string[];
  defaultCurrency: string;
}

const BankApp: React.FC = () => {
  const { closeApp } = useOS();
  const [activeTab, setActiveTab] = useState<TabId>('assets');
  const [showSettings, setShowSettings] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showTxFilters, setShowTxFilters] = useState(false);
  const [analyticsFilter, setAnalyticsFilter] = useState<'all' | 'expense' | 'income'>('expense');
  const [showAnalyticsMenu, setShowAnalyticsMenu] = useState(false);
  const [finSettings, setFinSettings] = useState<FinanceSettings>({
    enabledCurrencies: ['CNY'],
    defaultCurrency: 'CNY',
  });

  const refreshData = useCallback(async () => {
    const [accs, cats, txs] = await Promise.all([
      FinanceDB.getAccounts(),
      FinanceDB.getCategories(),
      FinanceDB.getTransactions(),
    ]);
    setAccounts(accs);
    setCategories(cats);
    setTransactions(txs);
    const bals: Record<string, number> = {};
    for (const a of accs) {
      bals[a.id] = await FinanceDB.calcAccountBalance(a);
    }
    setBalances(bals);
  }, []);

  useEffect(() => {
    (async () => {
      await FinanceDB.init();
      const saved = await FinanceDB.getSetting<FinanceSettings>('financeSettings');
      if (saved) setFinSettings(saved);
      await FinanceDB.processRecurringRules();
      await refreshData();
      setLoading(false);
      void syncSimpleFinIfStale()
        .then(result => result ? refreshData() : undefined)
        .catch(error => console.warn('[Finance] SimpleFIN 自动同步失败:', error));
    })();
  }, [refreshData]);

  const updateSettings = useCallback(async (patch: Partial<FinanceSettings>) => {
    const next = { ...finSettings, ...patch };
    // 确保 defaultCurrency 在 enabledCurrencies 里
    if (patch.enabledCurrencies && !patch.enabledCurrencies.includes(next.defaultCurrency)) {
      next.defaultCurrency = patch.enabledCurrencies[0] || 'CNY';
    }
    setFinSettings(next);
    await FinanceDB.saveSetting('financeSettings', next);
  }, [finSettings]);

  // 按币种分组计算总资产（不混币种相加）
  const balanceByCurrency: Record<string, number> = {};
  for (const a of accounts.filter(a => !a.isArchived)) {
    const cur = a.currency || 'CNY';
    balanceByCurrency[cur] = (balanceByCurrency[cur] || 0) + (balances[a.id] ?? a.initialBalance);
  }
  const currencyEntries = Object.entries(balanceByCurrency).sort((a, b) => b[1] - a[1]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: F.appBg }}>
        <div className="text-sm" style={{ color: F.textTertiary }}>加载中...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: F.appBg }}>
      {/* 顶部导航栏 */}
      <div className="shrink-0 relative flex items-center px-5 py-3" style={{ paddingTop: 'var(--chrome-top)' }}>
        <button
          onClick={closeApp}
          className="flex items-center justify-center active:translate-y-[2px] transition-transform z-10"
          style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, color: F.textSecondary }}
        >
          <CaretLeft className="w-5 h-5" weight="bold" />
        </button>
        <span className="absolute left-0 right-0 flex justify-center text-sm font-semibold pointer-events-none" style={{ color: F.textPrimary }}>
          {activeTab === 'assets' ? '资产' : activeTab === 'transactions' ? (
            <button
              onClick={() => setShowTxFilters(f => !f)}
              className="pointer-events-auto active:opacity-60 transition-opacity inline-flex items-center gap-1"
            >
              交易 <CaretDown size={12} weight="bold" style={{ color: F.textTertiary }} />
            </button>
          ) : (
            <span className="pointer-events-auto relative">
              <button
                onClick={() => setShowAnalyticsMenu(v => !v)}
                className="active:opacity-60 transition-opacity inline-flex items-center gap-1"
              >
                {analyticsFilter === 'expense' ? '支出' : analyticsFilter === 'income' ? '收入' : '收支'} <CaretDown size={12} weight="bold" style={{ color: F.textTertiary }} />
              </button>
              {showAnalyticsMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowAnalyticsMenu(false)} />
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-30 flex flex-col min-w-[100px] p-2 gap-1" style={{ background: F.surfaceRaised, borderRadius: R.bigCard, boxShadow: S.floating, border: `1px solid ${F.borderSoft}` }}>
                    {([['expense', '支出'], ['income', '收入'], ['all', '收支']] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => { setAnalyticsFilter(val); setShowAnalyticsMenu(false); }}
                        className="px-4 py-2 text-sm font-medium active:scale-95 transition-all"
                        style={{
                          borderRadius: R.medium,
                          background: analyticsFilter === val ? HUE.indigo.main : 'transparent',
                          color: analyticsFilter === val ? F.surfaceRaised : F.textSecondary,
                          boxShadow: analyticsFilter === val ? S.raisedSoft : 'none',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2 z-10">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center active:translate-y-[2px] transition-transform"
            style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, color: F.textSecondary }}
          >
            <Gear size={16} weight="bold" style={{ color: F.textTertiary }} />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'assets' && (
          <AssetsTab
            accounts={accounts}
            balances={balances}
            currencyEntries={currencyEntries}
            transactions={transactions}
            onRefresh={refreshData}
            addingAccount={addingAccount}
            onAddingDone={() => setAddingAccount(false)}
            finSettings={finSettings}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionsTab
            transactions={transactions}
            accounts={accounts}
            categories={categories}
            onRefresh={refreshData}
            showFilters={showTxFilters}
            setShowFilters={setShowTxFilters}
          />
        )}
        {activeTab === 'analytics' && (
          <AnalyticsTab
            transactions={transactions}
            categories={categories}
            accounts={accounts}
            filterType={analyticsFilter}
            setFilterType={setAnalyticsFilter}
          />
        )}
      </div>

      {/* 设置页 */}
      {showSettings && (
        <SettingsPage
          settings={finSettings}
          onUpdate={updateSettings}
          onClose={() => setShowSettings(false)}
          categories={categories}
          onRefresh={refreshData}
        />
      )}

      {/* 底部 Tab Bar — floating pill */}
      <div
        className="shrink-0 flex items-center justify-around mx-5 p-1.5"
        style={{ background: F.surfaceRaised, borderRadius: R.panel, boxShadow: S.raisedMedium, marginBottom: 'calc(0.5rem + var(--safe-bottom))' /* [EM: safe-bottom] */ }}
      >
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex flex-col items-center gap-0.5 flex-1 py-2 transition-all"
              style={{
                borderRadius: R.medium,
                color: isActive ? HUE.blue.main : F.textTertiary,
                background: isActive ? F.surfaceRaised : 'transparent',
                boxShadow: isActive ? S.raisedSoft : 'none',
                fontWeight: isActive ? 600 : 400,
                transition: `all ${MOTION.hover} ${MOTION.ease}`,
              }}
            >
              <Icon className="w-5 h-5" weight={isActive ? 'fill' : 'regular'} />
              <span className="text-[10px]" style={{ color: isActive ? F.textPrimary : F.textTertiary }}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── 格式化金额 ──

function formatAmount(amount: number, currency?: string, defaultCur?: string) {
  const sym = CURRENCY_SYMBOLS[currency || defaultCur || 'CNY'] || '¥';
  const sign = amount < 0 ? '-' : '';
  return `${sign}${sym}${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function totalsByCurrency(transactions: FinanceTransaction[]): [string, number][] {
  const totals: Record<string, number> = {};
  for (const transaction of transactions) {
    totals[transaction.currency] = (totals[transaction.currency] || 0) + transaction.amount;
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

// ── 账户表单（添加/编辑） ──

const AccountForm: React.FC<{
  initial?: FinanceAccount;
  onSave: (acc: FinanceAccount) => void;
  onDelete?: () => void;
  onClose: () => void;
  enabledCurrencies?: string[];
  defaultCurrency?: string;
}> = ({ initial, onSave, onDelete, onClose, enabledCurrencies, defaultCurrency }) => {
  const isEdit = !!initial;
  const isSynced = initial?.source === 'simplefin';
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState<FinanceAccount['type']>(initial?.type || 'checking');
  const [currency, setCurrency] = useState(initial?.currency || defaultCurrency || 'CNY');
  const currencyOptions = enabledCurrencies && enabledCurrencies.length > 0 ? enabledCurrencies : ['CNY'];
  const [initialBalance, setInitialBalance] = useState(
    initial ? String(initial.initialBalance) : ''
  );
  const [color, setColor] = useState(initial?.color || ACCOUNT_COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = () => {
    if (isSynced || !name.trim()) return;
    onSave({
      ...initial,
      id: initial?.id || `acc_${Date.now()}`,
      name: name.trim(),
      type,
      currency,
      initialBalance: parseFloat(initialBalance) || 0,
      color,
      icon: icon || undefined,
      isArchived: initial?.isArchived,
      sortOrder: initial?.sortOrder,
    });
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: F.appBg }}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3" style={{ paddingTop: 'var(--chrome-top)' }}>
        <button onClick={onClose}
          className="flex items-center justify-center active:translate-y-[1px] transition-transform"
          style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised,
                   border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
          <CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} />
        </button>
        <span className="text-sm font-semibold" style={{ color: F.textPrimary }}>
          {isSynced ? '账户详情' : isEdit ? '编辑账户' : '新建账户'}
        </span>
        {isSynced ? <div className="w-12" /> : (
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="text-sm font-semibold"
            style={{ color: !name.trim() ? F.textTertiary : F.accent }}
          >
            保存
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {/* 名称 */}
        <div className="overflow-hidden mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <FormRow label="名称">
            <input
              value={name}
              disabled={isSynced}
              onChange={e => setName(e.target.value)}
              placeholder="如：招商储蓄卡"
              className="w-full text-right text-sm outline-none bg-transparent placeholder:opacity-40" style={{ color: F.textPrimary }}
            />
          </FormRow>
          <FormRow label="类型" border>
            <select
              value={type}
              disabled={isSynced}
              onChange={e => setType(e.target.value as FinanceAccount['type'])}
              className="w-full text-right text-sm outline-none bg-transparent appearance-none" style={{ color: F.textPrimary }}
            >
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="币种" border>
            <select
              value={currency}
              disabled={isSynced}
              onChange={e => setCurrency(e.target.value)}
              className="w-full text-right text-sm outline-none bg-transparent appearance-none" style={{ color: F.textPrimary }}
            >
              {currencyOptions.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="初始余额" border>
            {isSynced ? (
              <span className="inline-flex items-center justify-end gap-1.5 text-sm" style={{ color: F.textSecondary }}>
                <ArrowsClockwise size={14} weight="bold" />
                {formatAmount(initial?.syncedBalance || 0, currency)}
              </span>
            ) : (
              <input
                value={initialBalance}
                onChange={e => setInitialBalance(e.target.value)}
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                className="w-full text-right text-sm outline-none bg-transparent placeholder:opacity-40" style={{ color: F.textPrimary }}
              />
            )}
          </FormRow>
          <FormRow label="图标（emoji）" border>
            <input
              value={icon}
              disabled={isSynced}
              onChange={e => setIcon(e.target.value)}
              placeholder="💳"
              className="w-full text-right text-sm outline-none bg-transparent placeholder:opacity-40" style={{ color: F.textPrimary }}
              maxLength={4}
            />
          </FormRow>
        </div>

        {/* 颜色选择 */}
        <div className="p-4 mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div className="text-xs mb-3" style={{ color: F.textTertiary }}>卡片颜色</div>
          <div className="flex flex-wrap gap-3">
            {ACCOUNT_COLORS.map(c => (
              <button
                key={c}
                disabled={isSynced}
                onClick={() => setColor(c)}
                className="w-8 h-8 rounded-full transition-transform disabled:opacity-60"
                style={{
                  backgroundColor: c,
                  boxShadow: color === c ? `0 0 0 3px ${HUE.purple.tint}, 0 0 0 5px ${c}` : 'none',
                  transform: color === c ? 'scale(1.1)' : 'scale(1)',
                }}
              />
            ))}
          </div>
        </div>

        {/* 预览 */}
        <div className="p-4 mb-6" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div className="text-xs mb-2" style={{ color: F.textTertiary }}>预览</div>
          <div className="flex items-center">
            <div
              className="w-10 h-10 flex items-center justify-center text-base font-bold shrink-0 mr-3"
              style={{ borderRadius: R.small, color: F.surfaceRaised, backgroundColor: color }}
            >
              {icon || (name ? name.slice(0, 2) : '💳')}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium" style={{ color: F.textPrimary }}>{name || '账户名称'}</div>
              <div className="text-[11px]" style={{ color: F.textTertiary }}>{ACCOUNT_TYPE_LABELS[type]} · {currency}</div>
            </div>
            <div className="text-sm font-semibold" style={{ color: F.textPrimary }}>
              {formatAmount(isSynced ? (initial?.syncedBalance || 0) : (parseFloat(initialBalance) || 0), currency)}
            </div>
          </div>
        </div>

        {/* 删除 */}
        {isEdit && onDelete && (
          <div className="overflow-hidden" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full py-3.5 text-sm font-medium flex items-center justify-center gap-1.5"
                style={{ color: STATUS.danger.main }}
              >
                <Trash className="w-4 h-4" /> 删除账户
              </button>
            ) : (
              <div className="p-4 text-center">
                <div className="text-sm mb-3" style={{ color: F.textSecondary }}>确定删除「{name}」？相关交易不会被删除。</div>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setConfirmDelete(false)} className="px-4 py-2 text-sm" style={{ color: F.textSecondary, background: F.surfaceSunken, borderRadius: R.medium }}>取消</button>
                  <button onClick={onDelete} className="px-4 py-2 text-sm" style={{ color: F.surfaceRaised, background: STATUS.danger.main, borderRadius: R.medium }}>删除</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const FormRow: React.FC<{
  label: string;
  border?: boolean;
  children: React.ReactNode;
}> = ({ label, border, children }) => (
  <div className={`flex items-center px-4 py-3.5`} style={border ? { borderTop: `1px solid ${F.borderSoft}` } : undefined}>
    <span className="text-sm shrink-0 mr-4" style={{ color: F.textPrimary }}>{label}</span>
    <div className="flex-1 min-w-0 text-right">{children}</div>
  </div>
);

// ── 设置页 ──

const SettingsPage: React.FC<{
  settings: FinanceSettings;
  onUpdate: (patch: Partial<FinanceSettings>) => Promise<void>;
  onClose: () => void;
  categories: FinanceCategory[];
  onRefresh: () => Promise<void>;
}> = ({ settings, onUpdate, onClose, categories, onRefresh }) => {
  const [editingCat, setEditingCat] = useState<FinanceCategory | 'new-top' | { parentId: string } | null>(null);
  const [expandedTopCat, setExpandedTopCat] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const topCats = categories.filter(c => !c.parentId);
  const childrenOf = (parentId: string) => categories.filter(c => c.parentId === parentId);

  const toggleCurrency = (cur: string) => {
    const current = settings.enabledCurrencies;
    if (current.includes(cur)) {
      if (current.length <= 1) return;
      const next = current.filter(c => c !== cur);
      onUpdate({ enabledCurrencies: next });
    } else {
      onUpdate({ enabledCurrencies: [...current, cur] });
    }
  };

  const handleSaveCat = async (cat: FinanceCategory) => {
    await FinanceDB.saveCategory(cat);
    await onRefresh();
    setEditingCat(null);
  };

  const handleDeleteCat = async (id: string) => {
    // 删除一级分类时，同时删子分类
    const children = childrenOf(id);
    for (const child of children) {
      await FinanceDB.deleteCategory(child.id);
    }
    await FinanceDB.deleteCategory(id);
    await onRefresh();
    setConfirmDeleteId(null);
  };

  // 编辑/新建分类的内联表单
  if (editingCat) {
    const isNew = editingCat === 'new-top' || 'parentId' in editingCat;
    const initial = (!isNew && editingCat) as FinanceCategory | undefined;
    const parentId = editingCat === 'new-top' ? undefined : ('parentId' in editingCat ? editingCat.parentId : (initial?.parentId || undefined));

    return (
      <CategoryEditForm
        initial={initial}
        parentId={parentId}
        onSave={handleSaveCat}
        onClose={() => setEditingCat(null)}
      />
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: F.appBg }}>
      <div className="shrink-0 flex items-center justify-between px-4 py-3" style={{ paddingTop: 'var(--chrome-top)' }}>
        <button onClick={onClose}
          className="flex items-center justify-center active:translate-y-[1px] transition-transform"
          style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised,
                   border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
          <CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} />
        </button>
        <span className="text-sm font-semibold" style={{ color: F.textPrimary }}>设置</span>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <SimpleFinSettingsCard onSynced={onRefresh} />

        {/* ── 分类管理 ── */}
        <div className="overflow-hidden mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div>
              <div className="text-sm font-medium mb-0.5" style={{ color: F.textPrimary }}>分类管理</div>
              <div className="text-[11px]" style={{ color: F.textTertiary }}>点击编辑，展开查看子分类</div>
            </div>
            <button
              onClick={() => setEditingCat('new-top')}
              className="text-xs font-medium px-3 py-1.5 rounded-full active:scale-95 transition-transform" style={{ color: F.accent, background: HUE.blue.tint }}
            >
              + 一级分类
            </button>
          </div>

          <div className="px-2 pb-3">
            {topCats.map(cat => {
              const children = childrenOf(cat.id);
              const isExpanded = expandedTopCat === cat.id;
              const isConfirmingDelete = confirmDeleteId === cat.id;

              return (
                <div key={cat.id}>
                  {/* 一级分类行 */}
                  <div className="flex items-center px-2 py-2.5 group" style={{ borderRadius: R.medium }}>
                    <button
                      onClick={() => setExpandedTopCat(isExpanded ? null : cat.id)}
                      className="w-7 h-7 flex items-center justify-center shrink-0" style={{ color: F.textTertiary }}
                    >
                      <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    </button>
                    <span className="text-lg mr-2">{cat.icon || '📋'}</span>
                    <span className="text-sm flex-1" style={{ color: F.textPrimary }}>{cat.name}</span>
                    <span className="text-[10px] mr-2" style={{ color: F.textTertiary }}>{children.length} 子项</span>
                    <button
                      onClick={() => setEditingCat(cat)}
                      className="text-[11px] px-2 py-1 rounded-lg" style={{ color: F.accent }}
                    >
                      编辑
                    </button>
                    {isConfirmingDelete ? (
                      <div className="flex gap-1 ml-1">
                        <button onClick={() => handleDeleteCat(cat.id)} className="text-[10px] px-2 py-1 rounded-lg" style={{ color: F.surfaceRaised, background: STATUS.danger.main }}>确认</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] px-2 py-1 rounded-lg" style={{ color: F.textTertiary }}>取消</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(cat.id)}
                        className="text-[11px] px-1 py-1 rounded-lg ml-1" style={{ color: HUE.red.soft }}
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* 二级分类列表 */}
                  {isExpanded && (
                    <div className="ml-9 mb-2 space-y-0.5">
                      {children.map(child => {
                        const isChildConfirm = confirmDeleteId === child.id;
                        return (
                          <div key={child.id} className="flex items-center px-2 py-2 rounded-lg">
                            <span className="text-base mr-2">{child.icon || '📋'}</span>
                            <span className="text-sm flex-1" style={{ color: F.textSecondary }}>{child.name}</span>
                            <button
                              onClick={() => setEditingCat(child)}
                              className="text-[11px] px-2 py-1 rounded-lg" style={{ color: F.accent }}
                            >
                              编辑
                            </button>
                            {isChildConfirm ? (
                              <div className="flex gap-1 ml-1">
                                <button onClick={() => handleDeleteCat(child.id)} className="text-[10px] px-2 py-1 rounded-lg" style={{ color: F.surfaceRaised, background: STATUS.danger.main }}>确认</button>
                                <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] px-2 py-1 rounded-lg" style={{ color: F.textTertiary }}>取消</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(child.id)}
                                className="text-[11px] px-1 py-1 rounded-lg ml-1" style={{ color: HUE.red.soft }}
                              >
                                <Trash className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <button
                        onClick={() => setEditingCat({ parentId: cat.id })}
                        className="flex items-center gap-1.5 px-2 py-2 text-[11px] font-medium rounded-lg w-full" style={{ color: F.accent }}
                      >
                        <Plus className="w-3.5 h-3.5" /> 添加子分类
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 常用币种 ── */}
        <div className="overflow-hidden mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div className="px-4 pt-4 pb-2">
            <div className="text-sm font-medium mb-1" style={{ color: F.textPrimary }}>常用币种</div>
            <div className="text-[11px]" style={{ color: F.textTertiary }}>选择你需要用到的币种，新建账户时只显示这些</div>
          </div>
          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-2 mt-2">
              {ALL_CURRENCIES.map(cur => {
                const isEnabled = settings.enabledCurrencies.includes(cur);
                return (
                  <button
                    key={cur}
                    onClick={() => toggleCurrency(cur)}
                    className="flex items-center gap-2 px-3 py-2.5 text-left transition-colors"
                    style={{
                      borderRadius: R.medium,
                      background: isEnabled ? HUE.blue.tint : F.surfaceSunken,
                      ...(isEnabled ? { outline: `1px solid ${HUE.blue.soft}` } : {}),
                    }}
                  >
                    <div className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold"
                      style={{
                        background: isEnabled ? HUE.blue.main : F.borderStrong,
                        color: isEnabled ? F.surfaceRaised : F.textTertiary,
                      }}>
                      {isEnabled ? '✓' : ''}
                    </div>
                    <div>
                      <div className="text-sm font-medium" style={{ color: isEnabled ? F.textPrimary : F.textTertiary }}>{cur}</div>
                      <div className="text-[10px]" style={{ color: F.textTertiary }}>{CURRENCY_LABELS[cur]?.split(' ').slice(0, -1).join(' ') || cur}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── 默认显示币种 ── */}
        <div className="overflow-hidden mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div className="px-4 pt-4 pb-2">
            <div className="text-sm font-medium mb-1" style={{ color: F.textPrimary }}>默认显示币种</div>
            <div className="text-[11px]" style={{ color: F.textTertiary }}>新建账户和金额显示的默认币种</div>
          </div>
          <div className="px-4 pb-4 mt-2">
            <SunkenSelector className="flex-wrap">
              {settings.enabledCurrencies.map(cur => (
                <FilterChip
                  key={cur}
                  label={`${CURRENCY_SYMBOLS[cur] || cur} ${cur}`}
                  active={settings.defaultCurrency === cur}
                  onClick={() => onUpdate({ defaultCurrency: cur })}
                />
              ))}
            </SunkenSelector>
          </div>
        </div>

        {/* ── 周期性交易 ── */}
        <RecurringRulesSection categories={categories} onRefresh={onRefresh} />

        {/* ── 导出 CSV ── */}
        <div className="overflow-hidden mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <button
            onClick={async () => {
              const csv = await FinanceDB.exportCSV();
              const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `记账导出_${new Date().toISOString().split('T')[0]}.csv`;
              a.click(); URL.revokeObjectURL(url);
            }}
            className="w-full px-4 py-4 flex items-center justify-between active:translate-y-[2px] transition-transform"
          >
            <div>
              <div className="text-sm font-medium" style={{ color: F.textPrimary }}>导出 CSV</div>
              <div className="text-[11px]" style={{ color: F.textTertiary }}>下载全部交易记录为 CSV 文件</div>
            </div>
            <Receipt size={18} weight="bold" style={{ color: F.textSecondary }} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ── 分类编辑表单 ──

const EMOJI_SUGGESTIONS = [
  '🍜','🍽️','☕','🛒','🚗','🚇','🚕','✈️','🛍️','👗','📱','🧴',
  '🎮','📺','🕹️','🎬','🏥','📚','💰','💵','🎓','🏠','💡','📦',
  '🐱','🎂','💊','🏋️','🎁','💇','🧹','📮','🔧','🎵','📷','🌿',
];

const CategoryEditForm: React.FC<{
  initial?: FinanceCategory;
  parentId?: string;
  onSave: (cat: FinanceCategory) => void;
  onClose: () => void;
}> = ({ initial, parentId, onSave, onClose }) => {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || '');
  const [icon, setIcon] = useState(initial?.icon || '');

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      id: initial?.id || `cat_${Date.now()}`,
      name: name.trim(),
      icon: icon || undefined,
      parentId: initial?.parentId || parentId,
    });
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: F.appBg }}>
      <div className="shrink-0 flex items-center justify-between px-4 py-3" style={{ paddingTop: 'var(--chrome-top)' }}>
        <button onClick={onClose}
          className="flex items-center justify-center active:translate-y-[1px] transition-transform"
          style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised,
                   border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
          <CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} />
        </button>
        <span className="text-sm font-semibold" style={{ color: F.textPrimary }}>
          {isEdit ? '编辑分类' : (parentId ? '新建子分类' : '新建一级分类')}
        </span>
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className="text-sm font-semibold"
          style={{ color: !name.trim() ? F.textTertiary : F.accent }}
        >
          保存
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <div className="overflow-hidden mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <FormRow label="名称">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="如：宠物"
              className="w-full text-right text-sm outline-none bg-transparent placeholder:opacity-40" style={{ color: F.textPrimary }}
              autoFocus
            />
          </FormRow>
          <FormRow label="图标" border>
            <input
              value={icon}
              onChange={e => setIcon(e.target.value)}
              placeholder="选一个 emoji"
              className="w-full text-right text-sm outline-none bg-transparent placeholder:opacity-40" style={{ color: F.textPrimary }}
              maxLength={4}
            />
          </FormRow>
        </div>

        {/* 预览 */}
        <div className="p-4 mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div className="text-xs mb-2" style={{ color: F.textTertiary }}>预览</div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{icon || '📋'}</span>
            <span className="text-sm font-medium" style={{ color: F.textPrimary }}>{name || '分类名称'}</span>
          </div>
        </div>

        {/* 快速选 emoji */}
        <div className="p-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div className="text-xs mb-3" style={{ color: F.textTertiary }}>常用图标</div>
          <div className="grid grid-cols-6 gap-2">
            {EMOJI_SUGGESTIONS.map(e => (
              <button
                key={e}
                onClick={() => setIcon(e)}
                className="w-10 h-10 flex items-center justify-center text-xl transition-colors"
                style={{
                  borderRadius: R.medium,
                  background: icon === e ? HUE.blue.tint : F.surfaceSunken,
                  ...(icon === e ? { outline: `1px solid ${HUE.blue.soft}` } : {}),
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── 周期性交易管理 ──

const RecurringRulesSection: React.FC<{
  categories: FinanceCategory[];
  onRefresh: () => Promise<void>;
}> = ({ categories, onRefresh }) => {
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);

  useEffect(() => {
    (async () => {
      const [r, a] = await Promise.all([FinanceDB.getRecurringRules(), FinanceDB.getAccounts()]);
      setRules(r);
      setAccounts(a);
    })();
  }, []);

  const reload = async () => {
    setRules(await FinanceDB.getRecurringRules());
  };

  const handleSave = async (rule: RecurringRule) => {
    await FinanceDB.saveRecurringRule(rule);
    await reload();
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    await FinanceDB.deleteRecurringRule(id);
    await reload();
  };

  const toggleEnabled = async (rule: RecurringRule) => {
    await FinanceDB.saveRecurringRule({ ...rule, enabled: !rule.enabled });
    await reload();
  };

  if (editing) {
    const isNew = editing === 'new';
    return (
      <RecurringRuleForm
        initial={isNew ? undefined : editing}
        accounts={accounts.filter(account => account.source !== 'simplefin')}
        categories={categories}
        onSave={handleSave}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="overflow-hidden mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <div className="text-sm font-medium mb-0.5" style={{ color: F.textPrimary }}>周期性交易</div>
          <div className="text-[11px]" style={{ color: F.textTertiary }}>自动记录房租、订阅等固定支出</div>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="text-xs font-medium px-3 py-1.5 rounded-full active:translate-y-[2px] transition-transform"
          style={{ background: BANK_HUE.income.main, boxShadow: S.raisedSoft, color: F.surfaceRaised }}
        >
          + 添加
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="mx-3 mb-3 flex flex-col items-center justify-center" style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: 24 }}>
          <Receipt className="w-[18px] h-[18px] mb-2" weight="bold" style={{ color: F.textTertiary }} />
          <span style={{ color: F.textTertiary, fontSize: 14 }}>暂无规则</span>
        </div>
      ) : (
        <div className="px-3 pb-3 space-y-2">
          {rules.map(rule => {
            const cat = categories.find(c => c.id === rule.categoryId);
            const acc = accounts.find(a => a.id === rule.accountId);
            return (
              <div key={rule.id} className="flex items-center px-3 py-2.5" style={{ borderRadius: R.medium, background: F.surfaceSunken }}>
                <button onClick={() => toggleEnabled(rule)} className="mr-2.5 shrink-0">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold"
                    style={{
                      background: rule.enabled ? STATUS.success.main : F.borderStrong,
                      color: rule.enabled ? F.surfaceRaised : F.textTertiary,
                    }}>
                    {rule.enabled ? '✓' : ''}
                  </div>
                </button>
                <div className="flex-1 min-w-0" onClick={() => setEditing(rule)}>
                  <div className="text-sm truncate" style={{ color: F.textPrimary }}>
                    {cat?.icon || '📋'} {rule.note || cat?.name || '未命名'}
                  </div>
                  <div className="text-[10px]" style={{ color: F.textTertiary }}>
                    {FREQ_LABELS[rule.frequency]} · {formatAmount(rule.amount, rule.currency)} · {acc?.name || ''}
                  </div>
                </div>
                <div className="text-[10px] mx-2" style={{ color: F.textTertiary }}>下次: {rule.nextDate.slice(5)}</div>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="p-1" style={{ color: HUE.red.soft }}
                >
                  <Trash className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const RecurringRuleForm: React.FC<{
  initial?: RecurringRule;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onSave: (rule: RecurringRule) => void;
  onClose: () => void;
}> = ({ initial, accounts, categories, onSave, onClose }) => {
  const [txType, setTxType] = useState<FinanceTxType>(initial?.type || 'expense');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [accountId, setAccountId] = useState(initial?.accountId || accounts[0]?.id || '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId || '');
  const [note, setNote] = useState(initial?.note || '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(initial?.frequency || 'monthly');
  const [nextDate, setNextDate] = useState(initial?.nextDate || new Date().toISOString().split('T')[0]);

  const selectedAcc = accounts.find(a => a.id === accountId);
  const relevantCats = categories.filter(c => {
    if (c.parentId) return false;
    if (txType === 'income') return c.id === 'cat_income';
    return c.id !== 'cat_income';
  });

  const handleSave = () => {
    const parsed = parseFloat(amount);
    if (!parsed || !accountId) return;
    onSave({
      id: initial?.id || `recurring_${Date.now()}`,
      type: txType,
      amount: parsed,
      currency: selectedAcc?.currency || 'CNY',
      accountId,
      categoryId: categoryId || 'cat_food',
      note: note.trim(),
      frequency,
      nextDate,
      enabled: initial?.enabled ?? true,
      createdAt: initial?.createdAt || Date.now(),
    });
  };

  return (
    <div className="overflow-hidden mb-4 p-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose}
          className="flex items-center justify-center active:translate-y-[1px] transition-transform"
          style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised,
                   border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
          <CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} />
        </button>
        <span className="text-sm font-semibold" style={{ color: F.textPrimary }}>{initial ? '编辑规则' : '新建规则'}</span>
        <button onClick={handleSave} disabled={!parseFloat(amount)} className="text-xs font-semibold" style={{ color: !parseFloat(amount) ? F.textTertiary : F.accent }}>保存</button>
      </div>

      {/* 类型 */}
      <div className="flex mb-3 p-1" style={{ background: F.surfaceSunken, borderRadius: R.large, boxShadow: S.sunken }}>
        {(['expense', 'income'] as const).map(t => {
          const isActive = txType === t;
          return (
            <button
              key={t}
              onClick={() => setTxType(t)}
              className="flex-1 py-2 text-xs font-medium transition-all"
              style={{
                borderRadius: R.medium,
                background: isActive ? F.surfaceRaised : 'transparent',
                color: isActive ? F.textPrimary : F.textTertiary,
                boxShadow: isActive ? S.raisedSoft : 'none',
                transition: `all ${MOTION.hover} ${MOTION.ease}`,
              }}
            >
              {t === 'expense' ? '支出' : '收入'}
            </button>
          );
        })}
      </div>

      {/* 金额 + 频率 */}
      <div className="flex gap-2 mb-3">
        <input
          value={amount}
          onChange={e => setAmount(e.target.value)}
          type="number"
          inputMode="decimal"
          placeholder="金额"
          className="flex-1 px-3 py-2.5 text-sm outline-none"
          style={{ borderRadius: R.medium, background: F.surfaceSunken, boxShadow: S.sunken }}
        />
        <select
          value={frequency}
          onChange={e => setFrequency(e.target.value as RecurringFrequency)}
          className="px-3 py-2.5 text-sm outline-none appearance-none"
          style={{ borderRadius: R.medium, background: F.surfaceSunken, boxShadow: S.sunken }}
        >
          {(Object.entries(FREQ_LABELS) as [RecurringFrequency, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* 账户 */}
      <select
        value={accountId}
        onChange={e => setAccountId(e.target.value)}
        className="w-full px-3 py-2.5 text-sm outline-none appearance-none mb-3"
        style={{ borderRadius: R.medium, background: F.surfaceSunken, boxShadow: S.sunken }}
      >
        {accounts.filter(a => !a.isArchived && a.source !== 'simplefin').map(a => (
          <option key={a.id} value={a.id}>{a.icon || ''} {a.name}</option>
        ))}
      </select>

      {/* 分类 */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {relevantCats.map(cat => (
          <button
            key={cat.id}
            onClick={() => setCategoryId(cat.id)}
            className="px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              borderRadius: R.small,
              background: categoryId === cat.id ? HUE.blue.main : F.surfaceSunken,
              color: categoryId === cat.id ? F.surfaceRaised : F.textSecondary,
            }}
          >
            {cat.icon} {cat.name}
          </button>
        ))}
      </div>

      {/* 备注 + 起始日期 */}
      <input
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="备注（如：房租）"
        className="w-full px-3 py-2.5 text-sm outline-none mb-3"
        style={{ borderRadius: R.medium, background: F.surfaceSunken, boxShadow: S.sunken }}
      />
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: F.textSecondary }}>下次记录日期</span>
        <input
          value={nextDate}
          onChange={e => setNextDate(e.target.value)}
          type="date"
          className="flex-1 px-3 py-2 text-sm outline-none"
          style={{ borderRadius: R.medium, background: F.surfaceSunken, boxShadow: S.sunken }}
        />
      </div>
    </div>
  );
};

// ── 交易表单（添加/编辑） ──

const TransactionForm: React.FC<{
  initial?: FinanceTransaction;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onSave: (tx: FinanceTransaction) => void;
  onDelete?: () => void;
  onClose: () => void;
}> = ({ initial, accounts, categories, onSave, onDelete, onClose }) => {
  const isEdit = !!initial;
  const isSynced = initial?.source === 'simplefin';
  const selectableAccounts = isEdit ? accounts : accounts.filter(account => account.source !== 'simplefin');
  const [txType, setTxType] = useState<FinanceTxType>(initial?.type || 'expense');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [accountId, setAccountId] = useState(initial?.accountId || selectableAccounts[0]?.id || '');
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId || '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId || '');
  const [note, setNote] = useState(initial?.note || '');
  const [dateStr, setDateStr] = useState(initial?.dateStr || new Date().toISOString().split('T')[0]);
  const [expandedTopCat, setExpandedTopCat] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const catMap = new Map(categories.map(c => [c.id, c]));
  const selectedCat = catMap.get(categoryId);
  const selectedAcc = accounts.find(a => a.id === accountId);

  const relevantTopCats = categories.filter(c => {
    if (c.parentId) return false;
    if (txType === 'income' || txType === 'refund') return c.id === 'cat_income';
    return c.id !== 'cat_income';
  });

  const handleCatClick = (catId: string) => {
    const children = categories.filter(c => c.parentId === catId);
    // 选中该一级分类
    setCategoryId(catId);
    if (children.length > 0) {
      // 有子分类则展开/收起，但不强制选二级
      setExpandedTopCat(prev => prev === catId ? null : catId);
    } else {
      setExpandedTopCat(null);
    }
  };

  const handleSave = () => {
    const parsed = parseFloat(amount);
    if (!parsed || !accountId) return;
    onSave({
      ...initial,
      id: initial?.id || `tx_${Date.now()}`,
      type: txType,
      amount: parsed,
      currency: selectedAcc?.currency || 'CNY',
      accountId,
      categoryId: categoryId || (txType === 'income' || txType === 'refund' ? 'cat_income' : 'cat_food'),
      note: note.trim(),
      timestamp: initial?.timestamp || Date.now(),
      dateStr,
      toAccountId: txType === 'transfer' ? (toAccountId || undefined) : undefined,
      charComments: initial?.charComments,
    });
  };

  const canSave = parseFloat(amount) > 0 && !!accountId;

  if (selectableAccounts.length === 0) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center" style={{ background: F.appBg }}>
        <div className="text-4xl mb-3">💳</div>
        <div className="text-sm mb-1" style={{ color: F.textSecondary }}>请先在资产页添加手动账户</div>
        <button onClick={onClose} className="mt-4 px-5 py-2 text-sm font-medium" style={{ color: F.accent }}>返回</button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: F.appBg }}>
      <div className="shrink-0 flex items-center justify-between px-4 py-3" style={{ paddingTop: 'var(--chrome-top)' }}>
        <button onClick={onClose}
          className="flex items-center justify-center active:translate-y-[1px] transition-transform"
          style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised,
                   border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
          <CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} />
        </button>
        <span className="text-sm font-semibold" style={{ color: F.textPrimary }}>{isEdit ? '编辑交易' : '新增交易'}</span>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="text-sm font-semibold"
          style={{ color: !canSave ? F.textTertiary : F.accent }}
        >
          保存
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {isSynced && (
          <div className="mb-4 px-3 py-2.5 flex items-center gap-2 text-[11px]" style={{ background: STATUS.info.tint, color: STATUS.info.ink, borderRadius: R.medium }}>
            <ArrowsClockwise size={15} weight="bold" className="shrink-0" />
            金额、账户和日期跟随 SimpleFIN；你可以修改本地分类和备注。
          </div>
        )}
        {/* 类型切换 */}
        <div className="mb-4 flex p-1" style={{ background: F.surfaceSunken, borderRadius: R.large, boxShadow: S.sunken }}>
          {(['expense', 'income', 'transfer'] as const).map(t => {
            const label = { expense: '支出', income: '收入', transfer: '转账' }[t];
            const isActive = txType === t;
            return (
              <button
                key={t}
                disabled={isSynced}
                onClick={() => { setTxType(t); setCategoryId(''); setExpandedTopCat(null); }}
                className="flex-1 py-2 text-sm font-medium transition-all disabled:opacity-60"
                style={{
                  borderRadius: R.medium,
                  background: isActive ? F.surfaceRaised : 'transparent',
                  color: isActive ? F.textPrimary : F.textTertiary,
                  boxShadow: isActive ? S.raisedSoft : 'none',
                  transition: `all ${MOTION.hover} ${MOTION.ease}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* 金额 */}
        <div className="px-5 py-4 mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div className="text-xs mb-2" style={{ color: F.textTertiary }}>金额</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-light" style={{ color: F.textTertiary }}>
              {CURRENCY_SYMBOLS[selectedAcc?.currency || 'CNY'] || '¥'}
            </span>
            <input
              value={amount}
              disabled={isSynced}
              onChange={e => setAmount(e.target.value)}
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              autoFocus={!isSynced}
              className="flex-1 text-4xl font-bold outline-none bg-transparent placeholder:opacity-30 min-w-0 disabled:opacity-70" style={{ color: F.textPrimary }}
            />
          </div>
        </div>

        {/* 分类（转账不需要） */}
        {txType !== 'transfer' && (
          <div className="p-4 mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs" style={{ color: F.textTertiary }}>分类</span>
              {selectedCat && (
                <span className="text-xs font-medium" style={{ color: F.accent }}>
                  {selectedCat.icon} {selectedCat.name}
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {relevantTopCats.map(cat => {
                const isActive = selectedCat?.parentId === cat.id || (categoryId === cat.id && !catMap.get(categoryId)?.parentId);
                const isExpanded = expandedTopCat === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCatClick(cat.id)}
                    className="flex flex-col items-center gap-1 py-2.5 transition-all"
                    style={{
                      borderRadius: R.medium,
                      background: isActive || isExpanded ? HUE.blue.tint : F.surfaceSunken,
                      ...(isActive || isExpanded ? { outline: `1px solid ${HUE.blue.soft}` } : {}),
                    }}
                  >
                    <span className="text-xl">{cat.icon}</span>
                    <span className="text-[9px] leading-tight text-center" style={{ color: F.textSecondary }}>{cat.name}</span>
                  </button>
                );
              })}
            </div>
            {expandedTopCat && (
              <div className="flex flex-wrap gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${F.divider}` }}>
                {categories.filter(c => c.parentId === expandedTopCat).map(child => (
                  <button
                    key={child.id}
                    onClick={() => { setCategoryId(child.id); setExpandedTopCat(null); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors"
                    style={{
                      borderRadius: R.pill,
                      background: categoryId === child.id ? HUE.blue.main : F.surfaceSunken,
                      color: categoryId === child.id ? F.surfaceRaised : F.textSecondary,
                      fontWeight: categoryId === child.id ? 500 : 400,
                    }}
                  >
                    <span>{child.icon}</span>
                    <span>{child.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 账户 / 目标账户 / 日期 / 备注 */}
        <div className="overflow-hidden mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <FormRow label="账户">
            <select
              value={accountId}
              disabled={isSynced}
              onChange={e => setAccountId(e.target.value)}
              className="w-full text-right text-sm outline-none bg-transparent appearance-none disabled:opacity-70" style={{ color: F.textPrimary }}
            >
              {selectableAccounts.filter(a => !a.isArchived).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </FormRow>
          {txType === 'transfer' && (
            <FormRow label="转入账户" border>
              <select
                value={toAccountId}
                onChange={e => setToAccountId(e.target.value)}
                className="w-full text-right text-sm outline-none bg-transparent appearance-none" style={{ color: F.textPrimary }}
              >
                <option value="">请选择</option>
                {selectableAccounts.filter(a => !a.isArchived && a.id !== accountId).map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </FormRow>
          )}
          <FormRow label="日期" border>
            <input
              type="date"
              value={dateStr}
              disabled={isSynced}
              onChange={e => setDateStr(e.target.value)}
              className="w-full text-right text-sm outline-none bg-transparent disabled:opacity-70" style={{ color: F.textPrimary }}
            />
          </FormRow>
          <FormRow label="备注" border>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="可选"
              className="w-full text-right text-sm outline-none bg-transparent placeholder:opacity-40" style={{ color: F.textPrimary }}
            />
          </FormRow>
        </div>

        {/* 删除 */}
        {isEdit && onDelete && (
          <div className="overflow-hidden" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full py-3.5 text-sm font-medium flex items-center justify-center gap-1.5"
                style={{ color: STATUS.danger.main }}
              >
                <Trash className="w-4 h-4" /> 删除交易
              </button>
            ) : (
              <div className="p-4 text-center">
                <div className="text-sm mb-3" style={{ color: F.textSecondary }}>确定删除这条交易记录？</div>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setConfirmDelete(false)} className="px-4 py-2 text-sm" style={{ color: F.textSecondary, background: F.surfaceSunken, borderRadius: R.medium }}>取消</button>
                  <button onClick={onDelete} className="px-4 py-2 text-sm" style={{ color: F.surfaceRaised, background: STATUS.danger.main, borderRadius: R.medium }}>删除</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── 资产趋势图 ──

const TrendChart: React.FC<{
  transactions: FinanceTransaction[];
  accounts: FinanceAccount[];
  balances: Record<string, number>;
}> = ({ transactions, accounts, balances }) => {
  const [trendRange, setTrendRange] = useState<'week' | 'month' | 'year'>('month');

  const currencies = [...new Set(accounts.filter(a => !a.isArchived).map(a => a.currency))];
  const [selectedCurrency, setSelectedCurrency] = useState<string>(() => currencies[0] || 'CNY');

  // 当前该币种总余额（所有账户加总）
  const currentTotal = accounts
    .filter(a => !a.isArchived && a.currency === selectedCurrency)
    .reduce((s, a) => s + (balances[a.id] ?? 0), 0);

  // 建日期列表
  const { from, to } = getDateRange(trendRange);
  const dates: string[] = [];
  const d = new Date(from + 'T12:00:00');
  const endD = new Date(to + 'T12:00:00');
  while (d <= endD) {
    dates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }

  // 每天该币种的净变动（收入 - 支出，转账同币种互抵不计）
  const dailyNet = new Map<string, number>();
  for (const t of transactions.filter(t => t.currency === selectedCurrency)) {
    if (t.type === 'income' || t.type === 'refund') {
      dailyNet.set(t.dateStr, (dailyNet.get(t.dateStr) || 0) + t.amount);
    } else if (t.type === 'expense') {
      dailyNet.set(t.dateStr, (dailyNet.get(t.dateStr) || 0) - t.amount);
    }
  }

  // 从当前余额倒推每天期末余额
  const lastDate = dates[dates.length - 1];
  let bal = currentTotal;
  // 先撤销 chart 范围之后的交易
  for (const [date, net] of dailyNet) {
    if (date > lastDate) bal -= net;
  }
  const balancePoints: number[] = new Array(dates.length);
  for (let i = dates.length - 1; i >= 0; i--) {
    balancePoints[i] = bal;
    bal -= (dailyNet.get(dates[i]) || 0);
  }

  const maxVal = Math.max(...balancePoints, 1);
  const minVal = Math.min(...balancePoints, 0);
  const range = maxVal - minVal || 1;

  const w = 280, h = 100, px = 4, py = 8;
  const chartW = w - px * 2, chartH = h - py * 2;

  const assetPath = (() => {
    if (balancePoints.length < 2) return '';
    const stepX = chartW / Math.max(balancePoints.length - 1, 1);
    return balancePoints.map((v, i) => {
      const x = px + i * stepX;
      const y = py + chartH - ((v - minVal) / range) * chartH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  })();

  const latestBal = balancePoints[balancePoints.length - 1] ?? currentTotal;
  const earliestBal = balancePoints[0] ?? currentTotal;
  const change = latestBal - earliestBal;
  const hasAccounts = accounts.some(a => !a.isArchived && a.currency === selectedCurrency);

  return (
    <div className="p-4 mb-6" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
      <div className="flex items-center justify-between mb-3">
        <SunkenSelector>
          {(['week', 'month', 'year'] as const).map(r => (
            <FilterChip
              key={r}
              label={r === 'week' ? '周' : r === 'month' ? '月' : '年'}
              active={trendRange === r}
              onClick={() => setTrendRange(r)}
            />
          ))}
        </SunkenSelector>
        {currencies.length > 1 && (
          <SunkenSelector>
            {currencies.map(c => (
              <FilterChip key={c} label={c} active={selectedCurrency === c} onClick={() => setSelectedCurrency(c)} />
            ))}
          </SunkenSelector>
        )}
      </div>

      {!hasAccounts ? (
        <div className="flex flex-col items-center justify-center" style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: 24 }}>
          <Wallet className="w-[18px] h-[18px] mb-2" weight="bold" style={{ color: F.textTertiary }} />
          <span style={{ color: F.textTertiary, fontSize: 14 }}>暂无账户</span>
        </div>
      ) : (
        <>
          <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
            {assetPath && (
              <path d={assetPath} fill="none" stroke={HUE.purple.main} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
          <div className="flex justify-between mt-2 text-[11px]" style={{ color: F.textTertiary }}>
            <span>当前 {formatAmount(latestBal)} {selectedCurrency}</span>
            <span style={{ color: change >= 0 ? HUE.green.main : HUE.rose.main }}>
              {change >= 0 ? '▲' : '▼'} {formatAmount(Math.abs(change))}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

// ── 资产 Tab ──

const AssetsTab: React.FC<{
  accounts: FinanceAccount[];
  balances: Record<string, number>;
  currencyEntries: [string, number][];
  transactions: FinanceTransaction[];
  onRefresh: () => Promise<void>;
  addingAccount: boolean;
  onAddingDone: () => void;
  finSettings: FinanceSettings;
}> = ({ accounts, balances, currencyEntries, transactions, onRefresh, addingAccount, onAddingDone, finSettings }) => {
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | 'new' | null>(null);

  useEffect(() => {
    if (addingAccount) setEditingAccount('new');
  }, [addingAccount]);

  const activeAccounts = accounts.filter(a => !a.isArchived);
  const grouped = {
    checking: activeAccounts.filter(a => a.type === 'checking'),
    savings: activeAccounts.filter(a => a.type === 'savings'),
    credit: activeAccounts.filter(a => a.type === 'credit'),
    investment: activeAccounts.filter(a => a.type === 'investment'),
    cash: activeAccounts.filter(a => a.type === 'cash'),
  };

  const closeForm = () => { setEditingAccount(null); onAddingDone(); };

  const handleSaveAccount = async (acc: FinanceAccount) => {
    await FinanceDB.saveAccount(acc);
    await onRefresh();
    closeForm();
  };

  const handleDeleteAccount = async (id: string) => {
    await FinanceDB.deleteAccount(id);
    await onRefresh();
    closeForm();
  };

  if (editingAccount) {
    return (
      <AccountForm
        initial={editingAccount === 'new' ? undefined : editingAccount}
        onSave={handleSaveAccount}
        onDelete={editingAccount !== 'new' && editingAccount.source !== 'simplefin' ? () => handleDeleteAccount(editingAccount.id) : undefined}
        onClose={closeForm}
        enabledCurrencies={finSettings.enabledCurrencies}
        defaultCurrency={finSettings.defaultCurrency}
      />
    );
  }

  return (
    <div className="px-5 pt-2 pb-4">
      {/* 总资产（按币种分列） */}
      <div className="mb-6">
        <div className="text-xs mb-1" style={{ color: F.textSecondary }}>总资产</div>
        {currencyEntries.length <= 1 ? (
          <div className="text-3xl font-bold tracking-tight" style={{ color: F.textPrimary }}>
            {formatAmount(currencyEntries[0]?.[1] ?? 0, currencyEntries[0]?.[0])}
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {currencyEntries.map(([cur, amt]) => (
              <span key={cur} className="text-2xl font-bold tracking-tight" style={{ color: F.textPrimary }}>
                {formatAmount(amt, cur)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 资产趋势图 */}
      <TrendChart transactions={transactions} accounts={accounts} balances={balances} />

      {/* 账户列表 */}
      {activeAccounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center" style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: 24 }}>
          <Wallet className="w-[18px] h-[18px] mb-2" weight="bold" style={{ color: F.textTertiary }} />
          <span style={{ color: F.textTertiary, fontSize: 14, marginBottom: 12 }}>还没有账户</span>
          <button
            onClick={() => setEditingAccount('new')}
            className="px-5 py-2.5 text-sm font-medium active:scale-95 transition-transform"
            style={{ background: HUE.blue.main, borderRadius: R.medium, boxShadow: S.raisedSoft, color: F.surfaceRaised }}
          >
            添加第一个账户
          </button>
        </div>
      ) : (
        Object.entries(grouped).map(([type, accs]) => {
          if (accs.length === 0) return null;
          return (
            <div key={type} className="mb-4">
              <div className="text-xs font-medium mb-2 px-1" style={{ color: F.textTertiary }}>
                {ACCOUNT_TYPE_LABELS[type as FinanceAccount['type']]}
              </div>
              <div className="overflow-hidden" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
                {accs.map((acc, i) => (
                  <button
                    key={acc.id}
                    onClick={() => setEditingAccount(acc)}
                    className="w-full flex items-center px-4 py-3.5 text-left active:translate-y-[2px] transition-transform"
                    style={i < accs.length - 1 ? { borderBottom: `1px solid ${F.divider}` } : undefined}
                  >
                    <div
                      className="flex items-center justify-center text-sm font-bold shrink-0 mr-3"
                      style={{ width: 44, height: 44, borderRadius: R.small, backgroundColor: acc.color || F.textTertiary, boxShadow: S.raisedSoft, border: '2px solid rgba(255,255,255,0.3)', color: F.surfaceRaised }}
                    >
                      {acc.type === 'credit' ? <CreditCard size={20} weight="bold" /> :
                       acc.type === 'savings' ? <PiggyBank size={20} weight="bold" /> :
                       acc.type === 'investment' ? <ChartLine size={20} weight="bold" /> :
                       acc.type === 'cash' ? <Money size={20} weight="bold" /> :
                       <Wallet size={20} weight="bold" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: F.textPrimary }}>{acc.name}</div>
                      {acc.source === 'simplefin' && (
                        <div className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: F.textTertiary }}>
                          <ArrowsClockwise size={10} weight="bold" /> SimpleFIN
                        </div>
                      )}
                    </div>
                    <div className="text-sm font-semibold"
                      style={{ color: (balances[acc.id] ?? 0) < 0 ? HUE.rose.main : F.textPrimary }}>
                      {formatAmount(balances[acc.id] ?? acc.initialBalance, acc.currency)}
                    </div>
                    <div className="ml-2 text-xs" style={{ color: F.textTertiary }}>›</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* FAB 新增账户 */}
      <button
        onClick={() => setEditingAccount('new')}
        className="fixed right-5 bottom-32 flex items-center justify-center active:scale-90 transition-transform z-10"
        style={{ width: 56, height: 56, borderRadius: R.pill, background: HUE.blue.main, boxShadow: S.floating, color: F.surfaceRaised }}
      >
        <Plus className="w-6 h-6" weight="bold" />
      </button>
    </div>
  );
};

// ── 交易 Tab ──

type TimeRange = 'week' | 'month' | 'last_month' | '3months' | 'year' | 'all';

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  week: '本周', month: '本月', last_month: '上月', '3months': '近3月', year: '今年', all: '全部',
};

function getDateRange(range: TimeRange, offset = 0): { from: string; to: string; label: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const fmtShort = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

  if (range === 'week') {
    // 周一到周日，offset=0 为本周, -1 为上周
    const day = now.getDay() || 7; // 把周日变成7
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1 + offset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const to = sunday > now ? now : sunday;
    return { from: fmt(monday), to: fmt(to), label: offset === 0 ? '本周' : `${fmtShort(monday)} - ${fmtShort(sunday)}` };
  } else if (range === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const to = end > now ? now : end;
    const label = offset === 0 ? '本月' : `${d.getFullYear()}年${d.getMonth() + 1}月`;
    return { from: fmt(d), to: fmt(to), label };
  } else if (range === 'year') {
    const y = now.getFullYear() + offset;
    const from = `${y}-01-01`;
    const end = new Date(y, 11, 31);
    const to = end > now ? fmt(now) : fmt(end);
    const label = offset === 0 ? '今年' : `${y}年`;
    return { from, to, label };
  } else if (range === 'last_month') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: fmt(d), to: fmt(end), label: '上月' };
  } else if (range === '3months') {
    const d = new Date(now); d.setMonth(d.getMonth() - 3);
    return { from: fmt(d), to: fmt(now), label: '近三月' };
  }
  return { from: '2000-01-01', to: fmt(now), label: '全部' };
}

const FilterChip: React.FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  tint?: { bg: string; fg: string };
}> = ({ label, active, onClick, tint }) => (
  <button
    onClick={onClick}
    className="px-3 py-1.5 text-xs font-medium shrink-0 flex-1 text-center"
    style={{
      borderRadius: R.medium,
      background: active ? (tint ? tint.bg : F.surfaceRaised) : 'transparent',
      color: active ? (tint ? tint.fg : F.textPrimary) : F.textTertiary,
      boxShadow: active ? S.raisedSoft : 'none',
      fontWeight: active ? 600 : 400,
      transition: `all ${MOTION.hover} ${MOTION.ease}`,
    }}
  >
    {label}
  </button>
);

/** Sunken groove wrapper for groups of FilterChips / selector buttons */
const SunkenSelector: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div
    className={`flex items-center p-1 ${className}`}
    style={{ background: F.surfaceSunken, borderRadius: R.large, boxShadow: S.sunken }}
  >
    {children}
  </div>
);

const TransactionsTab: React.FC<{
  transactions: FinanceTransaction[];
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onRefresh: () => Promise<void>;
  showFilters: boolean;
  setShowFilters: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ transactions, accounts, categories, onRefresh, showFilters, setShowFilters }) => {
  const { characters, apiConfig, userProfile } = useOS();
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [filterAccountIds, setFilterAccountIds] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<'all' | 'expense' | 'income'>('all');
  const [editingTx, setEditingTx] = useState<FinanceTransaction | 'new' | null>(null);

  const toggleAccount = (id: string) => setFilterAccountIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── 今日情报 ──
  const [gossipChar, setGossipChar] = useState<CharacterProfile | null>(null);
  const [gossipText, setGossipText] = useState<string | null>(null);
  const [gossipLoading, setGossipLoading] = useState(false);

  const generateGossip = async () => {
    if (!apiConfig?.baseUrl || characters.length === 0) return;
    setGossipLoading(true);
    try {
      // 读取所有角色今天的日程，随机选一个有日程的
      const today = new Date().toISOString().split('T')[0];
      const schedules = await Promise.all(
        characters.map(async c => ({
          char: c,
          schedule: await DB.getDailySchedule(c.id, today).catch(() => null),
        }))
      );
      const withSchedule = schedules.filter(s => s.schedule && s.schedule.slots.length > 0);
      const pick = withSchedule.length > 0
        ? withSchedule[Math.floor(Math.random() * withSchedule.length)]
        : { char: characters[Math.floor(Math.random() * characters.length)], schedule: null };

      setGossipChar(pick.char);

      const slotsSummary = pick.schedule
        ? pick.schedule.slots.map((s: { startTime: string; activity: string; emoji?: string; location?: string }) =>
          `${s.startTime} ${s.emoji || ''} ${s.activity}${s.location ? `（在${s.location}）` : ''}`
        ).join('\n')
        : '今天没有日程安排';

      const prompt = `你是一个写八卦情报的旁白系统。根据角色「${pick.char.name}」今天的日程，写一条简短的情报/八卦，像咖啡馆里听来的小道消息。\n\n${pick.char.name}的日程：\n${slotsSummary}\n\n要求：\n- 1句话，30字以内\n- 第三人称，像在报道别人的动态\n- 带点八卦感、生活感，不要干巴巴地复述日程\n- 可以从日程里推测角色的状态（比如连续开会→可能很忙，去咖啡店→可能在摸鱼）\n- 示例：「陈照今天买了三杯咖啡，看起来要通宵」「阿萌下午翘了课去逛街」\n- 直接输出情报文字，不加引号`;

      const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
      const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.apiKey || 'sk-none'}`,
        },
        body: JSON.stringify({
          model: apiConfig.model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: '来一条情报' },
          ],
          temperature: 0.95,
          max_tokens: 4000, // 思考型模型(Gemini等)会先吃 max_tokens 思考，给小了正文被截断
          stream: false,
        }),
      });

      const reply = extractContent(data).trim();
      setGossipText(reply || '今天风平浪静');
    } catch {
      setGossipText('情报网暂时断了');
    } finally {
      setGossipLoading(false);
    }
  };

  if (editingTx !== null) {
    return (
      <TransactionForm
        initial={editingTx === 'new' ? undefined : editingTx}
        accounts={accounts}
        categories={categories}
        onSave={async (tx) => {
          await FinanceDB.saveTransaction(tx);
          await onRefresh();
          setEditingTx(null);
        }}
        onDelete={editingTx !== 'new' && editingTx.source !== 'simplefin' ? async () => {
          await FinanceDB.deleteTransaction((editingTx as FinanceTransaction).id);
          await onRefresh();
          setEditingTx(null);
        } : undefined}
        onClose={() => setEditingTx(null)}
      />
    );
  }

  const { from, to } = getDateRange(timeRange);

  const filtered = transactions.filter(t => {
    if (t.dateStr < from || t.dateStr > to) return false;
    if (filterAccountIds.size > 0 && !filterAccountIds.has(t.accountId)) return false;
    if (filterType === 'expense' && t.type !== 'expense') return false;
    if (filterType === 'income' && t.type !== 'income' && t.type !== 'refund') return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
  const totalIncome = totalsByCurrency(filtered.filter(t => t.type === 'income' || t.type === 'refund'));
  const totalExpense = totalsByCurrency(filtered.filter(t => t.type === 'expense'));

  const byDate = new Map<string, FinanceTransaction[]>();
  for (const t of sorted) {
    const group = byDate.get(t.dateStr) || [];
    group.push(t);
    byDate.set(t.dateStr, group);
  }

  const catMap = new Map(categories.map(c => [c.id, c]));
  const accMap = new Map(accounts.map(a => [a.id, a]));

  const formatWeekday = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  };

  const activeFilters = (filterAccountIds.size > 0 ? 1 : 0) + (filterType !== 'all' ? 1 : 0);

  return (
    <div className="px-5 pt-2 pb-4">
      {/* 筛选栏 */}
      <div className="mb-3 overflow-x-auto pb-1 scrollbar-none">
        <SunkenSelector>
          {(['week', 'month', '3months', 'year', 'all'] as TimeRange[]).map(r => (
            <FilterChip key={r} label={TIME_RANGE_LABELS[r]} active={timeRange === r} onClick={() => setTimeRange(r)} />
          ))}
        </SunkenSelector>
      </div>

      {/* 展开筛选面板 */}
      {showFilters && (
        <div className="p-4 mb-4 space-y-3" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div>
            <div className="text-[11px] mb-2" style={{ color: F.textTertiary }}>类型</div>
            <SunkenSelector>
              {([['all', '全部'], ['expense', '支出'], ['income', '收入']] as const).map(([val, label]) => (
                <FilterChip key={val} label={label} active={filterType === val} onClick={() => setFilterType(val)}
                  tint={val !== 'all' ? { bg: HUE.indigo.tint, fg: HUE.indigo.ink } : undefined} />
              ))}
            </SunkenSelector>
          </div>
          <div>
            <div className="text-[11px] mb-2" style={{ color: F.textTertiary }}>账户</div>
            <div className="flex gap-2 flex-wrap">
              <FilterChip label="全部" active={filterAccountIds.size === 0} onClick={() => setFilterAccountIds(new Set())} />
              {accounts.filter(a => !a.isArchived).map(a => (
                <FilterChip key={a.id} label={a.name} active={filterAccountIds.has(a.id)} onClick={() => toggleAccount(a.id)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 收支汇总 */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 p-3.5" style={{ background: HUE.green.tint, borderRadius: R.smallCard, boxShadow: S.raisedSoft }}>
          <div style={{ color: HUE.green.ink, fontSize: 12, fontWeight: 500, marginBottom: 4 }}>收入</div>
          {(totalIncome.length ? totalIncome : [['CNY', 0] as [string, number]]).map(([currency, amount]) => (
            <div key={currency} style={{ color: HUE.green.ink, fontSize: 18, fontWeight: 700 }}>+{formatAmount(amount, currency)}</div>
          ))}
        </div>
        <div className="flex-1 p-3.5" style={{ background: HUE.rose.tint, borderRadius: R.smallCard, boxShadow: S.raisedSoft }}>
          <div style={{ color: HUE.rose.ink, fontSize: 12, fontWeight: 500, marginBottom: 4 }}>支出</div>
          {(totalExpense.length ? totalExpense : [['CNY', 0] as [string, number]]).map(([currency, amount]) => (
            <div key={currency} style={{ color: HUE.rose.ink, fontSize: 18, fontWeight: 700 }}>-{formatAmount(amount, currency)}</div>
          ))}
        </div>
      </div>

      {/* 今日情报 */}
      <div className="p-4 mb-5" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Coffee size={18} weight="bold" style={{ color: F.textSecondary }} />
            <span className="text-sm font-medium" style={{ color: F.textPrimary }}>今日情报</span>
          </div>
          <button
            onClick={generateGossip}
            disabled={gossipLoading}
            className="text-xs font-medium active:scale-95 transition-transform"
            style={{ color: gossipLoading ? F.textTertiary : F.accent }}
          >
            {gossipLoading ? '生成中...' : gossipText ? '换一条' : '来一条 →'}
          </button>
        </div>
        {gossipChar && gossipText ? (
          <div>
            <div className="text-xs leading-relaxed mb-2" style={{ color: F.textSecondary }}>「{gossipText}」</div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]" style={{ color: F.textTertiary }}>关于</span>
              {gossipChar.avatar ? (
                <img src={gossipChar.avatar} className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <div className="w-4 h-4 rounded-full flex items-center justify-center text-[9px]" style={{ background: F.borderStrong, color: F.textSecondary }}>
                  {gossipChar.name[0]}
                </div>
              )}
              <span className="text-[10px]" style={{ color: F.textTertiary }}>{gossipChar.name}</span>
            </div>
          </div>
        ) : (
          <div className="text-xs" style={{ color: F.textTertiary }}>点击右上角获取今日情报</div>
        )}
      </div>

      {/* 流水列表 */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center" style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: 24 }}>
          <Receipt className="w-[18px] h-[18px] mb-2" weight="bold" style={{ color: F.textTertiary }} />
          <span style={{ color: F.textTertiary, fontSize: 14 }}>
            {transactions.length === 0 ? '还没有交易记录' : '没有匹配的交易'}
          </span>
        </div>
      ) : (
        Array.from(byDate.entries()).map(([dateStr, txs]) => {
          const dayExpense = totalsByCurrency(txs.filter(t => t.type === 'expense'));
          const dayIncome = totalsByCurrency(txs.filter(t => t.type === 'income' || t.type === 'refund'));
          const [, month, day] = dateStr.split('-');
          return (
            <div key={dateStr} className="mb-4">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="text-sm font-medium" style={{ color: F.textPrimary }}>
                  {parseInt(month)}月{parseInt(day)}日 · {formatWeekday(dateStr)}
                </div>
                <div className="flex gap-3 text-xs">
                  {dayExpense.map(([currency, amount]) => <span key={`expense-${currency}`} style={{ color: HUE.rose.main }}>-{formatAmount(amount, currency)}</span>)}
                  {dayIncome.map(([currency, amount]) => <span key={`income-${currency}`} style={{ color: HUE.green.main }}>+{formatAmount(amount, currency)}</span>)}
                </div>
              </div>
              <div className="overflow-hidden" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
                {txs.map((t, i) => {
                  const cat = catMap.get(t.categoryId);
                  const acc = accMap.get(t.accountId);
                  const sym = CURRENCY_SYMBOLS[t.currency] || '$';
                  return (
                    <button
                      key={t.id}
                      onClick={() => setEditingTx(t)}
                      className="w-full flex items-center px-4 py-3 text-left transition-colors"
                      style={i < txs.length - 1 ? { borderBottom: `1px solid ${F.divider}` } : undefined}
                    >
                      <div className="w-8 h-8 flex items-center justify-center text-base mr-3 shrink-0" style={{ borderRadius: R.medium, background: F.surfaceSunken }}>
                        {cat?.icon || '📋'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate" style={{ color: F.textPrimary }}>{t.note || cat?.name || '未分类'}</div>
                        <div className="text-[11px]" style={{ color: F.textTertiary }}>#{acc?.name || '未知账户'}</div>
                      </div>
                      <div className="text-sm font-semibold"
                        style={{ color: t.type === 'income' || t.type === 'refund' ? HUE.green.main : F.textPrimary }}>
                        {t.type === 'income' || t.type === 'refund' ? '+' : '-'}{sym}{t.amount.toLocaleString()}
                      </div>
                      <div className="ml-2 text-xs" style={{ color: F.textTertiary }}>›</div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {/* 新增按钮 */}
      <button
        onClick={() => setEditingTx('new')}
        className="fixed right-5 bottom-32 flex items-center justify-center active:scale-90 transition-transform z-10"
        style={{ width: 56, height: 56, borderRadius: R.pill, background: HUE.blue.main, boxShadow: S.floating, color: F.surfaceRaised }}
      >
        <Plus className="w-6 h-6" weight="bold" />
      </button>
    </div>
  );
};

// ── 分析 + TA 读 Tab ──

const CHART_COLORS = [
  HUE.red.main, HUE.orange.main, HUE.amber.main, HUE.green.main, HUE.blue.main,
  HUE.purple.main, HUE.rose.main, HUE.cyan.main, HUE.orange.main, HUE.gray.main,
];

type Tone = 'teasing' | 'serious' | 'encouraging' | 'caring';
const TONE_LABELS: Record<Tone, string> = {
  teasing: '调侃', serious: '严肃', encouraging: '鼓励', caring: '心疼',
};

const DonutChart: React.FC<{
  data: { label: string; value: number; color: string }[];
  total: number;
  centerLabel: string;
  centerTitle?: string;
}> = ({ data, total, centerLabel, centerTitle = '支出' }) => {
  const size = 160;
  const strokeWidth = 28;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={F.borderSoft} strokeWidth={strokeWidth}
      />
      {data.map((seg, i) => {
        const pct = total > 0 ? seg.value / total : 0;
        const segLen = pct * circumference;
        const offset = cumulativeOffset;
        cumulativeOffset += segLen;
        if (segLen < 0.5) return null;
        return (
          <circle
            key={i}
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={seg.color} strokeWidth={strokeWidth}
            strokeDasharray={`${segLen} ${circumference - segLen}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease' }}
          />
        );
      })}
      <text x={size / 2} y={size / 2 - 6} textAnchor="middle" className="text-[10px]" fill={F.textTertiary}>{centerTitle}</text>
      <text x={size / 2} y={size / 2 + 12} textAnchor="middle" className="text-sm font-bold" fill={F.textPrimary}>{centerLabel}</text>
    </svg>
  );
};

interface NotableTx {
  note: string;
  amount: number;
  currency: string;
  category: string;
  dateStr: string;
  flag: string;
}

function findNotableTransactions(
  periodTxs: FinanceTransaction[],
  allTxs: FinanceTransaction[],
  catMap: Map<string, FinanceCategory>,
): NotableTx[] {
  const notable: NotableTx[] = [];
  if (periodTxs.length === 0) return notable;

  const getCatName = (t: FinanceTransaction) => {
    const cat = catMap.get(t.categoryId);
    return cat?.name || '未分类';
  };
  const getTopCatId = (t: FinanceTransaction) => {
    const cat = catMap.get(t.categoryId);
    return cat?.parentId || t.categoryId;
  };
  const sym = (c: string) => CURRENCY_SYMBOLS[c] || c;

  const sorted = [...periodTxs].sort((a, b) => b.amount - a.amount);
  const topN = sorted.slice(0, 3);
  for (const t of topN) {
    notable.push({
      note: t.note || getCatName(t),
      amount: t.amount,
      currency: t.currency,
      category: getCatName(t),
      dateStr: t.dateStr,
      flag: '高额',
    });
  }

  const catAvg = new Map<string, { sum: number; count: number }>();
  for (const t of allTxs) {
    if (t.type !== 'expense') continue;
    const topId = getTopCatId(t);
    const entry = catAvg.get(topId) || { sum: 0, count: 0 };
    entry.sum += t.amount;
    entry.count += 1;
    catAvg.set(topId, entry);
  }

  for (const t of periodTxs) {
    const topId = getTopCatId(t);
    const avg = catAvg.get(topId);
    if (!avg || avg.count < 3) continue;
    const mean = avg.sum / avg.count;
    if (t.amount > mean * 2.5 && !topN.includes(t)) {
      notable.push({
        note: t.note || getCatName(t),
        amount: t.amount,
        currency: t.currency,
        category: getCatName(t),
        dateStr: t.dateStr,
        flag: `异常（该分类平均${sym(t.currency)}${mean.toFixed(0)}，这笔${sym(t.currency)}${t.amount.toFixed(0)}）`,
      });
    }
  }

  const withNotes = periodTxs.filter(t =>
    t.note && t.note.trim().length > 2 && !topN.includes(t)
  );
  const interesting = withNotes
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  for (const t of interesting) {
    if (notable.some(n => n.dateStr === t.dateStr && n.note === (t.note || getCatName(t)))) continue;
    notable.push({
      note: t.note!,
      amount: t.amount,
      currency: t.currency,
      category: getCatName(t),
      dateStr: t.dateStr,
      flag: '有备注',
    });
  }

  const seen = new Set<string>();
  return notable.filter(n => {
    const key = `${n.dateStr}_${n.note}_${n.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function buildTAReadPrompt(
  char: CharacterProfile,
  userName: string,
  periodLabel: string,
  totalExpense: number,
  catBreakdown: { name: string; amount: number; pct: number }[],
  notableTxs: NotableTx[],
  tone: Tone,
  memoryContext?: string,
): string {
  const toneInstructions: Record<Tone, string> = {
    teasing: `用调侃、打趣的语气。可以毒舌但不伤人，像真正了解${userName}的人在吐槽——你知道ta的哪些消费习惯是老毛病，哪些是可以拿来开玩笑的。`,
    serious: `用认真、理性的语气。不是泛泛而谈的财务建议，而是基于你对${userName}生活习惯的了解，指出真正值得注意的地方。`,
    encouraging: `用鼓励、温暖的语气。不要说"你很棒"这种空话——提一个具体做得好的地方，再自然地带一句可以更好的方向。`,
    caring: `用心疼、关怀的语气。不是居高临下的关心，而是一个真正在意${userName}的人从消费数据里读出ta最近状态的直觉——ta是不是太忙了、是不是没好好吃饭、是不是压力大了。`,
  };

  const breakdown = catBreakdown
    .slice(0, 6)
    .map(c => `  - ${c.name}: ${c.amount.toFixed(0)}元 (${c.pct}%)`)
    .join('\n');

  let prompt = `[System: 角色身份]\n你是「${char.name}」。\n\n`;

  prompt += `### 核心性格\n${char.systemPrompt || '你是一个有个性的人。'}\n\n`;

  if (char.selfInsights && char.selfInsights.length > 0) {
    prompt += `### 内在认知\n`;
    prompt += `这些是你内心深处明白的事，影响着你看待一切的方式：\n`;
    char.selfInsights.forEach(insight => { prompt += `- ${insight}\n`; });
    prompt += `\n`;
  }

  const imp = normalizeUserImpression(char.impression);
  if (imp) {
    prompt += `### 你眼中的${userName}\n`;
    prompt += `- 核心评价: ${imp.personality_core.summary}\n`;
    prompt += `- 互动模式: ${imp.personality_core.interaction_style}\n`;
    if (imp.value_map.likes.length) prompt += `- ta的喜好: ${imp.value_map.likes.join(', ')}\n`;
    if (imp.behavior_profile.emotion_summary) prompt += `- ta的情绪模式: ${imp.behavior_profile.emotion_summary}\n`;
    if (imp.emotion_schema.stress_signals.length) prompt += `- 压力信号: ${imp.emotion_schema.stress_signals.join(', ')}\n`;
    prompt += `\n`;
  }

  prompt += `### 消费数据（${periodLabel}）\n`;
  prompt += `总支出: ${totalExpense.toFixed(2)}元\n`;
  prompt += `分类汇总:\n${breakdown}\n\n`;

  if (notableTxs.length > 0) {
    prompt += `### 具体交易明细\n`;
    prompt += `以下是${periodLabel}值得注意的单笔消费。你应该像一个真正关注${userName}生活的人一样阅读这些——有些东西会让你好奇、兴奋、心疼或者想吐槽。根据你的性格和你们的关系，挑你最有感觉的来聊。\n\n`;
    for (const tx of notableTxs) {
      const s = CURRENCY_SYMBOLS[tx.currency] || tx.currency;
      prompt += `  - [${tx.dateStr}] ${tx.note}  ${s}${tx.amount.toFixed(0)}  (${tx.category}) [${tx.flag}]\n`;
    }
    prompt += `\n`;
    prompt += `阅读指引：\n`;
    prompt += `- 这些不是数字，是${userName}真实的生活痕迹。一笔异常高的超市消费可能是ta做了一桌好菜，也可能是压力大了在买买买\n`;
    prompt += `- 如果某笔消费跟你的爱好/性格/你们的关系有关，你自然会有更强烈的反应（激动、好奇、想参与、想吐槽）\n`;
    prompt += `- 如果有看不懂的消费，可以表现出好奇\n`;
    prompt += `- 不需要每一笔都评价，挑1~2笔你最有感觉的就够\n\n`;
  }

  if (memoryContext) {
    prompt += `### 你关于${userName}消费的记忆\n`;
    prompt += `以下是你记忆中与消费/购物相关的片段。如果某笔消费和你的记忆有关联（比如ta之前提过想买的东西、或者你们聊过的话题），你可以自然地提起——但不要生硬地罗列记忆，只在真的有感触时才提。\n\n`;
    prompt += memoryContext + '\n\n';
  }

  prompt += `### 任务\n`;
  prompt += `以「${char.name}」的口吻，用${TONE_LABELS[tone]}的语气评价${userName}${periodLabel}的消费。\n\n`;
  prompt += `语气要求：\n${toneInstructions[tone]}\n\n`;

  prompt += `写作质量要求（极其重要）：\n`;
  prompt += `- 4~6句，像在聊天中随口说的，不是写报告\n`;
  prompt += `- 先对整体消费做一个简短判断（一句就够），然后重点聊你最在意的1~2笔具体消费\n`;
  prompt += `- 你对具体交易的反应要完全基于你的性格和你们的关系——同一笔消费，不同人看到的重点完全不同\n`;
  prompt += `- 你说的话必须只有你能说出来——带着你的性格、你对${userName}的了解、你们之间的相处方式。如果把你换成别人，这段话不应该还成立\n`;
  prompt += `- 拒绝空话（"要注意理财哦"、"花得有点多了"这种谁都能说的废话不要写）\n`;
  prompt += `- 情绪要有层次：不要只有一种单调的情绪\n`;
  prompt += `- 直接输出评价文字，不要加引号、不要"我觉得"开头、不要角色名前缀\n`;

  return prompt;
}

const AnalyticsTab: React.FC<{
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  filterType: 'all' | 'expense' | 'income';
  setFilterType: React.Dispatch<React.SetStateAction<'all' | 'expense' | 'income'>>;
}> = ({ transactions, categories, accounts, filterType, setFilterType }) => {
  const { characters, apiConfig, userProfile } = useOS();
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>('teasing');
  const [commentary, setCommentary] = useState<string | null>(null);
  const [loadingComment, setLoadingComment] = useState(false);
  const commentCache = useRef<Map<string, string>>(new Map());

  // 加载 IndexedDB 中已缓存的评论
  useEffect(() => {
    FinanceDB.getAllTAComments().then(comments => {
      for (const c of comments) {
        commentCache.current.set(c.id, c.text);
      }
    }).catch(() => {});
  }, []);

  const { from: fromDate, to: toDate, label: periodLabel } = getDateRange(period, periodOffset);

  // 切换周期时重置 offset
  const handleSetPeriod = (p: typeof period) => {
    setPeriod(p);
    setPeriodOffset(0);
  };

  const periodTxs = transactions.filter(t => {
    if (t.dateStr < fromDate || t.dateStr > toDate) return false;
    if (filterAccountId && t.accountId !== filterAccountId) return false;
    if (filterType === 'expense' && t.type !== 'expense') return false;
    if (filterType === 'income' && t.type !== 'income' && t.type !== 'refund') return false;
    return true;
  });

  // "收支" 模式：分别计算收入支出
  const expenseTxs = transactions.filter(t => t.dateStr >= fromDate && t.dateStr <= toDate && t.type === 'expense' && (!filterAccountId || t.accountId === filterAccountId));
  const incomeTxs = transactions.filter(t => t.dateStr >= fromDate && t.dateStr <= toDate && (t.type === 'income' || t.type === 'refund') && (!filterAccountId || t.accountId === filterAccountId));
  const totalExpense = expenseTxs.reduce((s, t) => s + t.amount, 0);
  const totalIncome = incomeTxs.reduce((s, t) => s + t.amount, 0);
  const netBalance = totalIncome - totalExpense;

  const totalAmount = periodTxs.reduce((s, t) => s + t.amount, 0);

  const catMap = new Map(categories.map(c => [c.id, c]));

  const byCat = new Map<string, number>();
  for (const t of periodTxs) {
    const cat = catMap.get(t.categoryId);
    const topId = cat?.parentId || t.categoryId;
    byCat.set(topId, (byCat.get(topId) || 0) + t.amount);
  }

  const catList = Array.from(byCat.entries())
    .map(([catId, amount], i) => ({
      cat: catMap.get(catId),
      amount,
      pct: totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }))
    .sort((a, b) => b.amount - a.amount);

  const donutData = catList.map(c => ({
    label: c.cat?.name || '未分类',
    value: c.amount,
    color: c.color,
  }));

  const typeLabel = filterType === 'expense' ? '支出' : filterType === 'income' ? '收入' : '收支';
  const activeFilterCount = filterAccountId ? 1 : 0;

  useEffect(() => {
    setCommentary(null);
    setSelectedCharId(null);
  }, [period, periodOffset, filterAccountId, filterType]);

  const handleSelectChar = (charId: string) => {
    setSelectedCharId(charId);
    const cacheKey = `${charId}_${period}${periodOffset}_${tone}_${filterAccountId || 'all'}_${filterType}`;
    const cached = commentCache.current.get(cacheKey);
    setCommentary(cached || null);
  };

  const generateCommentary = async () => {
    if (!selectedCharId || !apiConfig?.baseUrl) return;
    const char = characters.find(c => c.id === selectedCharId);
    if (!char) return;

    const cacheKey = `${selectedCharId}_${period}${periodOffset}_${tone}_${filterAccountId || 'all'}_${filterType}`;
    const cached = commentCache.current.get(cacheKey);
    if (cached) { setCommentary(cached); return; }

    setLoadingComment(true);
    setCommentary(null);

    try {
      const catBreakdown = catList.map(c => ({
        name: c.cat?.name || '未分类',
        amount: c.amount,
        pct: c.pct,
      }));
      const notableTxs = findNotableTransactions(periodTxs, transactions, catMap);

      // 从记忆宫殿检索消费相关记忆
      let memoryContext = '';
      try {
        const allNodes = await MemoryNodeDB.getByCharId(selectedCharId);
        if (allNodes.length > 0) {
          // 用消费关键词 + 具体交易备注做 BM25 搜索
          const searchTerms = [
            '买', '花钱', '消费', '购物', '钱', '想要', '价格',
            ...notableTxs.slice(0, 3).map(t => t.note).filter(Boolean),
            ...catBreakdown.slice(0, 3).map(c => c.name),
          ].join(' ');
          const hits = bm25Search(searchTerms, allNodes, 5);
          if (hits.length > 0) {
            memoryContext = hits
              .map(h => `- ${h.node.content}`)
              .join('\n');
          }
        }
      } catch { /* 记忆宫殿不可用也不影响基本功能 */ }

      const prompt = buildTAReadPrompt(
        char, userProfile?.name || '用户', periodLabel,
        totalAmount, catBreakdown, notableTxs, tone, memoryContext,
      );

      const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
      const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.apiKey || 'sk-none'}`,
        },
        body: JSON.stringify({
          model: apiConfig.model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `请评价我${periodLabel}的消费。` },
          ],
          temperature: 0.85,
          max_tokens: 4000, // 思考型模型(Gemini等)会先吃 max_tokens 思考，给小了正文被截断
          stream: false,
        }),
      });

      const reply = extractContent(data).trim();
      if (reply) {
        commentCache.current.set(cacheKey, reply);
        setCommentary(reply);
        // 持久化到 IndexedDB
        FinanceDB.saveTAComment({ id: cacheKey, text: reply, createdAt: Date.now() }).catch(() => {});

        // 回传记忆宫殿 — 让角色记住自己评论过用户的消费
        const userName = userProfile?.name || '用户';
        const topCats = catBreakdown.slice(0, 3).map(c => c.name).join('、');
        const memoryContent = `${char.name}看了${userName}${periodLabel}的消费记录（${topCats}等，总计${totalAmount.toFixed(0)}元），评价道：「${reply.slice(0, 150)}」`;
        const memNode: MemoryNode = {
          id: `bank_ta_${Date.now()}_${char.id}`,
          charId: char.id,
          content: memoryContent,
          room: 'user_room',
          tags: ['消费', '记账', '评价', ...catBreakdown.slice(0, 3).map(c => c.name)],
          importance: 3,
          mood: tone === 'caring' ? 'caring' : tone === 'teasing' ? 'playful' : 'neutral',
          embedded: false,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
          origin: 'system',
        };
        MemoryNodeDB.save(memNode).catch(() => {});

        // 在角色聊天里插入系统日志气泡
        DB.saveMessage({
          charId: char.id,
          role: 'system',
          type: 'interaction' as any,
          content: `${char.name}翻了翻你的账本，评价了你${periodLabel}的消费`,
          metadata: { kind: 'bank_ta_read' },
        }).catch(() => {});
      }
    } catch (e) {
      setCommentary('生成失败，请检查 API 配置。');
    } finally {
      setLoadingComment(false);
    }
  };

  const handleToneChange = (t: Tone) => {
    setTone(t);
    if (selectedCharId) {
      const cacheKey = `${selectedCharId}_${period}${periodOffset}_${t}_${filterAccountId || 'all'}_${filterType}`;
      const cached = commentCache.current.get(cacheKey);
      setCommentary(cached || null);
    }
  };

  return (
    <div className="px-5 pt-2 pb-4">
      {/* 周/月/年 选择器 — 占满整行 */}
      <div className="mb-3">
        <SunkenSelector>
          {(['week', 'month', 'year'] as const).map(p => (
            <FilterChip key={p} label={p === 'week' ? '周' : p === 'month' ? '月' : '年'} active={period === p} onClick={() => handleSetPeriod(p)} />
          ))}
        </SunkenSelector>
      </div>
      {accounts.length > 1 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center justify-center active:translate-y-[2px] transition-transform shrink-0"
            style={{ height: 32, paddingLeft: 12, paddingRight: 12, borderRadius: R.pill, background: F.surfaceRaised, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, color: activeFilterCount > 0 ? HUE.blue.main : F.textSecondary, fontSize: 11, fontWeight: 500 }}
          >
            账户{activeFilterCount > 0 && ` ${activeFilterCount}`}
          </button>
        </div>
      )}

      {/* 展开账户筛选 */}
      {showFilters && (
        <div className="p-4 mb-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          <div className="text-[11px] mb-2" style={{ color: F.textTertiary }}>账户</div>
          <div className="flex gap-2 flex-wrap">
            <FilterChip label="全部" active={!filterAccountId} onClick={() => setFilterAccountId(null)} />
            {accounts.filter(a => !a.isArchived).map(a => (
              <FilterChip key={a.id} label={a.name} active={filterAccountId === a.id} onClick={() => setFilterAccountId(a.id)} />
            ))}
          </div>
        </div>
      )}

      {/* 时间段导航 + 金额总计 */}
      <div className="mb-4 p-4" style={{ background: HUE.indigo.tint, borderRadius: R.bigCard }}>
        <div className="flex items-center justify-center gap-3 mb-2">
          <button onClick={() => setPeriodOffset(o => o - 1)} className="w-8 h-8 flex items-center justify-center rounded-full active:bg-white/40 transition-colors" style={{ color: HUE.indigo.ink }}>
            <CaretLeft className="w-4 h-4" weight="bold" />
          </button>
          <span className="text-sm font-medium min-w-[80px] text-center" style={{ color: HUE.indigo.ink }}>
            {periodLabel}
          </span>
          <button
            onClick={() => periodOffset < 0 && setPeriodOffset(o => o + 1)}
            className="w-8 h-8 flex items-center justify-center rounded-full active:bg-white/40 transition-colors"
            style={{ color: periodOffset < 0 ? HUE.indigo.ink : HUE.indigo.soft }}
            disabled={periodOffset >= 0}
          >
            <CaretRight className="w-4 h-4" weight="bold" />
          </button>
        </div>
        {filterType === 'all' ? (
          <div className="text-center">
            <div className="text-4xl font-bold mb-3" style={{ color: HUE.indigo.ink }}>
              {netBalance >= 0 ? '+' : ''}{formatAmount(netBalance)}
            </div>
            <div className="flex justify-center gap-3">
              <span className="flex items-center gap-1.5 px-3 py-1" style={{ background: 'rgba(255,255,255,0.6)', borderRadius: R.pill, fontSize: 12 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: HUE.green.main }} />
                <span style={{ color: HUE.green.ink, fontWeight: 500 }}>收入 +{formatAmount(totalIncome)}</span>
              </span>
              <span className="flex items-center gap-1.5 px-3 py-1" style={{ background: 'rgba(255,255,255,0.6)', borderRadius: R.pill, fontSize: 12 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: HUE.rose.main }} />
                <span style={{ color: HUE.rose.ink, fontWeight: 500 }}>支出 {formatAmount(totalExpense)}</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-4xl font-bold" style={{ color: HUE.indigo.ink }}>{formatAmount(totalAmount)}</div>
          </div>
        )}
      </div>

      {/* 饼图 */}
      <div className="p-4 mb-5" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
        {catList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8" style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: 24 }}>
            <ChartPie className="w-[18px] h-[18px] mb-2" weight="bold" style={{ color: F.textTertiary }} />
            <span style={{ color: F.textTertiary, fontSize: 14 }}>暂无数据</span>
          </div>
        ) : (
          <DonutChart data={donutData} total={totalAmount} centerLabel={formatAmount(totalAmount)} centerTitle={typeLabel} />
        )}
      </div>

      {/* 分类列表 */}
      {catList.length === 0 ? (
        <div className="flex flex-col items-center justify-center mb-6" style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: 24 }}>
          <Receipt className="w-[18px] h-[18px] mb-2" weight="bold" style={{ color: F.textTertiary }} />
          <span style={{ color: F.textTertiary, fontSize: 14 }}>暂无{typeLabel}数据</span>
        </div>
      ) : (
        <div className="overflow-hidden mb-6" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
          {catList.map(({ cat, amount, pct, color }, i) => {
            const budget = cat?.monthlyBudget;
            const budgetPct = budget && budget > 0 ? Math.min((amount / budget) * 100, 100) : null;
            const overBudget = budget && amount > budget;
            return (
              <div
                key={cat?.id || i}
                className="px-4 py-3"
                style={i < catList.length - 1 ? { borderBottom: `1px solid ${F.divider}` } : undefined}
              >
                <div className="flex items-center">
                  <div className="w-3 h-3 rounded-full shrink-0 mr-2.5" style={{ backgroundColor: color }} />
                  <span className="text-base mr-2">{cat?.icon || '📋'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm" style={{ color: F.textPrimary }}>{cat?.name || '未分类'}</div>
                    <div className="w-full h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: F.surfaceSunken }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                  <div className="text-right ml-3">
                    <div className="text-sm font-semibold" style={{ color: F.textPrimary }}>{formatAmount(amount)}</div>
                    <div className="text-[10px]" style={{ color: F.textTertiary }}>{pct}%</div>
                  </div>
                </div>
                {/* 预算进度条 */}
                {budget && budgetPct !== null && filterType === 'expense' && (period === 'month' || period === 'week') && (
                  <div className="mt-2 ml-[22px]">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px]" style={{ color: F.textTertiary }}>预算 {formatAmount(budget)}</span>
                      <span className="text-[10px] font-medium" style={{ color: overBudget ? STATUS.danger.main : F.textTertiary }}>
                        {Math.round(budgetPct)}%{overBudget ? ' 超支' : ''}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: F.surfaceSunken, boxShadow: S.sunken }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${budgetPct}%`,
                          background: overBudget ? STATUS.danger.main : BANK_HUE.asset.main,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* TA 读区域 */}
      <div className="p-4" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
        <div className="text-sm font-medium mb-3" style={{ color: F.textPrimary }}>TA 怎么看</div>
        <div className="text-xs mb-3" style={{ color: F.textTertiary }}>选一个角色来评价你{periodLabel}的消费</div>

        {/* 角色选择 — 直接用全量 characters */}
        <div className="mb-3">
          <SunkenSelector className="overflow-x-auto scrollbar-none">
            {characters.map(c => {
              const isActive = selectedCharId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => handleSelectChar(c.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all shrink-0"
                  style={{
                    borderRadius: R.medium,
                    background: isActive ? F.surfaceRaised : 'transparent',
                    color: isActive ? F.textPrimary : F.textTertiary,
                    boxShadow: isActive ? S.raisedSoft : 'none',
                    transition: `all ${MOTION.hover} ${MOTION.ease}`,
                  }}
                >
                  {c.avatar ? (
                    <img src={c.avatar} className="w-4 h-4 rounded-full object-cover" />
                  ) : null}
                  {c.name}
                </button>
              );
            })}
          </SunkenSelector>
        </div>

        {/* 语气切换 */}
        {selectedCharId && (
          <SunkenSelector className="mb-4">
            {(Object.entries(TONE_LABELS) as [Tone, string][]).map(([t, label]) => (
              <FilterChip key={t} label={label} active={tone === t} onClick={() => handleToneChange(t)} />
            ))}
          </SunkenSelector>
        )}

        {/* 评论内容 */}
        {!selectedCharId ? (
          <div className="text-center py-6 text-sm" style={{ color: F.textTertiary }}>点击上方角色开始</div>
        ) : commentary ? (
          <div className="py-3">
            <div className="text-sm leading-relaxed whitespace-pre-wrap mb-3" style={{ color: F.textSecondary }}>
              「{commentary}」
            </div>
            <button
              onClick={() => {
                const cacheKey = `${selectedCharId}_${period}${periodOffset}_${tone}_${filterAccountId || 'all'}_${filterType}`;
                commentCache.current.delete(cacheKey);
                generateCommentary();
              }}
              disabled={loadingComment}
              className="text-xs font-medium"
              style={{ color: loadingComment ? F.textTertiary : F.accent }}
            >
              换一个说法
            </button>
          </div>
        ) : (
          <div className="text-center py-6">
            <button
              onClick={generateCommentary}
              disabled={loadingComment || totalAmount === 0}
              className="px-5 py-2.5 text-sm font-medium active:scale-95 transition-transform"
              style={{
                borderRadius: R.medium,
                background: loadingComment || totalAmount === 0 ? F.borderStrong : HUE.blue.main,
                color: loadingComment || totalAmount === 0 ? F.textTertiary : F.surfaceRaised,
              }}
            >
              {loadingComment ? '生成中...' : `让${characters.find(c => c.id === selectedCharId)?.name || 'TA'}来说说`}
            </button>
            {totalAmount === 0 && (
              <div className="text-[11px] mt-2" style={{ color: F.textTertiary }}>没有{typeLabel}数据</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BankApp;
