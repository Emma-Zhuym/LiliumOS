import { describe, expect, it } from 'vitest';
import { createMcpToolCallRecord, readMcpToolTraceRecord, sanitizeMcpTraceValue } from './mcpToolTraceRecord';

describe('mcpToolTraceRecord', () => {
  it('redacts credential-shaped fields and bearer values before persistence', () => {
    const sanitized = sanitizeMcpTraceValue({
      apiKey: 'sk-secret',
      nested: { Authorization: 'Bearer abc.def', query: 'https://example.test?a=1&token=hidden-value' },
      safe: 'lamp',
    });
    expect(sanitized).toEqual({
      apiKey: '[已隐藏]',
      nested: { Authorization: '[已隐藏]', query: 'https://example.test?a=1&token=[已隐藏]' },
      safe: 'lamp',
    });
  });

  it('creates a compact success record with timing and sanitized result', () => {
    const record = createMcpToolCallRecord({
      id: 'call-1',
      serverName: 'Home Assistant',
      toolName: 'HassTurnOn',
      exposedName: 'HassTurnOn',
      source: 'native',
      args: { entity_id: 'light.bedside' },
      result: { success: true, data: { ok: true, access_token: 'nope' } },
      startedAt: 100,
      finishedAt: 350,
    });
    expect(record.durationMs).toBe(250);
    expect(record.status).toBe('success');
    expect(record.result).toEqual({ ok: true, access_token: '[已隐藏]' });
  });

  it('rejects malformed trace metadata at render boundary', () => {
    expect(readMcpToolTraceRecord({ version: 1, runId: 'x', records: [] })).toBeNull();
    expect(readMcpToolTraceRecord({ version: 2, runId: 'x', records: [{ id: '1' }] })).toBeNull();
    expect(readMcpToolTraceRecord({
      version: 1,
      runId: 'x',
      records: [{ id: '1', toolName: 'tool', status: 'success' }],
    })).toBeNull();
  });
});
