// Local-only, opt-in browser acceptance harness. No API credentials or real data.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import BankApp from '../apps/BankApp';
import { OSProvider } from '../context/OSContext';
import { FinanceDB } from '../utils/financeDb';
import { hasSimpleFinConnection } from '../utils/simplefinClient';
import { F, R, S } from '../utils/clayTokens';
import type { FinanceTransaction } from '../types';

function Preview() {
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function start(mode: 'seed' | 'continue' | 'extend') {
    setBusy(true);
    try {
      if (!['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('仅可在独立 localhost 测试端口运行');
      if (hasSimpleFinConnection()) throw new Error('这个测试端口已连接银行，请换一个空白端口。');
      await FinanceDB.init();
      if (mode === 'seed') {
        if ((await FinanceDB.getTransactions()).length || (await FinanceDB.getAccounts()).length) {
          throw new Error('这个浏览器来源已有账目，不覆盖。可继续已有验收，或换一个空白测试端口。');
        }
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-12`;
        const make = (id: string, amount: number, patch: Partial<FinanceTransaction> = {}): FinanceTransaction => ({
          id, amount, dateStr, timestamp: new Date(`${dateStr}T12:00:00`).getTime(), type: 'expense', currency: 'USD',
          accountId: 'demo-account', categoryId: 'cat_food', note: id, ...patch,
        });
        await FinanceDB.saveAccount({ id: 'demo-account', name: '合成验收账户', type: 'checking', currency: 'USD', initialBalance: 5000, color: F.accent });
        await FinanceDB.saveTransactions([
          ...Array.from({ length: 24 }, (_, i) => make(`日常样本 ${i + 1}`, 10 + i, { dateStr: `${dateStr.slice(0, 8)}${String(i % 12 + 1).padStart(2, '0')}` })),
          make('合成家具', 800, { analysisTreatment: 'one_off' }),
          make('合成代充付款', 200), make('合成代充收款', 200, { type: 'income', categoryId: 'cat_income' }),
          make('合成房租', 900, { analysisTreatment: 'keep' }), make('合成临时大额', 180),
          make('合成待入账', 88, { pending: true }),
          make('合成旧授权', 25, { pending: true, excludedFromReporting: true }),
        ]);
        await FinanceDB.saveSetting('financeSettings', { enabledCurrencies: ['USD'], defaultCurrency: 'USD' });
      }
      const accounts = await FinanceDB.getAccounts();
      const transactions = await FinanceDB.getTransactions();
      if (accounts.length !== 1 || accounts[0].id !== 'demo-account' || transactions.some(t => t.accountId !== 'demo-account')) {
        throw new Error('这里只打开合成验收账本，请先在空白测试端口载入合成数据。');
      }
      if (mode === 'extend') {
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const examples: [number, number, string][] = [
          [2, 23.8, '午餐'], [3, 31.2, '超市'], [4, 18.6, '早餐和咖啡'],
          [5, 57.4, '周末采购'], [6, 26.9, '晚餐'], [7, 42.5, '日用品'],
          [9, 29.8, '午餐'], [10, 118, '落地灯'], [11, 52.6, '周末聚餐'],
          [13, 136, '置物架'], [14, 24.3, '午餐'], [15, 63.7, '食材'], [16, 32.8, '日用品'],
        ];
        await FinanceDB.saveTransactions(examples.filter(([day]) => day <= now.getDate()).map(([day, amount, name]) => {
          const dateStr = `${month}-${String(day).padStart(2, '0')}`;
          return { id: `demo-extra-${month}-${day}`, amount, dateStr, timestamp: new Date(`${dateStr}T12:00:00`).getTime(),
            type: 'expense' as const, currency: 'USD', accountId: 'demo-account', categoryId: 'cat_food', note: `模拟·${name}` };
        }));
      }
      setStarted(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  if (started) return <OSProvider><div style={{ height: '100dvh', position: 'relative', '--chrome-top': '16px' } as React.CSSProperties}><BankApp /></div></OSProvider>;
  return <main style={{ padding: 24, color: F.textPrimary, background: F.appBg, minHeight: '100dvh', fontFamily: 'sans-serif' }}>
    <h1>消费分析 · 合成数据验收</h1>
    <p>仅在空白本地测试端口载入合成账目，不连接 SimpleFIN，不使用真实交易或模型 API。</p>
    <button disabled={busy} onClick={() => start('seed')} style={{ padding: 16, minHeight: 44, borderRadius: R.button, background: F.surface, boxShadow: S.raisedSoft }}>载入合成验收数据</button>
    <button disabled={busy} onClick={() => start('continue')} style={{ padding: 16, marginLeft: 12, minHeight: 44, borderRadius: R.button, background: F.surface, boxShadow: S.raisedSoft }}>继续已有验收</button>
    <button disabled={busy} onClick={() => start('extend')} style={{ padding: 16, marginTop: 12, minHeight: 44, borderRadius: R.button, background: F.surface, boxShadow: S.raisedSoft }}>补充多日样本</button>
    {error && <p role="alert">{error}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
