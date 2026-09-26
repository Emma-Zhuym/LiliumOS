/**
 * 心跳里的买东西（外卖 delivery / 网购 order / 给阿萌买 gift）：送达时间由程序定，买过什么让 TA 记得。
 *
 * 跟这个文件夹里的其他东西一个道理——
 * - 送达时刻交给模型写，它会写「当天到」，投喂站却按三天算，两边对不上（spec-heartbeat-life-v2 第 5 节）。
 *   所以程序先抽一个真实时刻，提示词里直接告诉它「这一单几点到」，`life.eta` 带着同一个时刻去前端。
 * - 每一跳都是失忆的：前天刚买过的东西，今天又买一遍（阿萌 2026-09-26 撞见同一件下了两单）。
 *   所以把最近买过的列给它看。
 */

import { localDayAt } from './planTime.mjs';

export const SHOPPING_KINDS = new Set(['delivery', 'order', 'gift']);

/** 外卖 30–50 分钟到。 */
const FOOD_MIN_MINUTES = 30;
const FOOD_SPAN_MINUTES = 20;
/** 网购：第几天到（按累计千分位抽），白天 10 点到晚上 8 点之间送到。 */
const NET_DAY_WEIGHTS = [[1, 0.2], [2, 0.35], [3, 0.3], [4, 0.15]];
const NET_FIRST_HOUR = 10;
const NET_HOURS = 10;

/** 最近几天买过的给模型看。 */
export const PURCHASE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PURCHASES_SHOWN = 8;

/**
 * 两种送达时刻都先抽好：gift 是网购还是外卖由模型定，提示词里两个都给，落地时按 via 取。
 * 抽签用传进来的 rng，测试能钉死。
 */
export const pickEtas = (now, timezone, rng = Math.random) => {
    const food = new Date(now.getTime() + (FOOD_MIN_MINUTES + Math.floor(rng() * (FOOD_SPAN_MINUTES + 1))) * 60_000);
    const roll = rng() * 1000;
    let edge = 0;
    let days = NET_DAY_WEIGHTS[NET_DAY_WEIGHTS.length - 1][0];
    for (const [d, weight] of NET_DAY_WEIGHTS) {
        edge += Math.round(weight * 1000);
        if (roll < edge) { days = d; break; }
    }
    const slot = Math.floor(rng() * NET_HOURS * 60);
    const net = localDayAt(now, days, NET_FIRST_HOUR + Math.floor(slot / 60), slot % 60, timezone)
        ?? new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return { food, net };
};

/** 这一单走哪条：delivery 是外卖，order 是网购，gift 看 via。 */
export const shoppingVia = life => (life?.kind === 'delivery' ? 'food' : life?.kind === 'order' ? 'net' : life?.via === 'food' ? 'food' : 'net');

/** 把程序定好的送达时刻挂到 life 上（ISO）。不是买东西的原样返回。 */
export const withEta = (life, etas) => {
    if (!life || !SHOPPING_KINDS.has(life.kind) || !etas) return life;
    const at = etas[shoppingVia(life)];
    return at ? { ...life, eta: at.toISOString() } : life;
};

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 本地的年月日、星期、时分。 */
const localBits = (date, timezone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric',
        weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
    return {
        key: `${parts.year}-${parts.month}-${parts.day}`,
        month: +parts.month,
        day: +parts.day,
        weekday: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday],
        hour: +parts.hour,
        minute: +parts.minute,
    };
};

/** 「晚上7:40」：中文 12 小时制，跟心跳里别处的时间一个说法（模型读 24 小时制会读错）。 */
const clockText = ({ hour, minute }) => {
    const period = hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour < 13 ? '中午' : hour < 18 ? '下午' : '晚上';
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${period}${h12}:${String(minute).padStart(2, '0')}`;
};

/** 给模型看的送达时间：「今天晚上7:40」「明天下午3:20」「周一（9月28日）上午11:05」。 */
export const formatEtaForPrompt = (eta, now, timezone) => {
    const at = localBits(eta, timezone);
    const today = localBits(now, timezone);
    const tomorrow = localBits(new Date(now.getTime() + 24 * 60 * 60 * 1000), timezone);
    const day = at.key === today.key ? '今天' : at.key === tomorrow.key ? '明天' : `${WEEKDAYS[at.weekday]}（${at.month}月${at.day}日）`;
    return `${day}${clockText(at)}`;
};

/**
 * 最近买过的（真的发生过的那些：ok、非试跑）。
 * 从 model_runs.episode 里读，新的在前。惊喜礼物也列：TA 自己当然知道自己买了什么。
 */
export const recentPurchases = (db, charId, now = new Date(), { lookbackMs = PURCHASE_LOOKBACK_MS } = {}) => db.prepare(
    `SELECT started_at, episode FROM model_runs
      WHERE char_id = ? AND ok = 1 AND shadow = 0 AND episode IS NOT NULL AND started_at >= ?
      ORDER BY id DESC LIMIT 200`,
).all(charId, new Date(now.getTime() - lookbackMs).toISOString()).flatMap(row => {
    let life;
    try {
        life = JSON.parse(row.episode)?.life;
    } catch {
        return [];
    }
    if (!life || !SHOPPING_KINDS.has(life.kind) || !String(life.with ?? '').trim()) return [];
    return [{
        at: row.started_at,
        kind: life.kind,
        via: shoppingVia(life),
        what: String(life.with).trim().slice(0, 40),
        detail: String(life.detail ?? '').trim().slice(0, 60),
        ...(life.eta ? { eta: life.eta } : {}),
    }];
}).slice(0, MAX_PURCHASES_SHOWN);

/** 给模型看的「最近买过的」。没有就空串。 */
export const formatPurchasesForPrompt = (purchases, now, timezone, userName = '对方') => {
    if (!purchases.length) return '';
    const lines = purchases.map(item => {
        const when = formatEtaForPrompt(new Date(item.at), now, timezone).replace(/(上午|中午|下午|晚上|凌晨)\d+:\d+$/, '');
        const label = item.kind === 'gift' ? `给${userName}买的${item.via === 'food' ? '外卖' : '网购'}` : item.via === 'food' ? '外卖' : '网购';
        const arriving = item.eta && Date.parse(item.eta) > now.getTime() ? `，还在路上（${formatEtaForPrompt(new Date(item.eta), now, timezone)}到）` : '';
        return `- ${when || '今天'} ${label}：${item.what}${item.detail ? `（${item.detail}）` : ''}${arriving}`;
    });
    return `你最近买过的（别把同一件东西再下一单；还在路上的就等它到）：\n${lines.join('\n')}`;
};
