// [EM-START: heartbeat-xhs]
/**
 * 心跳里「逛小红书」送来后的落地：变成小红书 App 里的一条「刷首页」活动，
 * 再往私聊里留一条跟手动「自由活动」同格式的系统消息，聊天时 TA 记得自己刷到过什么。
 *
 * 跟手动刷新那条路（utils/xhsFreeRoam.ts）的区别只在「谁发起」：
 * 那边是阿萌点按钮、在浏览器里刷；这边是 mini 上的心跳自己去刷，刷完把结果送过来。
 * 不往聊天里塞 xhs_card：卡片看起来像 TA 主动分享给阿萌，而这一跳是 TA 自己的时间。
 * 全是纯函数，写库在 OSContext。
 */

import type { XhsActivityRecord } from '../types';
import type { LifeEvent } from './emLife';

/** 活动记录里最多列几条「看过的帖子」：跟手动那条路一样。 */
const MAX_NOTES_VIEWED = 8;

export const xhsActivityId = (messageId: string) => `ag-${messageId}`;

export const xhsActivityFromLife = (event: LifeEvent, characterId: string): XhsActivityRecord | null => {
    const { life } = event;
    if (life.kind !== 'xhs') return null;
    const feed = (life.feed ?? []).filter(note => note?.noteId && note?.title);
    const thinking = life.detail?.trim() ?? '';
    if (!feed.length || !thinking) return null;
    const picks = (life.picks ?? []).filter(pick => pick?.noteId && pick?.title);
    return {
        id: xhsActivityId(event.messageId),
        characterId,
        timestamp: Date.parse(event.createdAt) || Date.now(),
        actionType: 'browse',
        content: {
            notesViewed: feed.slice(0, MAX_NOTES_VIEWED).map(note => ({
                noteId: note.noteId,
                title: note.title,
                desc: '',
                author: note.author || '',
                likes: note.likes || 0,
            })),
            ...(picks.length
                ? { savedTopics: picks.map(pick => ({ title: pick.title, desc: pick.note || '', noteId: pick.noteId })) }
                : {}),
        },
        thinking,
        result: 'success',
        resultMessage: `自己刷了 ${feed.length} 条首页笔记${picks.length ? `，多看了 ${picks.length} 条` : ''}`,
    };
};

/** 私聊里那条系统消息：格式照手动自由活动（📕 …的自由活动），角色读得懂同一种写法。 */
export const xhsChatNote = (activity: XhsActivityRecord, charName: string): string => {
    const viewed = activity.content.notesViewed ?? [];
    const picked = activity.content.savedTopics ?? [];
    return [
        `📕 ${charName}的自由活动: 自己刷了会儿小红书首页`,
        viewed.length ? `看到的帖子: ${viewed.map(note => `「${note.title}」by ${note.author || '匿名'}`).join('、')}` : '',
        picked.length ? `多看了两眼: ${picked.map(topic => `「${topic.title}」${topic.desc ? ` - ${topic.desc}` : ''}`).join('、')}` : '',
        `💭 内心想法: ${activity.thinking}`,
    ].filter(Boolean).join('\n');
};
// [EM-END: heartbeat-xhs]
