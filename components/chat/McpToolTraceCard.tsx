import React, { useState } from 'react';
import { CaretDown, CheckCircle, Clock, PlugsConnected, WarningCircle } from '@phosphor-icons/react';
import { F, MOTION, R, S, STATUS } from '../../utils/clayTokens';
import type { McpToolCallRecord, McpToolTraceRecord } from '../../utils/mcpToolTraceRecord';

const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
};

const durationLabel = (durationMs: number): string => {
  if (!Number.isFinite(durationMs) || durationMs < 1_000) return `${Math.max(0, Math.round(durationMs || 0))} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
};

const RecordDetail: React.FC<{ record: McpToolCallRecord }> = ({ record }) => {
  const success = record.status === 'success';
  return (
    <li style={{ borderTop: `1px solid ${F.divider}`, padding: '12px 0' }}>
      <div className="flex items-start gap-2.5">
        {success
          ? <CheckCircle size={17} weight="fill" color={STATUS.success.main} className="mt-0.5 shrink-0" />
          : <WarningCircle size={17} weight="fill" color={STATUS.danger.main} className="mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold" style={{ color: F.textPrimary }}>{record.exposedName}</div>
              <div className="truncate text-[10px]" style={{ color: F.textTertiary }}>
                {record.serverName}{record.toolName !== record.exposedName ? ` · ${record.toolName}` : ''}
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px]" style={{ color: F.textTertiary }}>
              <Clock size={11} />{durationLabel(record.durationMs)}
            </span>
          </div>

          <div className="mt-2 space-y-2">
            <section>
              <div className="mb-1 text-[10px] font-medium" style={{ color: F.textSecondary }}>发送参数</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all p-2 text-[10px] leading-[1.55]"
                style={{ borderRadius: R.small, background: F.surfaceSunken, color: F.textSecondary, boxShadow: S.sunken }}>
                {formatValue(record.arguments)}
              </pre>
            </section>
            <section>
              <div className="mb-1 text-[10px] font-medium" style={{ color: success ? STATUS.success.ink : STATUS.danger.ink }}>
                {success ? '返回结果' : '失败原因'}
              </div>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all p-2 text-[10px] leading-[1.55]"
                style={{ borderRadius: R.small, background: success ? STATUS.success.tint : STATUS.danger.tint, color: success ? STATUS.success.ink : STATUS.danger.ink }}>
                {success ? formatValue(record.result) : record.error}
              </pre>
            </section>
            {record.source === 'text_fallback' && (
              <p className="text-[10px] leading-relaxed" style={{ color: F.textTertiary }}>
                这次是从角色写进正文的调用格式中识别并代为执行的。
              </p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
};

const McpToolTraceCard: React.FC<{ trace: McpToolTraceRecord }> = ({ trace }) => {
  const [expanded, setExpanded] = useState(false);
  const failed = trace.records.filter(record => record.status === 'error').length;
  const summary = trace.records.slice(0, 2).map(record => record.exposedName).join(' · ');
  const extra = trace.records.length > 2 ? ` 等 ${trace.records.length} 次` : '';
  const panelId = `mcp-trace-${trace.runId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div
      className="overflow-hidden"
      style={{ borderRadius: R.bigCard, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:opacity-75"
        style={{ transition: `opacity ${MOTION.tap} ${MOTION.ease}` }}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(value => !value);
        }}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center" style={{ borderRadius: R.small, background: failed ? STATUS.danger.tint : STATUS.info.tint }}>
          <PlugsConnected size={15} weight="bold" color={failed ? STATUS.danger.main : STATUS.info.main} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold" style={{ color: F.textSecondary }}>
            MCP 调用{failed ? ` · ${failed} 次失败` : ` · ${trace.records.length} 次完成`}
          </span>
          <span className="block truncate text-[10px]" style={{ color: F.textTertiary }}>{summary}{extra}</span>
        </span>
        <CaretDown
          size={15}
          color={F.textTertiary}
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: `transform ${MOTION.card} ${MOTION.ease}` }}
        />
      </button>

      {expanded && (
        <div id={panelId} className="px-3 pb-1" style={{ background: F.surfaceWarm }}>
          <ol className="m-0 list-none p-0">
            {trace.records.map(record => <RecordDetail key={record.id} record={record} />)}
          </ol>
          <p className="pb-2 text-[9px] leading-relaxed" style={{ color: F.textTertiary }}>
            鉴权信息和常见敏感字段已隐藏；过长内容只保留预览。
          </p>
        </div>
      )}
    </div>
  );
};

export default McpToolTraceCard;
