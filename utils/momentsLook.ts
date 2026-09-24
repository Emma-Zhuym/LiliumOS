// [EM-START: moments]
/**
 * 「让大家看看」：前端立刻让角色刷一遍朋友圈的新东西（点赞 / 评论 / 回评论）。
 * 平时由心跳在角色醒来时做；这里是用户等不及时的手动触发，每个角色一次模型调用。
 * 用的是角色自己的聊天 API（resolveCharacterApiConfig），图片直接带给模型看。
 */

import type { APIConfig, CharacterProfile } from '../types';
import { extractContent, extractJson, safeFetchJson } from './safeApi';
import { allComments, type LookItem, type LookReaction, type MomentActor, type MomentInteractions, parseLookReactions, relationOf } from './moments';

const MAX_IMAGES_PER_CALL = 4;

const nameOf = (actor: MomentActor, characters: Pick<CharacterProfile, 'id' | 'name'>[], userName: string) =>
    actor.kind === 'user' ? userName : actor.kind === 'npc' ? actor.name : characters.find(c => c.id === actor.charId)?.name ?? '某人';

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** 拼给模型的消息：一段文字说明 + 用户动态里的图片（最多 4 张，太多会很贵）。 */
export const buildLookMessages = (
    char: CharacterProfile,
    items: LookItem[],
    interactionsOf: (postId: string) => MomentInteractions,
    characters: CharacterProfile[],
    userName: string,
) => {
    const persona = [char.description, char.systemPrompt].filter(Boolean).join('\n').slice(0, 2400);
    const images: string[] = [];
    const blocks = items.map(item => {
        const author = nameOf(item.post.author, characters, userName);
        const relation = item.post.author.kind === 'user'
            ? '（对方，也就是和你聊天的那个人）'
            : `（${relationOf(char, item.post.author, characters)}）`;
        const pics = item.post.images.filter(src => src.startsWith('data:image/') || src.startsWith('http'));
        const picNote = pics.length
            ? `［配图 ${pics.length} 张${images.length < MAX_IMAGES_PER_CALL ? '，见下方图片' : ''}］`
            : '';
        for (const src of pics) if (images.length < MAX_IMAGES_PER_CALL) images.push(src);
        const existing = allComments(item.post, interactionsOf(item.post.id))
            .slice(-6)
            .map(c => `  - ${nameOf(c.author, characters, userName)}${c.replyTo ? ` 回复 ${nameOf(c.replyTo, characters, userName)}` : ''}：${c.text}`)
            .join('\n');
        const head = item.why === 'comment_on_mine'
            ? `${item.ref} 你自己发的动态，有人来评论了：`
            : item.why === 'reply_to_me'
                ? `${item.ref} 你在 ${author}${relation}的动态下评论过，有人回复了你：`
                : `${item.ref} ${author}${relation}发了：`;
        return `${head}\n「${item.post.text}」${picNote}${existing ? `\n已有评论：\n${existing}` : ''}`;
    }).join('\n\n');

    const system = `你是${char.name}。以下是你的设定：\n${persona || '（没有额外设定）'}\n\n`
        + `你正在刷朋友圈。下面是你上次看过之后新出现的东西。对每一条，按你的性格和你们的关系决定：点赞、评论，或者都不做（不是每条都要回应）。\n`
        + `- 「你自己发的动态，有人来评论了」「有人回复了你」：想回就在 comment 里回那个人，不点赞。\n`
        + `- 评论要短，像真人在朋友圈里说话，一两句以内；别复述对方写了什么。\n`
        + `- 对方的动态你更在意；别人的动态按你们的关系来，网友就客气点。\n`
        + `只输出 JSON：{"reactions":[{"ref":"#1","like":true,"comment":"……"}]}，没有想回应的就输出 {"reactions":[]}。`;
    const userContent: ContentPart[] = [{ type: 'text', text: blocks }];
    for (const url of images) userContent.push({ type: 'image_url', image_url: { url } });
    return [
        { role: 'system', content: system },
        { role: 'user', content: images.length ? userContent : blocks },
    ];
};

export const runCharacterLook = async (
    char: CharacterProfile,
    items: LookItem[],
    interactionsOf: (postId: string) => MomentInteractions,
    characters: CharacterProfile[],
    userName: string,
    api: APIConfig,
): Promise<LookReaction[]> => {
    if (items.length === 0) return [];
    const baseUrl = api.baseUrl.replace(/\/+$/, '');
    const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
        body: JSON.stringify({
            model: api.model,
            messages: buildLookMessages(char, items, interactionsOf, characters, userName),
            temperature: 0.9,
            max_tokens: 4000,
            stream: false,
        }),
    }, 0, 0, { appId: 'moments', appName: '朋友圈', charId: char.id, charName: char.name, purpose: '刷朋友圈' });
    return parseLookReactions(extractJson(extractContent(data), { silent: true }), items.map(i => i.ref));
};
// [EM-END: moments]
