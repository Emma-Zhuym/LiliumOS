// [EM-START: date-plans]
/**
 * 约会：TA 给阿萌安排的约会（生日、周年、「周六带你去看海」）。
 *
 * 起因（阿萌 2026-10-29，生日前一天）：角色们嘴上都说「都给你安排好了」，其实没有地方存，
 * 第二天只能现编；她爱做计划，这样很没安全感。所以答应了就得真写下来：
 * - 聊天里 TA 写 `[[DATE_PLAN: 哪天 几点 | 场合 | 完整安排]]`，存在这台手机上（不靠 mini）
 * - 当天之前阿萌在「约会」App 只看得到哪天、什么场合、写了多少字，内容当天才揭晓（她自己选的）
 * - 每轮聊天提醒 TA 自己安排了什么；当天见面开场照这个来；心跳从快照读到，当天主动找她
 *
 * 跟 emAgentPlans（TA 跟亲友的约定，存在 mini）不是一回事：那边到点 TA 去别处做事，这边是跟她。
 * 日期一律是阿萌这边的日期（她的生日按她的日历过），不按角色时区。
 */

const STORE_KEY = 'em_date_plans_v1';
/** 一份安排最多存多少字：够写一整天的流程，又不至于把提示词撑爆。 */
export const ITINERARY_MAX = 2000;
const TITLE_MAX = 30;
/** 最远能约到多久以后。再远的 TA 自己也记不住细节，聊天提示词也不该一直挂着。 */
const HORIZON_DAYS = 60;
/** 一条消息最多认几个约会标签。 */
const MAX_PER_MESSAGE = 2;

export interface DatePlan {
    id: string;
    charId: string;
    /** 阿萌这边的日期 YYYY-MM-DD */
    date: string;
    /** 开始时间 HH:mm，没说就空 */
    time?: string;
    /** 场合（「你的生日」），阿萌提前看得到 */
    title: string;
    /** 完整安排：当天之前对阿萌藏着 */
    itinerary: string;
    createdAt: number;
    updatedAt: number;
    status: 'planned' | 'cancelled';
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKeyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (key: string) => new Date(`${key}T00:00:00`);

/** 两个日期 key 相差几天（b - a）。 */
export const daysBetween = (a: string, b: string) => Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86_400_000);

// ── 存储 ─────────────────────────────────────────────────────────

const isPlan = (p: any): p is DatePlan => Boolean(p) && typeof p.id === 'string' && typeof p.charId === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && typeof p.itinerary === 'string';

export const loadDatePlans = (): DatePlan[] => {
    if (typeof localStorage === 'undefined') return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(isPlan) : [];
    } catch {
        return [];
    }
};

const listeners = new Set<() => void>();
/** 约会 App 开着时，聊天里 TA 刚写下的要能立刻出现。 */
export const subscribeDatePlans = (fn: () => void) => {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
};

const saveDatePlans = (plans: DatePlan[]) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(plans));
    } catch {
        // 存不下就算了：这里只有文字，正常不会满
    }
    listeners.forEach(fn => fn());
};

/** 完整备份用。 */
export const exportDatePlans = (): DatePlan[] => loadDatePlans();
/** 恢复：按 id 合并，备份里的覆盖本机同 id 的，本机独有的留着。 */
export const importDatePlans = (raw: unknown) => {
    if (!Array.isArray(raw)) return;
    const incoming = raw.filter(isPlan);
    const byId = new Map(loadDatePlans().map(p => [p.id, p]));
    for (const plan of incoming) byId.set(plan.id, plan);
    saveDatePlans([...byId.values()]);
};

/**
 * 记下（或改写）一份安排。同一个角色同一天只有一份：再写一次就是改。
 */
export const upsertDatePlan = (input: { charId: string; date: string; time?: string; title: string; itinerary: string }, now = Date.now()): DatePlan => {
    const plans = loadDatePlans();
    const existing = plans.find(p => p.charId === input.charId && p.date === input.date && p.status === 'planned');
    const plan: DatePlan = {
        id: existing?.id ?? `date-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        charId: input.charId,
        date: input.date,
        ...(input.time ? { time: input.time } : {}),
        title: input.title.slice(0, TITLE_MAX),
        itinerary: input.itinerary.slice(0, ITINERARY_MAX),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        status: 'planned',
    };
    saveDatePlans([...plans.filter(p => p.id !== plan.id), plan]);
    return plan;
};

/** 取消那天的安排（不删：约会 App 里还能看到「取消了」）。返回被取消的那份。 */
export const cancelDatePlan = (charId: string, date: string, now = Date.now()): DatePlan | null => {
    const plans = loadDatePlans();
    const target = plans.find(p => p.charId === charId && p.date === date && p.status === 'planned');
    if (!target) return null;
    const cancelled: DatePlan = { ...target, status: 'cancelled', updatedAt: now };
    saveDatePlans(plans.map(p => (p.id === target.id ? cancelled : p)));
    return cancelled;
};

/** 还作数的：今天及以后、没取消的，按日期正序。 */
export const upcomingDatePlans = (plans: DatePlan[], today: string, charId?: string): DatePlan[] =>
    plans
        .filter(p => p.status === 'planned' && p.date >= today && (!charId || p.charId === charId))
        .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));

/** 当天才揭晓：今天或以后的日子之前，阿萌只看得到外壳。 */
export const isRevealed = (plan: DatePlan, today: string) => plan.date <= today;

// ── 日期 / 时间：模型写说话的说法，这里认常见几种，认不出就不记 ───────────────────

const CN_NUM: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const cnToNumber = (text: string): number => {
    if (!text.includes('十')) return [...text].reduce((n, ch) => n * 10 + (CN_NUM[ch] ?? 0), 0);
    const [tens, ones] = text.split('十');
    return (tens ? CN_NUM[tens] : 1) * 10 + (ones ? CN_NUM[ones] : 0);
};
const normalize = (raw: string) => raw.trim()
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/[零一二两三四五六七八九十]+(?=点|月|日|号)/g, m => String(cnToNumber(m)));
const WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

/** 哪一天 → YYYY-MM-DD（阿萌这边）。认不出、已经过了、太远都返回 null。 */
export const parseDateWord = (raw: string, now = new Date()): string | null => {
    const text = normalize(raw);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const shift = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
    let day: Date | null = null;
    if (/大后天/.test(text)) day = shift(3);
    else if (/后天/.test(text)) day = shift(2);
    else if (/明[天日早晚]/.test(text)) day = shift(1);
    else if (/今[天日早晚]/.test(text)) day = shift(0);
    else {
        const iso = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
        // 「10月30日」「10/30」；不认「-」：19:00-21:00 这种时间段会被当成日期
        const md = text.match(/(\d{1,2})\s*(?:月|\/)\s*(\d{1,2})\s*[日号]?/);
        const week = text.match(/(下下|下|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天])/);
        if (iso) {
            day = new Date(+iso[1], +iso[2] - 1, +iso[3]);
        } else if (week && !md) {
            const weekday = today.getDay() === 0 ? 7 : today.getDay();
            const ahead = week[1] === '下下' ? 2 : week[1] === '下' ? 1 : 0;
            let offset = WEEKDAY[week[2]] - weekday + ahead * 7;
            if (offset < 0 && !week[1]) offset += 7;
            day = shift(offset);
        } else if (md) {
            const month = +md[1];
            const date = +md[2];
            if (month < 1 || month > 12 || date < 1 || date > 31) return null;
            day = new Date(today.getFullYear(), month - 1, date);
            if (day.getMonth() !== month - 1) return null;
            if (day < today) day = new Date(today.getFullYear() + 1, month - 1, date);
        }
    }
    if (!day || Number.isNaN(day.getTime())) return null;
    const ahead = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    if (ahead < 0 || ahead > HORIZON_DAYS) return null;
    return dateKeyOf(day);
};

/** 几点 → HH:mm；没写几点返回 undefined。 */
export const parseTimeWord = (raw: string): string | undefined => {
    const text = normalize(raw);
    const clock = text.match(/(\d{1,2})(?::(\d{2})|点(半)?(?:(\d{1,2})分?)?)/);
    if (!clock) return undefined;
    let hour = +clock[1];
    const minute = clock[2] ? +clock[2] : clock[3] ? 30 : clock[4] ? +clock[4] : 0;
    if (hour > 23 || minute > 59) return undefined;
    if (/下午|傍晚|晚上|今晚|明晚/.test(text) && hour < 12) hour += 12;
    else if (/中午/.test(text) && hour < 6) hour += 12;
    return `${pad(hour)}:${pad(minute)}`;
};

// ── 聊天里的标签 ───────────────────────────────────────────────────

const DATE_TAG_RE = /\[\[\s*DATE_PLAN(?:_(CANCEL))?\s*[:：]\s*([\s\S]*?)\]\]/g;

export type DatePlanOp =
    | { kind: 'save'; date: string; time?: string; title: string; itinerary: string }
    | { kind: 'cancel'; date: string };

/** 认出约会标签并剥掉。认不出日期的、缺内容的整条丢掉。 */
export const parseDatePlanDirectives = (content: string, now = new Date()): { content: string; ops: DatePlanOp[]; rejected: string[] } => {
    const ops: DatePlanOp[] = [];
    const rejected: string[] = [];
    for (const [, cancel, rawArgs] of content.matchAll(DATE_TAG_RE)) {
        if (ops.length >= MAX_PER_MESSAGE) break;
        const parts = rawArgs.split(/[|｜]/);
        const when = (parts[0] || '').trim();
        const date = parseDateWord(when, now);
        if (cancel) {
            if (date) ops.push({ kind: 'cancel', date });
            continue;
        }
        const title = (parts[1] || '').trim();
        // 安排里可能自己带竖线：第二个竖线之后的全算安排
        const itinerary = parts.slice(2).join('|').trim();
        if (!date || !itinerary) {
            rejected.push(when || title);
            continue;
        }
        ops.push({ kind: 'save', date, time: parseTimeWord(when), title: title || '约会', itinerary });
    }
    return { content: content.replace(DATE_TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim(), ops, rejected };
};

type Toast = (msg: string, type: 'info' | 'success' | 'error') => void;

const shortDate = (key: string, time?: string) => {
    const d = fromKey(key);
    return `${d.getMonth() + 1}月${d.getDate()}日${time ? ` ${time}` : ''}`;
};

/** chatParser 调：写进本机、弹一条提示（只说哪天、什么场合，不剧透内容）。 */
export const executeDatePlanDirectives = (content: string, charId: string, charName: string, toast?: Toast): string => {
    const { content: rest, ops, rejected } = parseDatePlanDirectives(content);
    for (const op of ops) {
        if (op.kind === 'save') {
            const plan = upsertDatePlan({ charId, ...op });
            toast?.(`${charName} 把 ${shortDate(plan.date, plan.time)} 的安排写好了：${plan.title}`, 'success');
        } else {
            const cancelled = cancelDatePlan(charId, op.date);
            if (cancelled) toast?.(`${charName} 取消了 ${shortDate(cancelled.date)} 的安排`, 'info');
        }
    }
    if (rejected.length) toast?.(`${charName} 想写约会安排，但没认出日期「${rejected[0]}」，没记上`, 'info');
    return rest;
};

// ── 给 TA 看的 ─────────────────────────────────────────────────────

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const whenText = (plan: DatePlan, today: string) => {
    const d = fromKey(plan.date);
    const gap = daysBetween(today, plan.date);
    const rel = gap === 0 ? '今天' : gap === 1 ? '明天' : gap === 2 ? '后天' : `还有 ${gap} 天`;
    return `${d.getMonth() + 1}月${d.getDate()}日（周${WEEK[d.getDay()]}${plan.time ? ` ${plan.time}` : ''}，${rel}）`;
};

/** 聊天提示词：TA 自己写下的安排（全文）+ 怎么写、怎么改。所有角色都教，不靠 mini。 */
export const buildDatePlansChatInjection = (
    charId: string,
    { userName = '对方', now = new Date(), plans = loadDatePlans() }: { userName?: string; now?: Date; plans?: DatePlan[] } = {},
): string => {
    const today = dateKeyOf(now);
    const mine = upcomingDatePlans(plans, today, charId);
    let s = `\n### 你给${userName}安排的约会\n`;
    if (mine.length) {
        s += `这些是你自己写下、答应给${userName}的安排。${userName}在「约会」App 里看得到你安排了哪天、什么场合、写了多少字，看不到内容，当天才揭晓。\n`;
        for (const plan of mine) {
            s += `- ${whenText(plan, today)} · ${plan.title}：\n${plan.itinerary}\n`;
        }
        s += mine.some(p => p.date === today)
            ? `今天就是那天：照你写下的安排带${userName}过，到哪一步再揭晓哪一步，临时想加的可以加。\n`
            : `还没到的别剧透细节，可以卖关子；${userName}问起时让 ta 安心：你是真的安排好了。\n`;
    }
    s += `答应给${userName}安排约会、说「我都安排好了」之前，先真的写下来：单独起一行 `
        + '`[[DATE_PLAN: 哪天 几点 | 场合 | 完整安排]]`。'
        + '哪天写「10月30日」「明天」「周六」这种，几点可以不写；场合几个字（「你的生日」），ta 提前看得到，别在场合里剧透；'
        + '完整安排写清楚几点去哪、做什么、准备了什么、想对 ta 说的话，可以写长。'
        + '同一天再写一次就是改；取消写 `[[DATE_PLAN_CANCEL: 哪天]]`。标签不会显示出来，写完照常说话就好。\n';
    return s;
};

/** 见面开场 / 见面对话：当天有安排，就照安排来。 */
export const buildDatePlanSceneNote = (charId: string, userName = '对方', now = new Date(), plans = loadDatePlans()): string => {
    const today = dateKeyOf(now);
    const plan = upcomingDatePlans(plans, today, charId).find(p => p.date === today);
    if (!plan) return '';
    return `\n\n[今天的约会]\n今天是你给${userName}安排的约会（${plan.title}${plan.time ? `，${plan.time} 开始` : ''}）。这次见面就照你写下的安排进行，从眼下该到的那一步开始：\n${plan.itinerary}`;
};

/** 接在见面的系统提示词后面（datePrompts 的两个出口各一行）。 */
export const withDatePlanScene = <T extends { role: string; content: any }>(messages: T[], charId: string, userName?: string): T[] => {
    const note = buildDatePlanSceneNote(charId, userName);
    if (!note) return messages;
    const at = messages.findIndex(m => m.role === 'system' && typeof m.content === 'string');
    if (at < 0) return messages;
    return messages.map((m, i) => (i === at ? { ...m, content: `${m.content}${note}` } : m));
};

/** 心跳快照：今天和接下来两天的安排（全文，TA 自己写的，TA 看得到）。 */
export const datePlansForSnapshot = (charId: string, now = new Date(), plans = loadDatePlans()) => {
    const today = dateKeyOf(now);
    return upcomingDatePlans(plans, today, charId)
        .filter(p => daysBetween(today, p.date) <= 2)
        .map(p => ({ date: p.date, ...(p.time ? { time: p.time } : {}), title: p.title, itinerary: p.itinerary.slice(0, 1200) }));
};
// [EM-END: date-plans]
