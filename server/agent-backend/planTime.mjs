/**
 * 约定的时间：模型写自然语言（「周六下午」「明晚八点」），程序解析成绝对时刻。
 *
 * 不让模型写 ISO——它写不准（时区、星期几、今天几号都会错）。这里只认常见说法，
 * 认不出来就返回 null，调用方把整条 plan 丢掉（跟 episode 解析失败整条丢弃同一个原则）：
 * 宁可少一个约定，也不能落一个错的时间。
 *
 * 时间按角色所在时区理解；结果必须在未来、并且不超过 PLAN_HORIZON_MS。
 */

import { parseAppleDate } from './temporal.mjs';

/** 约定最远能排到多久以后：再远就不是「过两天 / 这周末」的事了，也没法靠心跳接得上。 */
export const PLAN_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 「十二」「二十」「三十一」「两」→ 数字，只管 0–99。 */
const cnToNumber = text => {
    if (!text.includes('十')) return [...text].reduce((n, ch) => n * 10 + CN_DIGITS[ch], 0);
    const [tens, ones] = text.split('十');
    return (tens ? CN_DIGITS[tens] : 1) * 10 + (ones ? CN_DIGITS[ones] : 0);
};

const normalize = raw => String(raw ?? '')
    .trim()
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/[零一二两三四五六七八九十]+(?=点|月|日|号|分)/g, cnToNumber);

// 星期：周一 = 1 … 周六 = 6，周日 / 周天 = 7（中文的一周从周一开始）
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };

/** 时段 → 没写几点时的默认时刻，以及「几点」要不要加 12。 */
const PERIODS = [
    [/凌晨|半夜/, 5, 'am'],
    [/早上|早晨|清早|一早|[今明]早/, 8, 'am'],
    [/上午/, 10, 'am'],
    [/中午|午饭/, 12, 'noon'],
    [/下午|午后/, 15, 'pm'],
    [/傍晚|黄昏|晚饭/, 18, 'pm'],
    [/晚上|夜里|今晚|明晚|[今明]夜/, 20, 'night'],
];
/** 只写了哪天、没写时段：取下午两点，落在一天的中间，到点的窗口最不容易错过。 */
const DEFAULT_HOUR = 14;

const localParts = (date, timeZone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
    const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
    return { year: +parts.year, month: +parts.month, day: +parts.day, weekday };
};

/**
 * 哪一天：返回 { offset }（相对今天的天数）或 { date: {month, day} }；没提到日子返回 null。
 * `rollable` = 只说了「周六」这种，落在过去就顺延一周。
 */
const parseDay = (text, today) => {
    if (/大后天/.test(text)) return { offset: 3 };
    if (/后天/.test(text)) return { offset: 2 };
    if (/明[天日早晚夜儿]/.test(text)) return { offset: 1 };
    if (/今[天日早晚夜儿]/.test(text)) return { offset: 0 };

    const week = text.match(/(下下|下|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天1-7])/);
    const weekend = !week && text.match(/(下下|下|这|本)?(?:个)?周末/);
    if (week || weekend) {
        const prefix = (week ?? weekend)[1] ?? '';
        const target = week ? WEEKDAY[week[2]] : 6;
        const weeksAhead = prefix === '下下' ? 2 : prefix === '下' ? 1 : 0;
        // 先落到本周（周一开头）的那一天，再按「下周 / 下下周」往后挪
        const offset = target - today.weekday + weeksAhead * 7;
        return { offset, rollable: !prefix };
    }

    const full = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
    if (full) return { date: { month: +full[1], day: +full[2] } };
    const dayOnly = text.match(/(\d{1,2})[日号]/);
    if (dayOnly) return { date: { month: null, day: +dayOnly[1] } };
    return null;
};

/** 几点：返回 { hour, minute }；没提到时刻也没提到时段返回 null。 */
const parseClock = text => {
    const period = PERIODS.find(([pattern]) => pattern.test(text));
    const clock = text.match(/(\d{1,2})(?::(\d{2})|点(?:(半)|(一刻)|(三刻)|(\d{1,2})分?)?)/);
    if (!clock) return period ? { hour: period[1], minute: 0 } : null;
    let hour = +clock[1];
    const minute = clock[2] ? +clock[2] : clock[3] ? 30 : clock[4] ? 15 : clock[5] ? 45 : clock[6] ? +clock[6] : 0;
    if (hour > 24 || minute > 59) return undefined;
    const kind = period?.[2];
    if (kind === 'pm' && hour < 12) hour += 12;
    // 「夜里两点」是凌晨，「晚上八点」才加 12
    else if (kind === 'night' && hour >= 6 && hour < 12) hour += 12;
    else if (kind === 'night' && hour === 12) hour = 24; // 晚上十二点 = 第二天零点
    else if (kind === 'noon' && hour < 6) hour += 12;
    // 没写上下午的「三点」多半是下午；七点以后的按原样（早上七点到十二点都说得通）
    else if (!kind && hour >= 1 && hour <= 6) hour += 12;
    return { hour, minute };
};

const pad = n => String(n).padStart(2, '0');

/** 本地的年月日 + 天数偏移 → 本地日期（用 UTC 做日历算术，跟时区无关）。 */
const shiftDate = ({ year, month, day }, offset) => {
    const d = new Date(Date.UTC(year, month - 1, day + offset));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

const toInstant = ({ year, month, day }, { hour, minute }, timeZone) => {
    // 「晚上十二点」= 第二天零点
    const date = hour === 24 ? shiftDate({ year, month, day }, 1) : { year, month, day };
    return parseAppleDate(`${date.year}-${pad(date.month)}-${pad(date.day)} ${pad(hour % 24)}:${pad(minute)}:00`, timeZone);
};

/**
 * 解析约定时间。认不出、已经过去、或者太远，一律返回 null。
 */
export const parsePlanTime = (raw, now = new Date(), timeZone = 'America/Chicago') => {
    const text = normalize(raw);
    if (!text) return null;
    // 日期格式（ISO、2026/9/26）是提示词明令不要的写法，而且多半写错：不认
    if (/\d{4}\s*[-/年.]/.test(text)) return null;
    const today = localParts(now, timeZone);
    const day = parseDay(text, today);
    const clock = parseClock(text);
    if (clock === undefined) return null;
    if (!day && !clock) return null;
    const time = clock ?? { hour: DEFAULT_HOUR, minute: 0 };

    let result;
    if (day?.date) {
        const { month, day: dom } = day.date;
        if (dom < 1 || dom > 31 || (month !== null && (month < 1 || month > 12))) return null;
        // 只说「15 号」：这个月的，过了就是下个月的；写了月份但已经过了，就是明年的
        const candidates = month === null
            ? [{ year: today.year, month: today.month }, shiftMonth(today, 1)]
            : [{ year: today.year, month }, { year: today.year + 1, month }];
        for (const base of candidates) {
            const probe = new Date(Date.UTC(base.year, base.month - 1, dom));
            if (probe.getUTCDate() !== dom) continue; // 2 月 30 号这种不存在的日子
            const at = toInstant({ ...base, day: dom }, time, timeZone);
            if (at && at > now) { result = at; break; }
        }
    } else if (day) {
        result = toInstant(shiftDate(today, day.offset), time, timeZone);
        if (result && result <= now && day.rollable) result = toInstant(shiftDate(today, day.offset + 7), time, timeZone);
    } else {
        // 只说了几点：今天的，过了就是明天的
        result = toInstant(today, time, timeZone);
        if (result && result <= now) result = toInstant(shiftDate(today, 1), time, timeZone);
    }
    if (!result || Number.isNaN(result.getTime())) return null;
    if (result <= now || result.getTime() - now.getTime() > PLAN_HORIZON_MS) return null;
    return result;
};

const shiftMonth = ({ year, month }, by) => {
    const index = year * 12 + (month - 1) + by;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};
