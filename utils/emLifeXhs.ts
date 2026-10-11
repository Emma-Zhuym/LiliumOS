// [EM-START: heartbeat-xhs]
/**
 * 心跳里「逛小红书」送来后的落地：变成小红书 App 里的「刷首页」活动（点开看过的另记一条「查看详情」），
 * 再往私聊里留一条跟手动「自由活动」同格式的系统消息，聊天时 TA 记得自己刷到过什么。
 *
 * 跟手动刷新那条路（utils/xhsFreeRoam.ts）的区别只在「谁发起」：
 * 那边是阿萌点按钮、在浏览器里刷；这边是 mini 上的心跳自己去刷，刷完把结果送过来。
 * 这里不往聊天里塞 xhs_card：真转发给阿萌的那条是一条正经的心跳消息，卡片由 emAgentInbox 接在那句话后面。
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
    const liked = picks.filter(pick => pick.liked).length;
    const faved = picks.filter(pick => pick.faved).length;
    const extras = [
        picks.length ? `多看了 ${picks.length} 条` : '',
        life.opened ? '点开看了 1 条' : '',
        liked ? `点赞 ${liked}` : '',
        faved ? `收藏 ${faved}` : '',
        life.share ? '转发给你 1 条' : '',
    ].filter(Boolean);
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
        resultMessage: `自己刷了 ${feed.length} 条首页笔记${extras.length ? `，${extras.join('、')}` : ''}`,
    };
};

/** 点开看过的那条另记一笔「查看详情」，跟手动刷新时的记法一样。 */
export const xhsDetailActivityFromLife = (event: LifeEvent, characterId: string): XhsActivityRecord | null => {
    const opened = event.life.kind === 'xhs' ? event.life.opened : undefined;
    if (!opened?.noteId || !opened.title) return null;
    return {
        id: `${xhsActivityId(event.messageId)}:detail`,
        characterId,
        timestamp: (Date.parse(event.createdAt) || Date.now()) + 1,
        actionType: 'browse',
        content: {
            keyword: `查看详情: ${opened.title}`,
            notesViewed: [{ noteId: opened.noteId, title: opened.title, desc: opened.desc || '', author: opened.author || '', likes: 0 }],
        },
        thinking: `点开看了「${opened.title}」的正文和评论区`,
        result: 'success',
        resultMessage: `查看了「${opened.title}」的详情，${opened.comments ?? 0} 条评论`,
    };
};

/** 一次心跳逛小红书落进小红书 App 的全部记录。 */
export const xhsActivitiesFromLife = (event: LifeEvent, characterId: string): XhsActivityRecord[] => {
    const main = xhsActivityFromLife(event, characterId);
    if (!main) return [];
    const detail = xhsDetailActivityFromLife(event, characterId);
    return detail ? [main, detail] : [main];
};

/** 私聊里那条系统消息：格式照手动自由活动（📕 …的自由活动），角色读得懂同一种写法。 */
export const xhsChatNote = (activity: XhsActivityRecord, charName: string, life?: LifeEvent['life']): string => {
    const viewed = activity.content.notesViewed ?? [];
    const picked = activity.content.savedTopics ?? [];
    const picks = life?.kind === 'xhs' ? life.picks ?? [] : [];
    const titles = (list: typeof picks) => list.map(pick => `「${pick.title}」`).join('、');
    const liked = picks.filter(pick => pick.liked);
    const faved = picks.filter(pick => pick.faved);
    return [
        `📕 ${charName}的自由活动: 自己刷了会儿小红书首页`,
        viewed.length ? `看到的帖子: ${viewed.map(note => `「${note.title}」by ${note.author || '匿名'}`).join('、')}` : '',
        picked.length ? `多看了两眼: ${picked.map(topic => `「${topic.title}」${topic.desc ? ` - ${topic.desc}` : ''}`).join('、')}` : '',
        life?.kind === 'xhs' && life.opened ? `点开看了「${life.opened.title}」的正文和评论区` : '',
        liked.length ? `点了赞: ${titles(liked)}` : '',
        faved.length ? `收藏了: ${titles(faved)}` : '',
        life?.kind === 'xhs' && life.share ? `转发给了对方: 「${life.share.note.title}」` : '',
        `💭 内心想法: ${activity.thinking}`,
    ].filter(Boolean).join('\n');
};
// [EM-END: heartbeat-xhs]
