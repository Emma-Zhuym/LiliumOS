// [EM-START: agent-plans-chat]
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./emAgentBackend', async importOriginal => ({
    ...(await importOriginal<typeof import('./emAgentBackend')>()),
    isAgentPaired: vi.fn(() => true),
    AgentBackend: {
        addPlan: vi.fn(),
        cancelPlan: vi.fn(),
        plans: vi.fn(async () => []),
        characters: vi.fn(async () => [{ charId: 'lumi' }]),
    },
}));

import { AgentBackend, AgentBackendError, type AgentPlan } from './emAgentBackend';
import {
    buildPlansChatInjection, canEditPlans, executePlanDirectives, flushPlanOps, loadPlansCache, parsePlanDirectives, refreshPlansCache,
} from './emAgentPlans';

const NOW = Date.parse('2026-09-23T20:00:00.000Z');
const DAY = 24 * 3600_000;
const plan = (overrides: Partial<AgentPlan>): AgentPlan => ({
    id: 'abcd1234-0000-0000-0000-000000000000', charId: 'lumi', title: '和林越去看展', summary: '约在周六下午', status: 'open',
    dueAt: new Date(NOW + 3 * DAY).toISOString(), ...overrides,
});

const queued = () => JSON.parse(localStorage.getItem('em_agent_plan_ops_v1') || '[]');

describe('聊天里约下 / 取消约定', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.mocked(AgentBackend.addPlan).mockReset();
        vi.mocked(AgentBackend.cancelPlan).mockReset();
    });

    it('接在 mini 上的角色：列表带编号，没有约定也教怎么约和取消', async () => {
        await refreshPlansCache();
        expect(canEditPlans('lumi')).toBe(true);
        expect(canEditPlans('other')).toBe(false);
        const withPlan = buildPlansChatInjection('lumi', { now: NOW, plans: [plan({})], userName: '阿萌' });
        expect(withPlan).toContain('（编号：abcd1234）');
        expect(withPlan).toContain('[[PLAN_CANCEL: 编号]]');
        expect(withPlan).toContain('阿萌自己的安排');
        const empty = buildPlansChatInjection('lumi', { now: NOW, plans: [] });
        expect(empty).toContain('眼下你没有');
        expect(empty).toContain('[[PLAN_ADD:');
        expect(buildPlansChatInjection('other', { now: NOW, plans: [] })).toBe('');
    });

    it('认标签：剥掉、取消按编号对上整条 id，太短的编号和多余的标签不认', () => {
        const plans = [plan({})];
        const { content, ops } = parsePlanDirectives(
            '好，那周六就不去了\n[[PLAN_CANCEL: abcd1234]]\n[[PLAN_ADD：和林越吃饭｜周日中午]]\n[[PLAN_CANCEL: ab]]\n[[PLAN_ADD: 只有事没时间]]',
            'lumi', '露米', { plans, now: NOW },
        );
        expect(content).toBe('好，那周六就不去了');
        expect(ops).toEqual([
            { kind: 'cancel', charId: 'lumi', charName: '露米', id: plans[0].id, title: '和林越去看展', saidAt: NOW },
            { kind: 'add', charId: 'lumi', charName: '露米', what: '和林越吃饭', at: '周日中午', saidAt: NOW },
        ]);
    });

    it('送到了：新约的进本机副本、取消的立刻从副本里拿掉', async () => {
        localStorage.setItem('em_agent_plans_v1', JSON.stringify([plan({})]));
        const added = plan({ id: 'eeee5555-x', title: '和林越吃饭', dueAt: new Date(NOW + 4 * DAY).toISOString() });
        vi.mocked(AgentBackend.addPlan).mockResolvedValue(added);
        vi.mocked(AgentBackend.cancelPlan).mockResolvedValue(plan({}));
        const toast = vi.fn();
        const rest = executePlanDirectives('[[PLAN_CANCEL: abcd1234]][[PLAN_ADD: 和林越吃饭 | 周日中午]]换成周日吃饭', 'lumi', '露米', toast);
        expect(rest).toBe('换成周日吃饭');
        expect(loadPlansCache().map(p => p.id)).toEqual([]);
        await flushPlanOps();
        expect(AgentBackend.cancelPlan).toHaveBeenCalledWith('lumi', plan({}).id);
        expect(AgentBackend.addPlan).toHaveBeenCalledWith(expect.objectContaining({ charId: 'lumi', what: '和林越吃饭', at: '周日中午' }));
        expect(loadPlansCache().map(p => p.id)).toEqual(['eeee5555-x']);
        expect(queued()).toEqual([]);
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('记下了：和林越吃饭'), 'success');
    });

    it('mini 连不上就排着，下次再送；mini 说时间认不出就丢掉', async () => {
        vi.mocked(AgentBackend.addPlan).mockRejectedValue(new AgentBackendError('连不上 Mac mini 后端', 'UNREACHABLE', 0));
        executePlanDirectives('[[PLAN_ADD: 和林越吃饭 | 周日中午]]', 'lumi', '露米');
        await flushPlanOps();
        expect(queued()).toHaveLength(1);

        vi.mocked(AgentBackend.addPlan).mockRejectedValue(new AgentBackendError('认不出时间', 'BAD_PLAN', 400));
        const toast = vi.fn();
        await flushPlanOps(toast);
        expect(queued()).toEqual([]);
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('没认出时间'), 'info');
    });
});
// [EM-END: agent-plans-chat]
