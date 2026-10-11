// [EM-START: agent-plans]
import { describe, expect, it } from 'vitest';

import type { AgentPlan } from './emAgentBackend';
import { buildPlansChatInjection, upcomingPlansFor } from './emAgentPlans';

const NOW = Date.parse('2026-09-23T20:00:00.000Z');
const DAY = 24 * 3600_000;
const plan = (overrides: Partial<AgentPlan>): AgentPlan => ({
    id: 'p', charId: 'lumi', title: '和林越去看展', summary: '约在周六下午', status: 'open',
    dueAt: new Date(NOW + 3 * DAY).toISOString(), ...overrides,
});

describe('聊天里的约定', () => {
    const plans = [
        plan({ id: 'a' }),
        plan({ id: 'b', title: '和表姐吃饭', summary: '', dueAt: new Date(NOW + DAY).toISOString() }),
        plan({ id: 'c', title: '已经去过的', dueAt: new Date(NOW - DAY).toISOString() }),
        plan({ id: 'd', title: '别人的约', charId: 'other' }),
        plan({ id: 'e', title: '太远的', dueAt: new Date(NOW + 30 * DAY).toISOString() }),
        plan({ id: 'f', title: '收掉了的', status: 'done' }),
    ];

    it('只说这个角色两周内还没到的，按时间排', () => {
        expect(upcomingPlansFor(plans, 'lumi', NOW).map(p => p.id)).toEqual(['b', 'a']);
    });

    it('写明是 TA 跟别人约的、按角色时区报时间', () => {
        const text = buildPlansChatInjection('lumi', { now: NOW, timeZone: 'America/Chicago', plans });
        expect(text).toContain('你跟别人约好的事');
        expect(text).toContain('和林越去看展（约在周六下午）');
        expect(text).toMatch(/9\/26.*周六.*下午3:00：和林越去看展/);
        expect(text).toContain('别说成是跟对方约的');
    });

    it('没有就不加这一段', () => {
        expect(buildPlansChatInjection('nobody', { now: NOW, plans })).toBe('');
    });
});
// [EM-END: agent-plans]
