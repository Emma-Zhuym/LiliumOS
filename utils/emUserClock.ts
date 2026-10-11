// [EM-START: chat-user-clock]
/**
 * 聊天里告诉角色「对方那边现在几点」，用阿萌手机的系统时区算。
 *
 * 角色开了自定义时区（陆时在上海）时，聊天提示词原来只说「对方可能在不同的时区」，
 * 从没给过对方那边的钟。模型只能拿天气块里的「伯明翰」去猜，猜成了英国，
 * 连带着外卖按英镑算。主动消息那边早有这一行（buildUserClockHint），这里复用同一份措辞。
 */

import { buildUserClockHint } from './amsgFirePack';

/** 某个时区此刻比 UTC 快多少分钟（夏令时按此刻算）。 */
const zoneOffsetMinutes = (tz: string, now: number): number => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(now).map(part => [part.type, part.value]));
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return Math.round((wall - Math.floor(now / 60_000) * 60_000) / 60_000);
};

const hoursText = (minutes: number): string => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
};

/**
 * 把时差算成一句死数：谁快几个小时、两边是不是同一天。只给两个钟让模型自己减，它常减反或者把日期算岔
 * （2026-10-01 陆时又一次把时差说错，阿萌为此不高兴过不止一回）。
 */
export const timeDifferenceNote = (charTz: string, userTz: string, now: number): string => {
    const diff = zoneOffsetMinutes(charTz, now) - zoneOffsetMinutes(userTz, now);
    if (diff === 0) return '';
    const day = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const charDay = day(charTz);
    const userDay = day(userTz);
    const dayNote = charDay === userDay ? '两边是同一天' : charDay > userDay ? '你这边已经是第二天了，对方那边还是前一天' : '对方那边已经是第二天了，你这边还是前一天';
    const who = diff > 0 ? `你那边比对方快 ${hoursText(diff)}` : `对方那边比你快 ${hoursText(-diff)}`;
    // 不写时区名：芝加哥时区的标签是「芝加哥」，模型会当成对方住在芝加哥（阿萌在伯明翰）
    return `时差算好了，直接用，别自己再推：${who}，此刻${dayNote}。说到对方几点、哪天的时候按这个算。`;
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
    const hint = buildUserClockHint(now, { tzId: charTz }, { tzId: userTz }, '对方').trim();
    if (!hint) return '';
    const diff = timeDifferenceNote(charTz, userTz, now);
    return `${hint}\n${diff ? `${diff}\n` : ''}`;
};
// [EM-END: chat-user-clock]
