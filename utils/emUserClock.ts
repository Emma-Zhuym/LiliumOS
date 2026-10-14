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
    return block ? `${block}\n` : '';
};
// [EM-END: chat-user-clock]
