import { describe, expect, it } from 'vitest';
import {
  AMSG_HEARTBEAT_NOOP,
  buildHeartbeatControl,
  buildHeartbeatTaskInstruction,
  heartbeatJitterWindowMinutes,
  heartbeatTaskUuid,
  nextHeartbeatTimeMs,
  normalizeHeartbeatActiveChatPolicy,
  normalizeHeartbeatInterval,
  parseHeartbeatControl,
  stripHeartbeatNoop,
} from './amsgHeartbeat';

describe('amsgHeartbeat', () => {
  it('只接受界面支持的频率，其余值回到一小时', () => {
    expect(normalizeHeartbeatInterval(30)).toBe(30);
    expect(normalizeHeartbeatInterval(240)).toBe(240);
    expect(normalizeHeartbeatInterval(45)).toBe(60);
    expect(normalizeHeartbeatInterval(undefined)).toBe(60);
  });

  it('Cron 晚到时直接滚到未来，不补跑一串过期心跳', () => {
    const occurrence = Date.parse('2026-08-18T10:00:00.000Z');
    const now = Date.parse('2026-08-18T13:20:00.000Z');
    const next = nextHeartbeatTimeMs(occurrence, now, 60, 'char-a:generation-1');
    expect(next).toBeGreaterThanOrEqual(now + 60_000);
    expect(next).toBeGreaterThanOrEqual(Date.parse('2026-08-18T13:54:00.000Z'));
    expect(next).toBeLessThanOrEqual(Date.parse('2026-08-18T14:06:00.000Z'));
  });

  it('各档频率按约 10% 波动，并限制在 5 到 20 分钟', () => {
    expect(heartbeatJitterWindowMinutes(30)).toBe(5);
    expect(heartbeatJitterWindowMinutes(60)).toBe(6);
    expect(heartbeatJitterWindowMinutes(120)).toBe(12);
    expect(heartbeatJitterWindowMinutes(240)).toBe(20);
  });

  it('时间波动像随机但可复算：同一次重试不分叉，连续几跳又不会机械等距', () => {
    const seed = 'char-a:generation-1';
    const start = Date.parse('2026-08-18T10:00:00.000Z');
    const first = nextHeartbeatTimeMs(start, start, 60, seed);
    expect(nextHeartbeatTimeMs(start, start, 60, seed)).toBe(first);
    expect(first - start).toBeGreaterThanOrEqual(54 * 60_000);
    expect(first - start).toBeLessThanOrEqual(66 * 60_000);

    const gaps: number[] = [];
    let current = start;
    for (let i = 0; i < 12; i += 1) {
      const next = nextHeartbeatTimeMs(current, current, 60, seed);
      gaps.push((next - current) / 60_000);
      current = next;
    }
    expect(new Set(gaps).size).toBeGreaterThan(1);
    expect(gaps.every((minutes) => minutes >= 54 && minutes <= 66)).toBe(true);
  });

  it('下一跳 uuid 对同一角色与时刻幂等', () => {
    const at = 1_776_500_000_000;
    expect(heartbeatTaskUuid('char-a', at)).toBe(heartbeatTaskUuid('char-a', at));
    expect(heartbeatTaskUuid('char-a', at)).not.toBe(heartbeatTaskUuid('char-b', at));
    expect(heartbeatTaskUuid('char-a', at)).not.toBe(heartbeatTaskUuid('char-a', at + 60_000));
  });

  it('安静标记会被完整剥掉，普通正文保留', () => {
    expect(stripHeartbeatNoop(AMSG_HEARTBEAT_NOOP)).toBe('');
    expect(stripHeartbeatNoop(`想起你了\n${AMSG_HEARTBEAT_NOOP}`)).toBe('想起你了');
  });

  it('任务指令把主动与安静两条路都说清楚', () => {
    const prompt = buildHeartbeatTaskInstruction(120);
    expect(prompt).toContain('每 120 分钟');
    expect(prompt).toContain(AMSG_HEARTBEAT_NOOP);
    expect(prompt).toContain('不要提“心跳”');
  });

  it('热聊自然融入只在本次指令里追加约束，默认指令不假装用户正在聊天', () => {
    const normal = buildHeartbeatTaskInstruction(60);
    const merging = buildHeartbeatTaskInstruction(60, { activeChat: true });
    expect(normal).not.toContain('【正在聊天时的处理】');
    expect(merging).toContain('【正在聊天时的处理】');
    expect(merging).toContain('顺着当前话题');
    expect(merging).toContain(AMSG_HEARTBEAT_NOOP);
  });

  it('旧配置和非法值都默认跳过热聊，只有 merge 会自然融入', () => {
    expect(normalizeHeartbeatActiveChatPolicy(undefined)).toBe('skip');
    expect(normalizeHeartbeatActiveChatPolicy('force')).toBe('skip');
    expect(normalizeHeartbeatActiveChatPolicy('merge')).toBe('merge');
  });

  it('控制行严格校验代次并统一频率', () => {
    const value = JSON.stringify(buildHeartbeatControl({
      enabled: true,
      intervalMinutes: 30,
      activeChatPolicy: 'merge',
      generation: 'generation-1',
      updatedAt: 123,
    }));
    expect(parseHeartbeatControl(value)).toEqual({
      v: 1,
      enabled: true,
      intervalMinutes: 30,
      activeChatPolicy: 'merge',
      generation: 'generation-1',
      updatedAt: 123,
    });
    expect(parseHeartbeatControl('{bad')).toBeNull();
    expect(parseHeartbeatControl(JSON.stringify({ v: 1, enabled: true }))).toBeNull();
    expect(parseHeartbeatControl(JSON.stringify({
      v: 1, enabled: true, intervalMinutes: 60, generation: 'old', updatedAt: 1,
    }))?.activeChatPolicy).toBe('skip');
  });
});
