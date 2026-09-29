// [EM-START: chat-user-clock]
/**
 * 聊天里告诉角色「对方那边现在几点」，用阿萌手机的系统时区算。
 *
 * 角色开了自定义时区（陆时在上海）时，聊天提示词原来只说「对方可能在不同的时区」，
 * 从没给过对方那边的钟。模型只能拿天气块里的「伯明翰」去猜，猜成了英国，
 * 连带着外卖按英镑算。主动消息那边早有这一行（buildUserClockHint），这里复用同一份措辞。
 */

import { buildUserClockHint } from './amsgFirePack';

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
    return hint ? `${hint}\n` : '';
};
// [EM-END: chat-user-clock]
