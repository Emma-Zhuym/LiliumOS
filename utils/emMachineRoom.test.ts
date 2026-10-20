import { describe, expect, it } from 'vitest';

import type { AgentCharacter, AgentModelRun, AgentStatus } from './emAgentBackend';
import { characterLine, clockText, linkRows, matchesFilter, nextBeatText, runKind, runSummary } from './emMachineRoom';

const NOW = new Date(2026, 9, 20, 18, 50);
const at = (h: number, m: number, dayOffset = 0) => new Date(2026, 9, 20 + dayOffset, h, m).toISOString();

const run = (patch: Partial<AgentModelRun>): AgentModelRun => ({
    id: 1, charId: 'c', runtime: 'api', startedAt: at(18, 40), durationMs: 1000, ok: true, outcome: 'noop', shadow: false,
    reason: null, activity: null, proposedText: null, skipGate: null, error: null, ...patch,
});

const backend = (patch: Partial<AgentCharacter> = {}): AgentCharacter => ({
    charId: 'c', displayName: '陈照', runtime: 'api', credRef: 'char-c', heartbeatEnabled: true, heartbeatEveryMin: 60,
    heartbeatGeneration: 1, dailyModelBudget: 30, messageCooldownMin: 30, lastUserInteractionAt: null, heartbeatPaused: null,
    updatedAt: at(10, 0), ...patch,
});

describe('机房：时间', () => {
    it('今天只写钟点，昨天写「昨天」，更早写日期', () => {
        expect(clockText(at(18, 40), NOW)).toBe('18:40');
        expect(clockText(at(9, 5, -1), NOW)).toBe('昨天 09:05');
        expect(clockText(at(9, 5, -3), NOW)).toBe('10/17 09:05');
        expect(clockText(null, NOW)).toBe('');
    });

    it('下一跳写钟点和还有多久；过了就是「该醒了」', () => {
        expect(nextBeatText(at(19, 30), NOW)).toBe('19:30 · 40 分钟后');
        expect(nextBeatText(at(20, 55), NOW)).toBe('20:55 · 2 小时 5 分后');
        expect(nextBeatText(at(18, 0), NOW)).toBe('该醒了');
    });
});

describe('机房：一跳算哪类', () => {
    it('发消息、过日子、工作、被跳过、出错分得开；「过日子」筛选把工作和发呆也算进去', () => {
        expect(runKind(run({ outcome: 'message' }))).toBe('message');
        expect(runKind(run({ episode: { life: { kind: 'chat' } } }))).toBe('life');
        expect(runKind(run({ episode: { channel: 'group', with: '美术组' } }))).toBe('work');
        expect(runKind(run({ outcome: 'skipped', skipGate: 'sleeping' }))).toBe('skipped');
        expect(runKind(run({ ok: false, error: '401' }))).toBe('error');
        expect(matchesFilter(run({ episode: { channel: 'dm', with: '老板' } }), 'life')).toBe(true);
        expect(matchesFilter(run({ outcome: 'message' }), 'life')).toBe(false);
    });

    it('一行人话：有 activity 用 activity，跳过写原因，出错写错误', () => {
        expect(runSummary(run({ activity: '在改方案' }))).toBe('在改方案');
        expect(runSummary(run({ outcome: 'skipped', skipGate: 'private_moment' }))).toBe('没醒：两个人的时间');
        expect(runSummary(run({ ok: false, outcome: 'error', error: '模型 401' }))).toBe('出错了：模型 401');
        expect(runSummary(run({ episode: { life: { kind: 'xhs' } } }))).toBe('逛小红书');
    });

    it('「此刻」角色那一行', () => {
        expect(characterLine(undefined, undefined, NOW)).toBe('还没接到 mini');
        expect(characterLine(backend({ heartbeatEnabled: false }), undefined, NOW)).toBe('心跳关着');
        expect(characterLine(backend({ heartbeatPaused: 'manual' }), undefined, NOW)).toBe('心跳暂停中');
        expect(characterLine(backend(), run({ activity: '在改方案' }), NOW)).toBe('18:40 在改方案');
    });
});

describe('机房：连接那几行', () => {
    it('推送、日历、小红书（配了才有）、HA；小红书没登录是琥珀色', () => {
        const status = {
            deps: {
                push: { ok: true, activeDevices: 2 },
                appleEvents: { ok: true },
                homeAssistant: { ok: false },
                xhs: { ok: false, detail: 'need_login' },
            },
        } as unknown as AgentStatus;
        expect(linkRows(status).map(row => [row.key, row.tone, row.detail])).toEqual([
            ['push', 'ok', '2 台设备能收到'],
            ['appleEvents', 'ok', '桥接在线'],
            ['xhs', 'warn', '要重新扫码'],
            ['homeAssistant', 'off', '没连'],
        ]);
        expect(linkRows(null).some(row => row.key === 'xhs')).toBe(false);
    });
});
