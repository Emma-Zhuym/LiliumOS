// [EM-START: char-drives-cue]
/**
 * 契机的来源：每个来源从本机数据里读一小段，做成「闪过的念头」（规格 docs/spec-character-drives.md 3.1）。
 *
 * 每个来源分两半：纯函数（拿数据 → 契机，单测钉死）和读数据（IndexedDB / 本机缓存）。
 * 隐私边界沿用各自的老规矩：
 * - 账本：只认正常计入的支出，转账、待入账、代收代付、手动排除的都不当话头
 * - 冰箱：只读，明说这是她现实里的冰箱（「故事里的饭 ≠ 现实冰箱」）
 * - 日历：只用可见性是「能看到标题」的；「只知道我在忙」的说不出具体的事，不用
 * - 他自己的生活：查手机里心跳写进来的记录（跟谁聊了、点了什么），本来就是他的事
 * 定位、健康不当来源（健康是否接入阿萌还没定，见规格第 9 节）。
 */

import type { CharacterProfile, PhoneEvidence } from '../types';
import {
    clipCueText, CUE_MIN_GAP_MS, driveCueChance, driveWeightedWeights, loadCueState, noteCueRoll, pickCue, recordCuePicked, setPendingCue, shouldRollCue, type Cue,
} from './emCuePool';
import { fetchDriveSummary, readDriveSummaryCache } from './emDriveSummary';
import type { FinanceHeartbeatContext } from './financeChatTools';
import type { TemporalItem, TemporalVisibility } from './emAgentBackend';

const DAY = 24 * 60 * 60 * 1000;
const EXCLUDED_TREATMENTS = new Set(['代收代付', '其他排除']);

const money = (amount: number, currency: string) => `${Number(amount).toFixed(2).replace(/\.00$/, '')} ${currency}`;

// ── 账本 ───────────────────────────────────────────────────────
export const financeCue = (ctx: FinanceHeartbeatContext | null, userName: string): Cue | null => {
    if (!ctx) return null;
    const spend = ctx.recent.find(t => t.type === 'expense' && !t.pending && t.merchant && !EXCLUDED_TREATMENTS.has(t.analysisTreatment));
    if (!spend) return null;
    const totals = ctx.totals.filter(t => t.amount > 0).map(t => money(t.amount, t.currency)).join('、');
    return {
        source: 'finance',
        dedupeKey: `finance:${spend.date}:${spend.merchant}:${spend.amount}`,
        text: clipCueText(`${userName}账本上最近一笔是在「${spend.merchant}」花了 ${money(spend.amount, spend.currency)}`
            + `${totals ? `，这 ${ctx.windowDays} 天一共花了 ${totals}` : ''}（她现实里的账本）`),
        toolGroup: 'finance',
    };
};

// ── 冰箱 ───────────────────────────────────────────────────────
export interface KitchenLotLike {
    id: string;
    foodId: string;
    quantity: number;
    storageZone: string;
    foodState: string;
    expiresAt?: string;
    createdAt: number;
}

const dayWord = (days: number) => (days <= 0 ? '今天' : days === 1 ? '明天' : days === 2 ? '后天' : `${days} 天后`);

/** 快到期的优先；其次是放了两天以上的剩菜 / 自己做的菜。常温柜不看。 */
export const kitchenCue = (
    lots: KitchenLotLike[],
    foodNames: Map<string, string>,
    now: number,
    userName: string,
): Cue | null => {
    const live = lots.filter(lot => lot.quantity > 0 && (lot.storageZone === 'fridge' || lot.storageZone === 'freezer'));
    const expiring = live
        .map(lot => ({ lot, at: lot.expiresAt ? Date.parse(lot.expiresAt) : NaN }))
        .filter(({ lot, at }) => Number.isFinite(at) && at >= now - DAY && at - now <= 3 * DAY && lot.storageZone === 'fridge')
        .sort((a, b) => a.at - b.at)[0];
    if (expiring) {
        const name = foodNames.get(expiring.lot.foodId);
        if (name) {
            const days = Math.max(0, Math.ceil((expiring.at - now) / DAY));
            return {
                source: 'kitchen',
                dedupeKey: `kitchen:${expiring.lot.id}:expiring`,
                text: clipCueText(`${userName}冰箱里的「${name}」${dayWord(days)}就到期了（她现实里的冰箱，小厨房里记着的）`),
            };
        }
    }
    const leftover = live
        .filter(lot => lot.storageZone === 'fridge' && (lot.foodState === 'leftover' || lot.foodState === 'prepared') && now - lot.createdAt >= 2 * DAY)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (leftover) {
        const name = foodNames.get(leftover.foodId);
        if (name) {
            return {
                source: 'kitchen',
                dedupeKey: `kitchen:${leftover.id}:leftover`,
                text: clipCueText(`${userName}冰箱里还放着做好的「${name}」，${Math.floor((now - leftover.createdAt) / DAY)} 天前的（她现实里的冰箱，小厨房里记着的）`),
            };
        }
    }
    return null;
};

// ── 日历 ───────────────────────────────────────────────────────
const clockOf = (at: string, timeZone?: string) => new Intl.DateTimeFormat('zh-CN', {
    timeZone, hour12: false, hour: '2-digit', minute: '2-digit',
}).format(new Date(at));

/** 她的日历按她自己的时区读（docs/character-timezone.md：这是她的日历，不是角色的作息）。 */
export const calendarCue = (
    items: TemporalItem[],
    visibility: TemporalVisibility | undefined,
    now: number,
    userName: string,
    levelOf: (v: TemporalVisibility | undefined, kind: 'event' | 'reminder', source: string) => string,
    timeZone?: string,
): Cue | null => {
    for (const item of items) {
        if (levelOf(visibility, item.kind, item.source) !== 'title' || !item.title) continue;
        if (item.kind === 'event' && item.startAt && !item.allDay) {
            const start = Date.parse(item.startAt);
            const end = Date.parse(item.endAt ?? item.startAt);
            if (start > now && start - now <= 12 * 60 * 60 * 1000) {
                return { source: 'calendar', dedupeKey: `calendar:${item.sourceId}:${item.startAt}:soon`, text: clipCueText(`${userName} ${clockOf(item.startAt, timeZone)} 有「${item.title}」`) };
            }
            if (end <= now && now - end <= 3 * 60 * 60 * 1000) {
                return { source: 'calendar', dedupeKey: `calendar:${item.sourceId}:${item.startAt}:done`, text: clipCueText(`${userName}刚结束「${item.title}」`) };
            }
        } else if (item.kind === 'reminder' && !item.completed && item.dueAt) {
            const due = Date.parse(item.dueAt);
            if (due >= now - 6 * 60 * 60 * 1000 && due - now <= DAY) {
                return { source: 'calendar', dedupeKey: `calendar:${item.sourceId}:${item.dueAt}:todo`, text: clipCueText(`${userName}有件事快到期了：「${item.title}」`) };
            }
        }
    }
    return null;
};

// ── 他自己的生活 ───────────────────────────────────────────────
const lastLines = (text: string, count = 2) => text.split('\n').map(line => line.trim()).filter(Boolean).slice(-count).join(' / ');

/** 查手机里心跳写进来的、一天以内的记录（带 agentSourceIds 的那些），最新的一条。 */
export const ownLifeCue = (records: PhoneEvidence[], now: number): Cue | null => {
    const recent = records
        .filter(r => Array.isArray(r.agentSourceIds) && r.agentSourceIds.length > 0)
        .filter(r => Number.isFinite(r.timestamp) && r.timestamp <= now && now - r.timestamp <= DAY)
        .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!recent) return null;
    const title = String(recent.title ?? '').trim();
    const detail = String(recent.detail ?? '').trim();
    const text = recent.type === 'chat' ? (title ? `你这一天里跟${title}聊过：${lastLines(detail)}` : '')
        : recent.type === 'social' ? (detail ? `你这一天里发的那条朋友圈：${lastLines(detail, 1)}` : '')
            : recent.type === 'delivery' ? `你这一天里点了外卖${title ? `（${title}）` : ''}`
                : recent.type === 'order' ? `你这一天里在网上买了${title || '点东西'}`
                    : '';
    if (!text) return null;
    return { source: 'own_life', dedupeKey: `own_life:${recent.id}:${recent.timestamp}`, text: clipCueText(text) };
};

// ── 读数据 ─────────────────────────────────────────────────────
/** 收集这一轮能用的契机（每个来源最多一条）。任何来源读失败都只是少一个候选。 */
export const gatherCueCandidates = async (
    char: Pick<CharacterProfile, 'id' | 'phoneState'>,
    userName: string,
    now = Date.now(),
): Promise<Cue[]> => {
    const who = userName || 'ta';
    const tasks: Promise<Cue | null>[] = [
        (async () => {
            const { buildFinanceHeartbeatContext } = await import('./financeChatTools');
            return financeCue(await buildFinanceHeartbeatContext(now), who);
        })(),
        (async () => {
            const { KitchenDB } = await import('./kitchenDb');
            const [lots, foods] = await Promise.all([KitchenDB.getLots(), KitchenDB.getFoods()]);
            return kitchenCue(lots, new Map(foods.map(food => [food.id, food.name])), now, who);
        })(),
        (async () => {
            const { loadTemporalCache, levelOf } = await import('./emTemporal');
            const cache = loadTemporalCache();
            return cache ? calendarCue(cache.items, cache.visibility, now, who, levelOf) : null;
        })(),
        (async () => ownLifeCue(char.phoneState?.records ?? [], now))(),
    ];
    const settled = await Promise.allSettled(tasks);
    return settled.flatMap(result => (result.status === 'fulfilled' && result.value ? [result.value] : []));
};

/**
 * 每轮发送前调一次：掷「有没有念头」，有就从可用来源里抽一个放进这一轮，没有就清空。
 * skip=true（这一轮在点单、或她自己正聊着某个工具话题）时也清空，不掷。
 * 返回抽中的契机（调试用）；从不抛错——念头丢了不该连累发消息。
 */
export const rollChatCue = async (
    char: Pick<CharacterProfile, 'id' | 'phoneState'>,
    { skip = false, route = 'local', userName = '', now = Date.now(), rng = Math.random }: {
        skip?: boolean; route?: string; userName?: string; now?: number; rng?: () => number;
    } = {},
): Promise<Cue | null> => {
    setPendingCue(char.id, null);
    if (skip) {
        noteCueRoll(char.id, { at: now, outcome: 'skipped' });
        return null;
    }
    try {
        const state = loadCueState(char.id);
        // 掷不掷先看本机缓存的心思（不等网络）；掷中了再去 mini 拉新的给来源加权
        if (!shouldRollCue(state, now, rng, driveCueChance(readDriveSummaryCache(char.id)))) {
            noteCueRoll(char.id, { at: now, outcome: now - state.lastAt < CUE_MIN_GAP_MS ? 'gap' : 'missed' });
            return null;
        }
        const [candidates, drives] = await Promise.all([gatherCueCandidates(char, userName, now), fetchDriveSummary(char.id)]);
        const cue = pickCue(candidates, state, now, rng, driveWeightedWeights(drives));
        if (!cue) {
            noteCueRoll(char.id, { at: now, outcome: 'empty' });
            return null;
        }
        recordCuePicked(char.id, cue, route, now);
        setPendingCue(char.id, cue);
        noteCueRoll(char.id, { at: now, outcome: 'picked', cue: { source: cue.source, text: cue.text } });
        console.log(`💭 [Cue] ${char.id} ← ${cue.source}：${cue.text}`);
        return cue;
    } catch (error) {
        noteCueRoll(char.id, { at: now, outcome: 'error' });
        console.warn('💭 [Cue] 抽念头失败，这一轮不带', error);
        return null;
    }
};
// [EM-END: char-drives-cue]
