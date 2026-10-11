import { beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
  buildHealthChatSystemBlock,
  executeHealthChatTool,
  HEALTH_CHAT_TOOL_NAME,
  HEALTH_CHAT_TOOLS,
  isHealthChatToolAvailable,
  shouldEnableHealthTools,
} from './healthChatTools';
import { saveExternalHealthDailySummary, type ExternalHealthSnapshot } from './externalHealth';
import { addLocalDays, getLocalDateKey } from './localDate';
import { saveMcpServers, type McpServerConfig } from './mcpClient';

const user = (content: string): Message => ({ role: 'user', content } as Message);

const haServer = (charIds?: string[]): McpServerConfig => ({
  id: 'ha',
  name: 'Home Assistant',
  url: 'http://192.168.64.2/api/mcp/assist',
  enabled: true,
  tools: [{ name: 'HassTurnOn' }],
  charIds,
  updatedAt: Date.now(),
});

const daily = (date: string): ExternalHealthSnapshot => ({
  source: 'healthsync-home-assistant',
  fetchedAt: `${date}T18:00:00.000Z`,
  updatedAt: `${date}T17:55:00.000Z`,
  summaryDate: date,
  summaryKind: 'daily',
  stepsToday: 6789,
  sleepHoursLastNight: 7.25,
  latestHeartRate: 73,
  hrvMs: 44,
  bloodOxygenPercent: 91,
  bodyFatPercent: 0,
  heightMeters: 1.7,
});

describe('Apple Health chat tool', () => {
  beforeEach(() => localStorage.clear());

  it('opens only for current health semantics, including natural sleep context', () => {
    expect(shouldEnableHealthTools([user('我今天走了多少步')])).toBe(true);
    expect(shouldEnableHealthTools([user('我昨晚睡得不太好')])).toBe(true);
    expect(shouldEnableHealthTools([user('最近 HRV 趋势怎么样')])).toBe(true);
    expect(shouldEnableHealthTools([user('我买了一个体重秤')])).toBe(false);
    expect(shouldEnableHealthTools([user('今天想买个 Apple Watch')])).toBe(false);
    expect(shouldEnableHealthTools([user('你今天过得怎么样')])).toBe(false);
  });

  it('reuses the HA MCP role binding as the health permission boundary', () => {
    saveMcpServers([haServer(['char_allowed'])]);
    saveExternalHealthDailySummary(daily(addLocalDays(getLocalDateKey(), -1)));
    expect(isHealthChatToolAvailable('char_allowed')).toBe(true);
    expect(isHealthChatToolAvailable('char_blocked')).toBe(false);
  });

  it('returns cached detail with freshness, but never exposes oxygen, height, or body-fat noise', async () => {
    const date = addLocalDays(getLocalDateKey(), -1);
    saveMcpServers([haServer(['char_allowed'])]);
    saveExternalHealthDailySummary(daily(date));

    const result = await executeHealthChatTool(HEALTH_CHAT_TOOL_NAME, {
      period: 'yesterday',
      categories: ['heart', 'body'],
    }, 'char_allowed');
    const serialized = JSON.stringify(result).toLowerCase();

    expect(result).toMatchObject({
      success: true,
      source: 'cache',
      coverage_days: 1,
      missing_dates: [],
    });
    expect(serialized).not.toContain('oxygen');
    expect(serialized).not.toContain('血氧');
    expect(serialized).not.toContain('height');
    expect(serialized).not.toContain('body_fat');
    expect(serialized).toContain('hrv_ms');
  });

  it('does not advertise oxygen in the callable schema and reminds the role not to diagnose', () => {
    expect(JSON.stringify(HEALTH_CHAT_TOOLS).toLowerCase()).not.toContain('oxygen');
    expect(buildHealthChatSystemBlock()).toContain('不是医疗诊断工具');
  });
});
