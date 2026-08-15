import React, { useEffect, useState } from 'react';
import { ArrowSquareOut, ArrowsClockwise, CheckCircle, LinkSimple, PlugsConnected, WarningCircle } from '@phosphor-icons/react';
import { F, HUE, MOTION, R, S, STATUS } from '../../utils/clayTokens';
import {
  claimSimpleFinSetupToken,
  forgetSimpleFinConnection,
  hasSimpleFinConnection,
} from '../../utils/simplefinClient';
import {
  getSimpleFinSyncState,
  syncSimpleFin,
  type SimpleFinSyncResult,
  type SimpleFinSyncState,
} from '../../utils/simplefinSync';

interface SimpleFinSettingsCardProps {
  onSynced: () => Promise<void>;
}

function formatSyncTime(timestamp?: number): string {
  if (!timestamp) return '还没有同步';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SimpleFinSettingsCard: React.FC<SimpleFinSettingsCardProps> = ({ onSynced }) => {
  const [connected, setConnected] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const [syncState, setSyncState] = useState<SimpleFinSyncState>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const refreshState = async () => {
    setConnected(hasSimpleFinConnection());
    setSyncState(await getSimpleFinSyncState());
  };

  useEffect(() => {
    void refreshState();
  }, []);

  const finishSync = async (result: SimpleFinSyncResult) => {
    await onSynced();
    await refreshState();
    const warning = result.errors.length > 0
      ? `。SimpleFIN 提示：${result.errors.slice(0, 2).map(text => text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).join('；').slice(0, 240)}`
      : '';
    setMessage({
      kind: result.errors.length > 0 ? 'error' : 'success',
      text: `已同步 ${result.accountCount} 个账户、${result.transactionCount} 笔近期交易${result.newTransactionCount > 0 ? `，其中 ${result.newTransactionCount} 笔待确认分类` : ''}${warning}`,
    });
  };

  const handleConnect = async () => {
    if (!setupToken.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await claimSimpleFinSetupToken(setupToken);
      setSetupToken('');
      setConnected(true);
      await finishSync(await syncSimpleFin());
    } catch (error) {
      await refreshState();
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await finishSync(await syncSimpleFin());
    } catch (error) {
      await refreshState();
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = () => {
    forgetSimpleFinConnection();
    setConnected(false);
    setMessage({ kind: 'success', text: '已断开连接；本地账户、交易和分类仍保留' });
  };

  return (
    <section
      className="overflow-hidden mb-4"
      style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}
    >
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div
          className="shrink-0 flex items-center justify-center"
          style={{ width: 36, height: 36, borderRadius: R.small, background: HUE.teal.tint, color: HUE.teal.ink }}
        >
          <PlugsConnected size={19} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium" style={{ color: F.textPrimary }}>美国账户自动同步</div>
          <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: F.textTertiary }}>
            SimpleFIN 只读取余额和交易；SullyEM 保留你的多层分类与备注
          </div>
        </div>
        {connected && <CheckCircle size={19} weight="fill" style={{ color: STATUS.success.main }} />}
      </div>

      {connected ? (
        <div className="px-4 pb-4">
          <div className="px-3 py-3" style={{ background: F.surfaceSunken, borderRadius: R.medium, boxShadow: S.sunken }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium" style={{ color: F.textPrimary }}>已连接 SimpleFIN</div>
                <div className="text-[11px] mt-1" style={{ color: F.textTertiary }}>
                  {formatSyncTime(syncState.lastSuccessAt)}
                  {syncState.accountCount != null ? ` · ${syncState.accountCount} 个账户` : ''}
                </div>
              </div>
              <button
                onClick={handleSync}
                disabled={busy}
                title="立即同步"
                className="shrink-0 flex items-center justify-center active:translate-y-[1px] disabled:opacity-50"
                style={{ width: 38, height: 38, borderRadius: R.pill, background: F.surfaceRaised, boxShadow: S.raisedSoft, color: HUE.teal.ink }}
              >
                <ArrowsClockwise size={18} weight="bold" className={busy ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="mt-3 text-xs font-medium disabled:opacity-50"
            style={{ color: STATUS.danger.main }}
          >
            断开连接
          </button>
        </div>
      ) : (
        <div className="px-4 pb-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="text-[11px]" style={{ color: F.textSecondary }}>SimpleFIN Setup Token</label>
            <a
              href="https://bridge.simplefin.org/simplefin/create"
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1 text-[11px] font-medium"
              style={{ color: HUE.teal.ink }}
            >
              获取 Token
              <ArrowSquareOut size={12} weight="bold" />
            </a>
          </div>
          <textarea
            value={setupToken}
            onChange={event => setSetupToken(event.target.value)}
            placeholder="粘贴一次性 Setup Token"
            rows={3}
            spellCheck={false}
            className="w-full resize-none px-3 py-2.5 text-xs outline-none"
            style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken, color: F.textPrimary }}
          />
          <button
            onClick={handleConnect}
            disabled={!setupToken.trim() || busy}
            className="mt-3 w-full py-2.5 flex items-center justify-center gap-2 text-sm font-medium active:translate-y-[1px] disabled:opacity-40"
            style={{
              background: HUE.teal.main,
              borderRadius: R.button,
              boxShadow: S.raisedSoft,
              color: F.surfaceRaised,
              transition: `all ${MOTION.tap} ${MOTION.ease}`,
            }}
          >
            {busy ? <ArrowsClockwise size={17} weight="bold" className="animate-spin" /> : <LinkSimple size={17} weight="bold" />}
            {busy ? '正在连接' : '连接并同步'}
          </button>
        </div>
      )}

      {(message || syncState.lastError) && (
        <div
          className="mx-4 mb-4 px-3 py-2.5 flex items-start gap-2 text-[11px] leading-relaxed"
          style={{
            borderRadius: R.medium,
            background: message?.kind === 'success' ? STATUS.success.tint : STATUS.warning.tint,
            color: message?.kind === 'success' ? STATUS.success.ink : STATUS.warning.ink,
          }}
        >
          {message?.kind === 'success'
            ? <CheckCircle size={15} weight="fill" className="shrink-0 mt-0.5" />
            : <WarningCircle size={15} weight="fill" className="shrink-0 mt-0.5" />}
          <span>{message?.text || syncState.lastError}</span>
        </div>
      )}
    </section>
  );
};
