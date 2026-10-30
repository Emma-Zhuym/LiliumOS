// [EM-START: agent-plans]
/**
 * 角色们的约定：心跳里 TA 跟亲友约下的事（「周六下午和林越去看展」），到点那一跳去做。
 *
 * 约定原来只在后端：聊天里的 TA 不知道自己约了什么，问「周末干嘛」只能现编；阿萌也看不到。
 * 这里在打开 App / 回到前台时拉一份存进 localStorage（mini 休眠时照样显示上次的），
 * 聊天读它告诉 TA 自己约了什么，日历 App 读它摆在对应那天。
 *
 * 2026-10-29 起聊天里也能约、能取消（`[[PLAN_ADD]]` / `[[PLAN_CANCEL]]`，见 executePlanDirectives）：
 * 约定只有一份，在 mini 上，跟心跳里约的是同一张表；mini 不在线时排队，下次拉约定前先送掉。
 */

import { AgentBackend, AgentBackendError, isAgentPaired, type AgentPlan } from './emAgentBackend';

const CACHE_KEY = 'em_agent_plans_v1';
/** 接在 mini 上的角色（mini 上没登记的角色约不了，提示词也就不教）。 */
const CHARS_KEY = 'em_agent_plan_chars_v1';
/** 聊天里约下 / 取消、还没送到 mini 的。 */
const QUEUE_KEY = 'em_agent_plan_ops_v1';
/** 聊天里只说两周内还没到的：再远的，TA 自己也不会老挂在嘴边。 */
export const PLANS_CHAT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const PLANS_CHAT_MAX = 5;
/** 给模型看的编号：前 8 位，跟心跳里一样（整条 uuid 模型抄不对）。 */
export const PLAN_SHORT_ID_LENGTH = 8;
/** 一条消息最多认几个约定标签：模型偶尔会把整张清单抄一遍。 */
const MAX_OPS_PER_MESSAGE = 3;
/** 排队超过三天就不送了：mini 那边也只认三天内说的「明天下午」。 */
const QUEUE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const QUEUE_MAX = 20;

const readJson = <T,>(key: string, fallback: T): T => {
    if (typeof localStorage === 'undefined') return fallback;
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : fallback;
    } catch {
        return fallback;
    }
};

const writeJson = (key: string, value: unknown) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // 存不下就算了，下次再拉
    }
};

export const loadPlansCache = (): AgentPlan[] => {
    const parsed = readJson<unknown>(CACHE_KEY, []);
    return Array.isArray(parsed) ? parsed.filter(p => p && typeof p.dueAt === 'string' && typeof p.charId === 'string') : [];
};

const savePlansCache = (plans: AgentPlan[]) => writeJson(CACHE_KEY, plans);

/** 这个角色接没接在 mini 上（上次拉到的名单）。没拉到过就当没接：不教 TA 约，免得约了送不出去。 */
export const canEditPlans = (charId: string): boolean => {
    if (!isAgentPaired()) return false;
    const ids = readJson<unknown>(CHARS_KEY, []);
    return Array.isArray(ids) && ids.includes(charId);
};

/** 拉一份新的。静默失败：mini 不在线就用上次那份。返回最新的列表。 */
export const refreshPlansCache = async (): Promise<AgentPlan[]> => {
    if (!isAgentPaired()) return loadPlansCache();
    // [EM: agent-plans-chat] 先把聊天里排着的送掉，拉回来的才是改过之后的样子
    await flushPlanOps();
    try {
        const [plans, characters] = await Promise.all([AgentBackend.plans(), AgentBackend.characters()]);
        savePlansCache(plans);
        writeJson(CHARS_KEY, characters.map(c => c.charId)); // [EM: agent-plans-chat]
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

/** 聊天提示词用。时间按角色时区写（跟心跳里一致）。canEdit 时带编号、教 TA 怎么约和取消。 */
export const buildPlansChatInjection = (
    charId: string,
    { now = Date.now(), timeZone, plans = loadPlansCache(), canEdit = canEditPlans(charId), userName = '对方' }:
        { now?: number; timeZone?: string; plans?: AgentPlan[]; canEdit?: boolean; userName?: string } = {},
): string => {
    const upcoming = upcomingPlansFor(plans, charId, now);
    if (!upcoming.length && !canEdit) return '';
    let s = '\n### 你跟别人约好的事\n';
    if (upcoming.length) {
        s += '这些是你自己在生活里跟朋友、家人约下的，还没到时间（对方不一定知道，除非你说过）。'
            + '聊到之后的安排时照这个说，别另编，也别说成是跟对方约的。\n'
            + upcoming.map(p => `- ${planTime(p.dueAt, timeZone)}：${p.title}${p.summary ? `（${p.summary}）` : ''}`
                + (canEdit ? `（编号：${p.id.slice(0, PLAN_SHORT_ID_LENGTH)}）` : '')).join('\n')
            + '\n';
    } else {
        s += '眼下你没有跟别人约好、还没到的事。\n';
    }
    // [EM-START: agent-plans-chat]
    if (canEdit) {
        s += `聊着聊着你自己定下了以后要做的事（两周以内，跟谁、做什么），单独起一行写 \`[[PLAN_ADD: 做什么，带上跟谁 | 什么时候]]\`，`
            + '时间用平常说话的说法（「周六下午」「明晚八点」「10月31日下午三点」），不要写年份或日期格式。'
            + `改主意了、去不了了，写 \`[[PLAN_CANCEL: 编号]]\`；改时间就是先取消、再重新约。`
            + `只记你自己真定下的事：随口说说、还没定的不记；${userName}自己的安排、你们俩之间的约会不记在这里。`
            + '标签不会显示出来，写了不用跟 ta 解释。\n';
    }
    // [EM-END: agent-plans-chat]
    return s;
};

// [EM-START: agent-plans-chat]
type PlanOp =
    | { kind: 'add'; charId: string; charName: string; what: string; at: string; saidAt: number }
    | { kind: 'cancel'; charId: string; charName: string; id: string; title: string; saidAt: number };

type Toast = (msg: string, type: 'info' | 'success' | 'error') => void;

const PLAN_TAG_RE = /\[\[\s*PLAN_(ADD|CANCEL)\s*[:：]\s*([\s\S]*?)\]\]/g;

/** 从一条回复里认出约定标签（最多三个）。认不全的整条丢掉。 */
export const parsePlanDirectives = (
    content: string, charId: string, charName: string, { plans = loadPlansCache(), now = Date.now() } = {},
): { content: string; ops: PlanOp[] } => {
    const ops: PlanOp[] = [];
    for (const [, verb, rawArgs] of content.matchAll(PLAN_TAG_RE)) {
        if (ops.length >= MAX_OPS_PER_MESSAGE) break;
        const args = rawArgs.split(/[|｜]/).map(part => part.trim());
        if (verb === 'ADD') {
            const [what, at] = args;
            if (what && at) ops.push({ kind: 'add', charId, charName, what: what.slice(0, 40), at: at.slice(0, 40), saidAt: now });
            continue;
        }
        const shortId = (args[0] || '').replace(/^编号[:：]?\s*/, '');
        if (shortId.length < 4) continue;
        const known = plans.find(p => p.charId === charId && p.status === 'open' && p.id.startsWith(shortId));
        ops.push({ kind: 'cancel', charId, charName, id: known?.id ?? shortId, title: known?.title ?? '', saidAt: now });
    }
    return { content: content.replace(PLAN_TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim(), ops };
};

const readQueue = (now: number): PlanOp[] => {
    const parsed = readJson<unknown>(QUEUE_KEY, []);
    return Array.isArray(parsed) ? parsed.filter((op: PlanOp) => op && typeof op.charId === 'string' && now - op.saidAt < QUEUE_TTL_MS) : [];
};

const writeQueue = (queue: PlanOp[]) => writeJson(QUEUE_KEY, queue.slice(-QUEUE_MAX));

/** mini 回了「这条不收」（时间认不出、角色没接上）：重送也没用，丢掉。连不上 / 超时才留着。 */
const isPermanent = (error: unknown) => error instanceof AgentBackendError && error.status >= 400 && error.status < 500;

const sendOp = async (op: PlanOp, toast?: Toast): Promise<boolean> => {
    try {
        if (op.kind === 'add') {
            const plan = await AgentBackend.addPlan({ charId: op.charId, what: op.what, at: op.at, saidAt: new Date(op.saidAt).toISOString() });
            savePlansCache([...loadPlansCache().filter(p => p.id !== plan.id), { ...plan, charId: op.charId }]);
            toast?.(`${op.charName} 记下了：${plan.title}（${planTime(plan.dueAt)}）`, 'success');
        } else {
            const cancelled = await AgentBackend.cancelPlan(op.charId, op.id);
            if (cancelled) {
                savePlansCache(loadPlansCache().filter(p => p.id !== cancelled.id));
                toast?.(`${op.charName} 取消了：${cancelled.title}`, 'info');
            }
        }
        return true;
    } catch (error) {
        if (!isPermanent(error)) return false;
        if (op.kind === 'add') toast?.(`${op.charName} 想约「${op.what}」，但没认出时间「${op.at}」，没记上`, 'info');
        return true;
    }
};

/** 一次只跑一趟：聊天里刚排上的和打开 App 时的补送挨着来，同一条不送两遍。 */
let flushing: Promise<void> = Promise.resolve();

export const flushPlanOps = (toast?: Toast, now = Date.now()): Promise<void> => {
    flushing = flushing.then(async () => {
        if (!isAgentPaired()) return;
        const left: PlanOp[] = [];
        for (const op of readQueue(now)) {
            if (!await sendOp(op, toast)) left.push(op);
        }
        writeQueue(left);
    }).catch(error => console.warn('📅 [Plans] 约定没送出去', error));
    return flushing;
};

/**
 * chatParser 调：剥掉约定标签、排进队列、送去 mini。不等它送完——mini 不在线时请求要等十几秒，
 * 不能卡住气泡上屏。取消的先从本机副本里拿掉，下一轮提示词就不再列它。
 */
export const executePlanDirectives = (content: string, charId: string, charName: string, toast?: Toast): string => {
    const { content: rest, ops } = parsePlanDirectives(content, charId, charName);
    if (!ops.length || !isAgentPaired()) return rest;
    const cancelIds = new Set(ops.filter(op => op.kind === 'cancel').map(op => op.id));
    if (cancelIds.size) savePlansCache(loadPlansCache().filter(p => !cancelIds.has(p.id)));
    writeQueue([...readQueue(Date.now()), ...ops]);
    void flushPlanOps(toast).then(() => {
        if (readQueue(Date.now()).some(op => op.charId === charId)) toast?.(`mini 暂时连不上，${charName} 的约定先记在手机上，连上再送`, 'info');
    });
    return rest;
};
// [EM-END: agent-plans-chat]
// [EM-END: agent-plans]
