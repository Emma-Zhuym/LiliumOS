// [EM-START: char-drives-screen-time]
/**
 * 查手机首页的屏幕使用时间：按 TA 今天真实留下的记录算，不再编。
 *
 * 原来是 `64 + 记录条数 × 11 + 名字哈希 % 40`，跟 TA 今天做了什么毫无关系（阿萌 2026-10-14 发现）。
 * 现在每条今天的记录按它是哪个 App 给一段合理时长（同一条记录永远同一个数，刷新不跳），
 * 加总并按 App 拆开。今天什么都没做，就是 0。
 * 规格见 docs/spec-character-drives.md 第 6 节。
 */

export interface ScreenTimeRecord {
    id: string;
    type: string;
    timestamp: number;
}

export interface ScreenTimeSummary {
    totalMin: number;
    byApp: { type: string; minutes: number }[];
}

/** 每类一次大概用多久（分钟，闭区间）。没列的按「其他 App」。 */
export const SCREEN_MINUTES: Record<string, [number, number]> = {
    chat: [4, 14],
    social: [3, 10],
    delivery: [2, 5],
    order: [3, 12],
    call: [5, 20],
};
const OTHER_MINUTES: [number, number] = [2, 8];

/** 同一个 id 永远落在同一个数上（FNV-1a）。 */
const hashUnit = (key: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i += 1) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) / 0xffffffff;
};

export const minutesForRecord = (record: ScreenTimeRecord): number => {
    const [lo, hi] = SCREEN_MINUTES[record.type] ?? OTHER_MINUTES;
    return lo + Math.round(hashUnit(`${record.id}:${record.type}`) * (hi - lo));
};

/** 某个时刻在某时区里是哪一天（YYYY-MM-DD）。时区认不出就按本机。 */
export const dayKeyIn = (at: number, timeZone?: string): string => {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
    } catch {
        return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
    }
};

/**
 * 「今天」按 TA 那边的时区算（docs/character-timezone.md：手机是 TA 的，屏幕时间是 TA 的一天）。
 */
export const summarizeScreenTime = (
    records: ScreenTimeRecord[],
    { now = Date.now(), timeZone }: { now?: number; timeZone?: string } = {},
): ScreenTimeSummary => {
    const today = dayKeyIn(now, timeZone);
    const byType = new Map<string, number>();
    for (const record of records) {
        if (!record?.id || !Number.isFinite(record.timestamp) || record.timestamp > now) continue;
        if (dayKeyIn(record.timestamp, timeZone) !== today) continue;
        byType.set(record.type, (byType.get(record.type) ?? 0) + minutesForRecord(record));
    }
    const byApp = [...byType.entries()]
        .map(([type, minutes]) => ({ type, minutes }))
        .sort((a, b) => b.minutes - a.minutes);
    return { totalMin: byApp.reduce((sum, app) => sum + app.minutes, 0), byApp };
};
// [EM-END: char-drives-screen-time]
