/**
 * 心跳里的买东西（外卖 delivery / 网购 order / 给阿萌买 gift）：送达时间由程序定，买过什么让 TA 记得。
 *
 * 跟这个文件夹里的其他东西一个道理——
 * - 送达时刻交给模型写，它会写「当天到」，投喂站却按三天算，两边对不上（spec-heartbeat-life-v2 第 5 节）。
 *   所以程序先抽好真实时刻，提示词里直接告诉它「这一单几点到」，`life.eta` 带着同一个时刻去前端。
 * - 但买菜就是当天达，买书就是普通快递——**哪种配送**是买的东西决定的，由模型选（`ship`）；
 *   每一档**几点到**由程序定。当天达只在还来得及的时候给（晚上下单就没有了）。
 * - 每一跳都是失忆的：前天刚买过的东西，今天又买一遍（阿萌 2026-09-26 撞见同一件下了两单）。
 *   所以把最近买过的列给它看。
 */

import { localDayAt } from './planTime.mjs';

export const SHOPPING_KINDS = new Set(['delivery', 'order', 'gift']);

/** 外卖 30–50 分钟到。 */
const FOOD_MIN_MINUTES = 30;
const FOOD_SPAN_MINUTES = 20;
/** 网购三档：当天达 2–4 小时（晚上 9 点后到不了就不给这一档）；次日达明天白天；普通快递第 2–5 天白天。 */
export const SHIP_KINDS = ['same_day', 'next_day', 'standard'];
const SAME_DAY_MIN_MINUTES = 120;
const SAME_DAY_SPAN_MINUTES = 120;
const SAME_DAY_LAST_HOUR = 21;
const STANDARD_DAY_WEIGHTS = [[2, 0.4], [3, 0.35], [4, 0.15], [5, 0.1]];
const NET_FIRST_HOUR = 10;
const NET_HOURS = 10;

/** 最近几天买过的给模型看。 */
export const PURCHASE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PURCHASES_SHOWN = 8;

/** 第 days 天的白天某个时刻（10–20 点）。 */
const daytime = (now, days, timezone, rng) => {
    const slot = Math.floor(rng() * NET_HOURS * 60);
    return localDayAt(now, days, NET_FIRST_HOUR + Math.floor(slot / 60), slot % 60, timezone)
        ?? new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
};

const localDateKey = (date, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'America/Chicago' }).format(date);
const localHourOf = (date, timezone) =>
    +new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(date);

/**
 * 各种送达时刻都先抽好：外卖一个，网购三档各一个（当天达可能是 null = 今天来不及了）。
 * 选哪个由模型写的 via / ship 定，提示词里都给出来，落地时按选的取。抽签用传进来的 rng，测试能钉死。
 */
export const pickEtas = (now, timezone, rng = Math.random) => {
    const food = new Date(now.getTime() + (FOOD_MIN_MINUTES + Math.floor(rng() * (FOOD_SPAN_MINUTES + 1))) * 60_000);
    const sameDayAt = new Date(now.getTime() + (SAME_DAY_MIN_MINUTES + Math.floor(rng() * (SAME_DAY_SPAN_MINUTES + 1))) * 60_000);
    const sameDay = localDateKey(sameDayAt, timezone) === localDateKey(now, timezone) && localHourOf(sameDayAt, timezone) < SAME_DAY_LAST_HOUR
        ? sameDayAt
        : null;
    const nextDay = daytime(now, 1, timezone, rng);
    const roll = rng() * 1000;
    let edge = 0;
    let days = STANDARD_DAY_WEIGHTS[STANDARD_DAY_WEIGHTS.length - 1][0];
    for (const [d, weight] of STANDARD_DAY_WEIGHTS) {
        edge += Math.round(weight * 1000);
        if (roll < edge) { days = d; break; }
    }
    return { food, net: { same_day: sameDay, next_day: nextDay, standard: daytime(now, days, timezone, rng) } };
};

/** 这一单走哪条：delivery 是外卖，order 是网购，gift 看 via。 */
export const shoppingVia = life => (life?.kind === 'delivery' ? 'food' : life?.kind === 'order' ? 'net' : life?.via === 'food' ? 'food' : 'net');

/** 网购按选的那档取时刻：没写或写了不认识的当普通快递；当天达来不及了退成次日达。 */
const netEta = (net, ship) => (ship === 'same_day' ? net.same_day ?? net.next_day : ship === 'next_day' ? net.next_day : net.standard);

/** 把程序定好的送达时刻挂到 life 上（ISO）。不是买东西的原样返回。 */
export const withEta = (life, etas) => {
    if (!life || !SHOPPING_KINDS.has(life.kind) || !etas) return life;
    const at = shoppingVia(life) === 'food' ? etas.food : netEta(etas.net, life.ship);
    return at ? { ...life, eta: at.toISOString() } : life;
};

/** 给模型看的网购三档：「ship 填 "same_day"（当天达……，今天晚上6:40到）/ …」。 */
export const formatShipOptions = (etas, now, timezone) => {
    const at = date => formatEtaForPrompt(date, now, timezone);
    const options = [
        etas.net.same_day ? `"same_day"（当天达：买菜、生鲜、急用的日用品这类闪送，${at(etas.net.same_day)}到）` : '',
        `"next_day"（次日达：超市、平台自营这类，${at(etas.net.next_day)}到）`,
        `"standard"（普通快递：大多数网店，${at(etas.net.standard)}到）`,
    ].filter(Boolean);
    return `按你买的东西选配送，ship 填 ${options.join(' / ')}`
        + (etas.net.same_day ? '' : '（这会儿太晚了，当天达已经送不了）')
        + '。提到物流、送达就说你选的那个时间，别自己编。';
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
