import { getCalendarDayDifference, getLocalDateKey } from './localDate';

const STORAGE_PREFIX = 'emNotionDiaryLastWrittenAt:';
const SOFT_REMINDER_MS = 24 * 60 * 60 * 1000;
const HARD_REMINDER_MS = 48 * 60 * 60 * 1000;

export type NotionDiaryCadenceLevel = 'none' | 'soft' | 'hard';

interface ResolveCadenceOptions {
    lastWrittenAt?: number;
    latestDiaryDate?: string;
    historyLookupSucceeded: boolean;
    now?: Date;
}

export function resolveNotionDiaryCadence({
    lastWrittenAt,
    latestDiaryDate,
    historyLookupSucceeded,
    now = new Date(),
}: ResolveCadenceOptions): NotionDiaryCadenceLevel {
    if (Number.isFinite(lastWrittenAt)) {
        const age = Math.max(0, now.getTime() - Number(lastWrittenAt));
        if (age < SOFT_REMINDER_MS) return 'none';
        if (age < HARD_REMINDER_MS) return 'soft';
        return 'hard';
    }

    if (!historyLookupSucceeded) return 'none';
    if (!latestDiaryDate) return 'hard';

    const dayDifference = getCalendarDayDifference(latestDiaryDate.slice(0, 10), getLocalDateKey(now));
    if (dayDifference === null) return 'none';
    if (dayDifference <= 0) return 'none';
    if (dayDifference === 1) return 'soft';
    return 'hard';
}

function readLastWrittenAt(characterId: string): number | undefined {
    if (typeof localStorage === 'undefined') return undefined;
    try {
        const value = Number(localStorage.getItem(`${STORAGE_PREFIX}${characterId}`));
        return Number.isFinite(value) && value > 0 ? value : undefined;
    } catch {
        return undefined;
    }
}

export function markNotionDiaryWritten(characterId: string, at = Date.now()): void {
    if (!characterId || typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(`${STORAGE_PREFIX}${characterId}`, String(at));
    } catch {
        // A storage failure must not turn a successful Notion write into a failed send.
    }
}

export function buildNotionDiaryCadenceReminder(
    characterId: string,
    latestDiaryDate: string | undefined,
    historyLookupSucceeded: boolean,
    now = new Date(),
): string {
    const level = resolveNotionDiaryCadence({
        lastWrittenAt: readLastWrittenAt(characterId),
        latestDiaryDate,
        historyLookupSucceeded,
        now,
    });

    if (level === 'none') return '';
    if (level === 'soft') {
        return `\n\n【私人日记节律提醒】\n距你上次成功写入私人日记已经超过一天。先自然回应当前对话；如果这轮真实交流让你产生了值得留下的感受、观察或关系变化，请主动额外写一篇内容完整的长日记，使用 [[DIARY_START:标题]]...[[DIARY_END]]。不要为了完成提醒而编造感悟。`;
    }

    return `\n\n【私人日记节律提醒｜需要检查】\n距你上次成功写入私人日记已经超过两天，或目前还没有日记。只要本轮不是纯操作请求、单个表情或没有实质内容，你必须在正常回复之外额外写一篇内容完整的长日记，使用 [[DIARY_START:标题]]...[[DIARY_END]]。日记应来自这段时间真实发生的交流与感受，不要虚构事件，也不要在聊天正文里复述日记内容。`;
}
