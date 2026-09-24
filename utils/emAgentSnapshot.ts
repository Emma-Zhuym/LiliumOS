// [EM-START: agent-backend-snapshot]
/**
 * 角色近况快照：把「角色此刻是什么样子」打包成后端能读的一份 JSON（契约见
 * docs/agent-backend-design.md 3.4）。
 *
 * 快照**不是记忆**，只是最近的样子：后端每个角色只留最新一份，旧的直接被盖掉。
 * 心跳没有快照就不动脑（后端第二道闸），所以这份传不上去，角色就不会自己醒来说话。
 *
 * 时间的两把尺子（docs/character-timezone.md）：
 * - 快照里的 `timezone` / `sleepWindow` / `todaySchedule` 都是**角色那边**的时间；
 * - `builtAt` / `lastInteraction` 是绝对时刻（ISO），跟时区无关。
 * 别把两者混起来，否则角色会在自己的凌晨三点醒来找人。
 */

import type { CharacterProfile, Message } from '../types';
import { getDailyScheduleForChar } from './dailySchedule';
import { formatSleepTimelineTime } from './scheduleTime';
import { resolveCharTimeZone } from './timezone';
import { isScheduleFeatureOn } from './scheduleFeature';
import { resolveContactGroup } from './contactGroups';
import { normName } from './relationshipChat';

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** 最多带多少条最近消息；每条截断到多少字。与后端的规整逻辑对齐。 */
const MAX_RECENT_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 500;
const MAX_PERSONA_CHARS = 4000;
const MAX_MOOD_CHARS = 1500;
const MAX_RHYTHM_CHARS = 3000;
const MAX_CIRCLE = 12;
/** 私人生活里的圈子：同事在工作 App 里，司机店家之类不算「会聊几句的人」。 */
const PRIVATE_GROUPS = new Set(['friend', 'family', 'school', 'online', 'other']);

/**
 * 通讯录里能拿来「聊几句」的人。只要虚构联系人：真人角色之间的对话要两边手机同步，
 * 心跳单方面写一段会让两边对不上（见 docs/relationship-system.md）。
 */
export const buildCircle = (char: CharacterProfile, userName?: string): NonNullable<CharacterSnapshot['payload']['circle']> =>
    (char.phoneState?.contacts ?? [])
        .filter(contact => contact.status === 'friend' && contact.kind === 'npc' && !contact.linkedCharId)
        .filter(contact => !userName || normName(contact.name) !== normName(userName))
        .filter(contact => PRIVATE_GROUPS.has(resolveContactGroup(contact)))
        .sort((a, b) => (b.lastInteraction || b.createdAt) - (a.lastInteraction || a.createdAt))
        .slice(0, MAX_CIRCLE)
        .map(contact => ({
            name: contact.name,
            ...(contact.identity ? { relation: contact.identity } : {}),
            group: resolveContactGroup(contact),
        }));

/** [EM: moments] 同事：不拿来私聊，只在 TA 发朋友圈时出来评论几句。 */
export const buildCoworkers = (char: CharacterProfile, userName?: string): NonNullable<CharacterSnapshot['payload']['coworkers']> =>
    (char.phoneState?.contacts ?? [])
        .filter(contact => contact.status === 'friend' && contact.kind === 'npc' && !contact.linkedCharId)
        .filter(contact => !userName || normName(contact.name) !== normName(userName))
        .filter(contact => resolveContactGroup(contact) === 'work')
        .sort((a, b) => (b.lastInteraction || b.createdAt) - (a.lastInteraction || a.createdAt))
        .slice(0, 6)
        .map(contact => ({ name: contact.name, ...(contact.identity ? { relation: contact.identity } : {}), group: 'work' }));

export interface SnapshotBoundary {
    text: string;
    kind?: 'preference' | 'relationship';
    confirmedAt: string;
    source?: string;
}

export interface CharacterSnapshot {
    charId: string;
    schemaVersion: number;
    builtAt: string;
    payload: {
        identity: { name: string; persona?: string };
        user: { name: string };
        timezone: string;
        sleepWindow?: { start: string; end: string };
        /** 情绪底色：聊天里每轮情绪评估写出的那段叙事（char.buffInjection）。 */
        mood?: string;
        /** 日常节律：聊天「日程/情绪」面板里的自由文本，日程生成器一直在用的那份。 */
        dailyRhythm?: string;
        /** 私人生活里认识的人（通讯录里的虚构联系人），心跳写「和谁聊了几句」时优先从这里挑，名字才前后一致。 */
        circle?: { name: string; relation?: string; group?: string }[];
        coworkers?: { name: string; relation?: string; group?: string }[]; // [EM: moments]
        todaySchedule?: { start: string; end: string; title: string; availability?: string }[];
        lastInteraction?: { userAt?: string; charAt?: string };
        recentMessages?: { role: 'user' | 'char'; at: string | null; text: string }[];
        boundaries?: SnapshotBoundary[];
        openThreads?: never[];
    };
}

/** 跨午夜刻度（21:30 → 次日 10:00）转成 "HH:MM"，「次日」前缀对后端没意义，去掉。 */
const toClock = (minutes: number): string => formatSleepTimelineTime(minutes).replace('次日 ', '');

/** 设备时区兜底：角色没开自定义时区时，ta 的作息就按这台设备所在地算。 */
const deviceTimeZone = (): string => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
    } catch {
        return 'America/Chicago';
    }
};

/**
 * 消息正文的纯文本形态。图片、语音这类只留占位描述——
 * 快照是给模型读的近况，不该把 base64 之类的东西塞进去。
 */
export const messageToPlainText = (message: Message): string => {
    if (message.type === 'image') return '[一张照片]';
    if (message.type === 'voice' || message.metadata?.voice) return `[语音] ${message.content ?? ''}`.trim();
    if (message.type === 'interaction') return '[戳了一下]';
    return String(message.content ?? '');
};

const isFromUser = (message: Message): boolean => message.role === 'user';

/**
 * 角色设定：系统提示词 + 人设简介 + 世界观，按这个顺序拼。
 * 记忆、日记那些不进快照——快照只是「最近的样子」，长期记忆是 Phase 2 的事。
 */
export const buildPersona = (char: CharacterProfile): string =>
    [char.systemPrompt, char.description, char.worldview]
        .map(part => (part ?? '').trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, MAX_PERSONA_CHARS);

/**
 * 找最后一条**真实**的用户消息与角色消息的时刻（设计 3.4）。
 * 系统提示、卡片之类不算真实互动，别让它们把心跳的「正在聊天」闸一直按住。
 */
export const findLastInteraction = (messages: Message[]): { userAt?: string; charAt?: string } => {
    const out: { userAt?: string; charAt?: string } = {};
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message?.timestamp) continue;
        if (message.type === 'system') continue;
        const at = new Date(message.timestamp).toISOString();
        if (!out.userAt && isFromUser(message)) out.userAt = at;
        if (!out.charAt && !isFromUser(message)) out.charAt = at;
        if (out.userAt && out.charAt) break;
    }
    return out;
};

export interface BuildSnapshotOptions {
    /** 阿萌在这个角色的称呼，用于提示词里的第二人称。 */
    userName?: string;
    /** 已确认的关系与边界。没有 confirmedAt 的条目后端会丢掉，这里也不硬造。 */
    boundaries?: SnapshotBoundary[];
    at?: Date;
}

/**
 * 拼一份快照。
 *
 * `openThreads`（未完事项）这一版恒为空：设计要求每条都带来源和确认状态，
 * 靠前端猜出来的「未完事项」会被角色当成约定说出口，宁可不给。
 */
export const buildCharacterSnapshot = async (
    char: CharacterProfile,
    messages: Message[],
    options: BuildSnapshotOptions = {},
): Promise<CharacterSnapshot> => {
    const at = options.at ?? new Date();
    const timezone = resolveCharTimeZone(char) || deviceTimeZone();

    let todaySchedule: CharacterSnapshot['payload']['todaySchedule'];
    try {
        const schedule = await getDailyScheduleForChar(char, at);
        const slots = schedule?.slots ?? [];
        todaySchedule = slots.map((slot, index) => ({
            start: slot.startTime,
            // slot 只有开始时间，结束时间按下一个 slot 的开始时间算；最后一个留空。
            end: slots[index + 1]?.startTime ?? '',
            title: [slot.activity, slot.location].filter(Boolean).join(' · '),
            availability: slot.availability,
        }));
    } catch {
        // 日程读不出来不是拦路石：心跳照样能判断，只是少一层依据。
        todaySchedule = undefined;
    }

    const recent = messages
        .filter(message => message.type !== 'system')
        .slice(-MAX_RECENT_MESSAGES)
        .map(message => ({
            role: (isFromUser(message) ? 'user' : 'char') as 'user' | 'char',
            at: message.timestamp ? new Date(message.timestamp).toISOString() : null,
            text: messageToPlainText(message).slice(0, MAX_MESSAGE_CHARS),
        }))
        .filter(item => item.text.length > 0);

    return {
        charId: char.id,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        builtAt: at.toISOString(),
        payload: {
            identity: { name: char.name, persona: buildPersona(char) },
            user: { name: options.userName || '阿萌' },
            timezone,
            ...(char.sleepWindow
                ? {
                    sleepWindow: {
                        start: toClock(char.sleepWindow.bedtimeMinutes),
                        end: toClock(char.sleepWindow.wakeTimeMinutes),
                    },
                }
                : {}),
            ...(todaySchedule?.length ? { todaySchedule } : {}),
            // 跟聊天注入同一个条件：总开关或情绪系统关着时，残留的底色不该漏进心跳。
            ...(isScheduleFeatureOn(char) && char.emotionConfig?.enabled && char.buffInjection?.trim()
                ? { mood: char.buffInjection.trim().slice(0, MAX_MOOD_CHARS) }
                : {}),
            ...(() => {
                const circle = buildCircle(char, options.userName);
                return circle.length ? { circle } : {};
            })(),
            ...(() => { // [EM: moments]
                const coworkers = buildCoworkers(char, options.userName);
                return coworkers.length ? { coworkers } : {};
            })(),
            // 与日程生成同一个开关：'mindful' 角色没有物理生活，这份「上班/日常安排」对它没意义。
            ...(char.scheduleStyle !== 'mindful' && char.dailyRhythm?.trim()
                ? { dailyRhythm: char.dailyRhythm.trim().slice(0, MAX_RHYTHM_CHARS) }
                : {}),
            lastInteraction: findLastInteraction(messages),
            ...(recent.length ? { recentMessages: recent } : {}),
            ...(options.boundaries?.length ? { boundaries: options.boundaries } : {}),
        },
    };
};
// [EM-END: agent-backend-snapshot]
