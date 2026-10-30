// [EM-START: chat-user-clock]
/**
 * 聊天里告诉角色「对方那边现在几点」，用阿萌手机的系统时区算。
 *
 * 角色开了自定义时区（陆时在上海）时，聊天提示词原来只说「对方可能在不同的时区」，
 * 从没给过对方那边的钟。模型只能拿天气块里的「伯明翰」去猜，猜成了英国，
 * 连带着外卖按英镑算。主动消息那边早有这一行（buildUserClockHint），这里复用同一份措辞。
 */

import { buildClockDifferenceNote, buildDualClockBlock } from './amsgFirePack';

/**
 * 把时差算成一句死数：谁快几个小时、两边是不是同一天。只给两个钟让模型自己减，它常减反或者把日期算岔
 * （2026-10-01 陆时又一次把时差说错，阿萌为此不高兴过不止一回）。
 */
export const timeDifferenceNote = (charTz: string, userTz: string, now: number): string => {
    const note = buildClockDifferenceNote(now, { tzId: charTz }, { tzId: userTz });
    return note ? `时差算好了，直接用，别自己再推：${note}。` : '';
};

export const deviceTimeZone = (): string | undefined => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
        return undefined;
    }
};

/** 角色时区和本机不同才有这一行；同一个钟报两遍只会让模型觉得两个时间在打架。 */
export const userClockNote = (charTz: string | undefined, now = Date.now(), userTz = deviceTimeZone()): string => {
    if (!charTz || !userTz || charTz === userTz) return '';
    // 保留 timeDifferenceNote 这一层作为 EM 防合并锚点；内容仍由 amsgFirePack 的统一算法生成。
    const difference = timeDifferenceNote(charTz, userTz, now);
    const block = buildDualClockBlock(now, { tzId: charTz }, { tzId: userTz }, '对方', difference);
    return block ? `${block}\n${HISTORY_STAMP_LEGEND}\n` : '';
};

/**
 * 聊天记录里每条消息的时间戳（阿萌 2026-10-30：两座城的钟都写进去了，时差还是一直搞错）。
 * 原来每条都只按角色那边的钟写、不说是谁的钟：她早上 8 点说「早安」，TA 看到的是「21:00 早安」，
 * 上面的双城时钟说一套、下面每条记录说另一套，模型信的是记录。
 * 现在：时间戳照旧是你那边的；她说的话后面再标一个她当地的钟。
 */
export const HISTORY_STAMP_LEGEND = '聊天记录里方括号的时间是你那边的；对方说的话另标了「对方当地」几点——判断对方当时是早上还是深夜、说的「今天 / 刚才」是哪天，看那一个。';

const pad = (n: number) => String(n).padStart(2, '0');
const wallClock = (ts: number, tz: string): string => {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
        }).formatToParts(new Date(ts)).reduce<Record<string, string>>((out, p) => ({ ...out, [p.type]: p.value }), {});
        return `${pad(+parts.month)}-${pad(+parts.day)} ${pad(+parts.hour)}:${pad(+parts.minute)}`;
    } catch {
        return '';
    }
};

/** 她发的那条后面接「｜对方当地 10-30 08:00」。两边同一个钟、或者不是她发的，返回空。 */
export const userSideStamp = (
    message: { role: string; timestamp?: number },
    charTz: string | undefined,
    userTz = deviceTimeZone(),
): string => {
    if (message.role !== 'user' || !charTz || !userTz || charTz === userTz || !message.timestamp) return '';
    const local = wallClock(message.timestamp, userTz);
    return local && local !== wallClock(message.timestamp, charTz) ? `｜对方当地 ${local}` : '';
};
// [EM-END: chat-user-clock]
