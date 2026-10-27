// [EM-START: heartbeat-outing]
/**
 * 心跳里 TA 临时出门了（life.kind = social 且带 outing 分钟数）：记下几点回来，
 * 状态灯在那之前显示忙碌，活动写「和谁出门了」。
 *
 * 起因（阿萌 2026-10-27）：状态灯只按日程算，TA 在起居注和聊天里说出门了，头像还亮着在线。
 * 这里不改日程，只在日程之上盖一层临时状态；到点自己失效。
 *
 * 只存本机 localStorage：这是此刻的状态，过几个小时就没用了，不进备份。
 */

import type { LifeEvent } from './emLife';

const KEY = 'em_char_outing_v1';
export const OUTING_CHANGED_EVENT = 'em-outing-changed';

export interface CharOuting {
    /** 大概几点回来（毫秒时间戳） */
    until: number;
    with?: string;
}

const readAll = (): Record<string, CharOuting> => {
    if (typeof localStorage === 'undefined') return {};
    try {
        const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const writeAll = (all: Record<string, CharOuting>) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
        // 存不下就算了：最坏是状态灯照日程走
    }
};

/** 收到一段生活小事：是出门就记下回来的时刻。已经回来了（取回得晚）的不记。 */
export const noteOutingFromLife = (charId: string, event: Pick<LifeEvent, 'createdAt' | 'life'>, now = Date.now()): boolean => {
    const { life } = event;
    const minutes = Number(life.outing);
    if (life.kind !== 'social' || !Number.isFinite(minutes) || minutes <= 0) return false;
    const start = Date.parse(event.createdAt) || now;
    const until = start + minutes * 60_000;
    if (until <= now) return false;
    const all = readAll();
    // 同一个角色只留最新的那次；过期的顺手清掉
    for (const [id, outing] of Object.entries(all)) if (!(outing?.until > now)) delete all[id];
    if (all[charId] && all[charId].until >= until) return false;
    all[charId] = { until, ...(life.with?.trim() ? { with: life.with.trim() } : {}) };
    writeAll(all);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OUTING_CHANGED_EVENT, { detail: { charId } }));
    return true;
};

/** 此刻还在外面就返回那次出门，否则 null。 */
export const getActiveOuting = (charId: string, now = Date.now()): CharOuting | null => {
    const outing = readAll()[charId];
    return outing && Number(outing.until) > now ? outing : null;
};

export const outingActivity = (outing: CharOuting): string =>
    outing.with ? `和${outing.with}出门了` : '出门了';
// [EM-END: heartbeat-outing]
