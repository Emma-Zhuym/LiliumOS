// [EM-START: machine-room]
/**
 * 机房 App（apps/MachineRoomApp.tsx）的纯逻辑：时间怎么写、一跳算哪类、连接那几行怎么排。
 * 不碰网络、不碰 React，单测钉死。
 */

import type { AgentCharacter, AgentModelRun, AgentStatus } from './emAgentBackend';
import { describeRunDeeds, GATE_LABELS } from './emAgentActivity';

const pad = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** 「18:40」「昨天 18:40」「10/18 18:40」：今天的只写钟点，越远写得越全（本机时间）。 */
export const clockText = (iso: string | null | undefined, now = new Date()): string => {
    if (!iso) return '';
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    if (sameDay(at, now)) return clock;
    const yesterday = new Date(now.getTime() - 24 * 3600_000);
    if (sameDay(at, yesterday)) return `昨天 ${clock}`;
    return `${at.getMonth() + 1}/${at.getDate()} ${clock}`;
};

/** 下一跳：「19:30」加上还有多久；已经过了（正在跑或 mini 睡着没跑）就只写「该醒了」。 */
export const nextBeatText = (iso: string | null | undefined, now = new Date()): string => {
    if (!iso) return '';
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return '';
    const minutes = Math.round((at - now.getTime()) / 60_000);
    if (minutes <= 0) return '该醒了';
    if (minutes < 60) return `${clockText(iso, now)} · ${minutes} 分钟后`;
    return `${clockText(iso, now)} · ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后`;
};

export const isToday = (iso: string, now = new Date()) => {
    const at = new Date(iso);
    return !Number.isNaN(at.getTime()) && sameDay(at, now);
};

/** 一跳算哪类，「记录」页的筛选用。 */
export type RunKind = 'message' | 'life' | 'work' | 'quiet' | 'skipped' | 'error';
export const RUN_FILTERS: { id: RunKind | 'all'; label: string }[] = [
    { id: 'all', label: '全部' },
    { id: 'message', label: '发消息' },
    { id: 'life', label: '过日子' },
    { id: 'skipped', label: '跳过' },
    { id: 'error', label: '出错' },
];

export const runKind = (run: AgentModelRun): RunKind => {
    if (!run.ok || run.outcome === 'error') return 'error';
    if (run.outcome === 'skipped') return 'skipped';
    if (run.outcome === 'message') return 'message';
    if (run.episode?.life) return 'life';
    if (run.episode?.channel) return 'work';
    return 'quiet';
};

/** 筛选「过日子」时工作往来也算，什么都没干的那种也算——都是 TA 自己的时间。 */
export const matchesFilter = (run: AgentModelRun, filter: RunKind | 'all') => {
    if (filter === 'all') return true;
    const kind = runKind(run);
    return filter === 'life' ? kind === 'life' || kind === 'work' || kind === 'quiet' : kind === filter;
};

/** 一跳写成一行人话：做了什么，没做就写为什么。 */
export const runSummary = (run: AgentModelRun): string => {
    const kind = runKind(run);
    if (kind === 'error') return run.error ? `出错了：${run.error}` : '出错了';
    if (kind === 'skipped') return run.skipGate ? `没醒：${GATE_LABELS[run.skipGate] ?? run.skipGate}` : '没醒';
    const deeds = describeRunDeeds(run);
    return run.activity || deeds.join(' · ') || '想了想，没说话';
};

/** 「此刻」每个角色那一行：心跳开没开、最近一跳干了什么。 */
export const characterLine = (backend: AgentCharacter | undefined, latest: AgentModelRun | undefined, now = new Date()): string => {
    if (!backend?.credRef) return '还没接到 mini';
    if (backend.heartbeatPaused) return '心跳暂停中';
    if (!backend.heartbeatEnabled) return '心跳关着';
    if (!latest) return '还没醒过';
    return `${clockText(latest.startedAt, now)} ${runSummary(latest)}`;
};

/** 连接页那几行。tone：ok 绿、warn 琥珀、off 灰。 */
// [EM-START: machine-room-reach-reason]
export type ReachFailureKind = 'revoked' | 'timeout' | 'blocked' | 'network-blocked' | 'offline' | 'down' | 'server';
export interface ReachFailure { kind: ReachFailureKind; title: string; sub: string }

/**
 * 机房连不上 mini 时说清楚是哪一种（以前一律「mini 在休息」，阿萌分不出是钥匙、网络还是真休眠）。
 * internetOk：对照探测（本站碰得到吗），只对「碰不到 mini」的两类有用。
 */
export const describeReachFailure = (
    error: { code?: string; status?: number } | null | undefined,
    internetOk: boolean | null = null,
): ReachFailure => {
    const code = error?.code;
    if (error?.status === 401) return { kind: 'revoked', title: '钥匙失效了', sub: '这台手机在 mini 上被作废了，要去「设置 → Mac mini」解绑后重新配对。' };
    if (code === 'BLOCKED') return { kind: 'blocked', title: 'mini 在线，请求被拦了', sub: '多半是跨域（后端没放行这个网页地址）或浏览器扩展拦截。' };
    if (code === 'UNREACHABLE' || code === 'TIMEOUT') {
        if (internetOk === false) return { kind: 'offline', title: '这台手机没网', sub: '先连上网络再试。' };
        if (internetOk === true) {
            return { kind: 'network-blocked', title: '当前网络够不到 mini', sub: '你能上网，但这张网碰不到 mini 的地址（可能是这张网拦了它，或者解析不了它的域名）。换 LTE 能连上就是网络的问题，mini 本身没事。' };
        }
        if (code === 'TIMEOUT') return { kind: 'timeout', title: 'mini 没响应', sub: '请求发出去了但 15 秒没回音，可能 mini 正忙或网络很慢，点右上角刷新再试。' };
        return { kind: 'down', title: 'mini 在休息', sub: '连不上，多半是每天 4–7 点的休眠，或者在重启。' };
    }
    return { kind: 'server', title: 'mini 回了个错', sub: '连得上，但后端报错了，详情看「连接」或 mini 日志。' };
};
// [EM-END: machine-room-reach-reason]

export interface LinkRow { key: string; label: string; tone: 'ok' | 'warn' | 'off'; detail: string }

const XHS_DETAIL: Record<string, string> = {
    logged_in: '登着',
    need_login: '要重新扫码',
    unreachable: '服务没起来',
    checking: '正在查',
    unknown: '查不出来',
};

export const linkRows = (status: AgentStatus | null): LinkRow[] => {
    const deps = status?.deps ?? {};
    const rows: LinkRow[] = [];
    const push = deps.push;
    rows.push({
        key: 'push', label: '推送',
        tone: push?.ok ? 'ok' : 'warn',
        detail: push?.ok ? `${push.activeDevices ?? 0} 台设备能收到` : (push?.detail || '没准备好'),
    });
    rows.push({
        key: 'appleEvents', label: '苹果日历与提醒',
        tone: deps.appleEvents?.ok ? 'ok' : 'warn',
        detail: deps.appleEvents?.ok ? '桥接在线' : '桥接没连上',
    });
    if (deps.xhs) {
        const detail = deps.xhs.detail ?? 'unknown';
        rows.push({
            key: 'xhs', label: '小红书',
            tone: deps.xhs.ok ? 'ok' : detail === 'checking' ? 'off' : 'warn',
            detail: XHS_DETAIL[detail] ?? detail,
        });
    }
    rows.push({
        key: 'homeAssistant', label: 'Home Assistant',
        tone: deps.homeAssistant?.ok ? 'ok' : 'off',
        detail: deps.homeAssistant?.ok ? '在线' : '没连',
    });
    return rows;
};
// [EM-END: machine-room]
