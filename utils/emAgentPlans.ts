// [EM-START: agent-plans]
/**
 * 角色们的约定：心跳里 TA 跟亲友约下的事（「周六下午和林越去看展」），到点那一跳去做。
 *
 * 约定原来只在后端：聊天里的 TA 不知道自己约了什么，问「周末干嘛」只能现编；阿萌也看不到。
 * 这里在打开 App / 回到前台时拉一份存进 localStorage（mini 休眠时照样显示上次的），
 * 聊天读它告诉 TA 自己约了什么，日历 App 读它摆在对应那天。
 */

import { AgentBackend, isAgentPaired, type AgentPlan } from './emAgentBackend';

const CACHE_KEY = 'em_agent_plans_v1';
/** 聊天里只说两周内还没到的：再远的，TA 自己也不会老挂在嘴边。 */
export const PLANS_CHAT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const PLANS_CHAT_MAX = 5;

export const loadPlansCache = (): AgentPlan[] => {
    if (typeof localStorage === 'undefined') return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(p => p && typeof p.dueAt === 'string' && typeof p.charId === 'string') : [];
    } catch {
        return [];
    }
};

const savePlansCache = (plans: AgentPlan[]) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(plans));
    } catch {
        // 存不下就算了，下次再拉
    }
};

/** 拉一份新的。静默失败：mini 不在线就用上次那份。返回最新的列表。 */
export const refreshPlansCache = async (): Promise<AgentPlan[]> => {
    if (!isAgentPaired()) return loadPlansCache();
    try {
        const plans = await AgentBackend.plans();
        savePlansCache(plans);
        return plans;
    } catch {
        return loadPlansCache();
    }
};

/** 这个角色两周内还没到的约定，按时间正序。 */
export const upcomingPlansFor = (plans: AgentPlan[], charId: string, now = Date.now()): AgentPlan[] =>
    plans
        .filter(p => p.charId === charId && p.status === 'open')
        .filter(p => {
            const at = Date.parse(p.dueAt);
            return Number.isFinite(at) && at > now && at - now <= PLANS_CHAT_WINDOW_MS;
        })
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
        .slice(0, PLANS_CHAT_MAX);

const planTime = (iso: string, timeZone?: string) => {
    try {
        return new Intl.DateTimeFormat('zh-CN', {
            timeZone, hour12: true, month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit',
        }).format(new Date(iso));
    } catch {
        return new Date(iso).toLocaleString('zh-CN');
    }
};

/** 聊天提示词用。时间按角色时区写（跟心跳里一致）。 */
export const buildPlansChatInjection = (
    charId: string,
    { now = Date.now(), timeZone, plans = loadPlansCache() }: { now?: number; timeZone?: string; plans?: AgentPlan[] } = {},
): string => {
    const upcoming = upcomingPlansFor(plans, charId, now);
    if (!upcoming.length) return '';
    return '\n### 你跟别人约好的事\n'
        + '这些是你自己在生活里跟朋友、家人约下的，还没到时间（对方不一定知道，除非你说过）。'
        + '聊到之后的安排时照这个说，别另编，也别说成是跟对方约的。\n'
        + upcoming.map(p => `- ${planTime(p.dueAt, timeZone)}：${p.title}${p.summary ? `（${p.summary}）` : ''}`).join('\n')
        + '\n';
};
// [EM-END: agent-plans]
