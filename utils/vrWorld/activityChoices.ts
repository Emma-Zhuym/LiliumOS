import type { VRRoomId } from '../../types';

/** Only executable activities belong here; user-only collections/NPC stories are not destinations. */
export const ORDINARY_ACTIVITIES: { id: VRRoomId; name: string; description: string }[] = [
    { id:'library', name:'图书馆', description:'读书、留下批注' },
    { id:'theater', name:'剧院', description:'即兴写剧本投稿' },
    { id:'music', name:'听歌房', description:'点歌、听歌与锐评' },
    { id:'guestbook', name:'留言簿', description:'发帖、回复和版聊' },
    { id:'gym', name:'娱乐室', description:'游戏、学习或随意玩耍' },
    { id:'postoffice', name:'邮局', description:'写信、读信与回信' },
];
