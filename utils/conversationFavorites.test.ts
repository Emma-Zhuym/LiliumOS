import { beforeEach, describe, expect, it } from 'vitest';
import { DB } from './db';
import type { Message } from '../types';
import {
    CONTENT_FAVORITES_INDEX_ASSET_ID,
    listContentFavorites,
    resolveContentFavorite,
    saveConversationContentFavorite,
} from './contentFavorites';
import { mergeMessageFavorites, removeMessageFavoriteEntry } from './messageFavorites';
import { normalizeChatSearchText, searchableChatMessageText } from './chatMessageSearch';

const charId = 'conversation-favorites';
const message = (id: number, overrides: Partial<Message> = {}): Message => ({
    id, charId, timestamp: id, type: 'text', role: id % 2 ? 'assistant' : 'user', content: `第 ${id} 句`, ...overrides,
});
beforeEach(async () => { await DB.deleteAsset(CONTENT_FAVORITES_INDEX_ASSET_ID); });

describe('多选收藏成一段对话', () => {
    it('按时间排好、去重，只收这个角色的聊天消息，说话人名字跟着存', async () => {
        const picked = [message(3), message(1), message(2), message(2), message(4, { charId: 'someone-else' }),
            message(5, { role: 'system', content: '系统提示' }), message(6, { type: 'interaction', content: '' })];
        const saved = await saveConversationContentFavorite(picked, charId, 'Sully', 'Emma');
        expect(saved.conversation?.map(line => line.messageId)).toEqual([1, 2, 3]);
        expect(saved.conversation?.map(line => line.senderName)).toEqual(['Sully', 'Emma', 'Sully']);
        expect(saved.snapshot?.content).toBe('Sully：第 1 句\nEmma：第 2 句\nSully：第 3 句');
    });

    it('同一组消息再收一次只更新，不多出一条；删了原消息收藏还在', async () => {
        const first = await saveConversationContentFavorite([message(11), message(12)], charId, 'Sully', 'Emma');
        const again = await saveConversationContentFavorite([message(12), message(11, { content: '改过的' })], charId, 'Sully', 'Emma');
        expect(again.id).toBe(first.id);
        expect(again.favoritedAt).toBe(first.favoritedAt);
        const all = await listContentFavorites();
        expect(all).toHaveLength(1);
        const resolved = await resolveContentFavorite(all[0]);
        expect('sourceAvailable' in resolved && resolved.sourceAvailable).toBe(false);
        expect(all[0].kind === 'chat' && all[0].conversation?.[0].content).toBe('改过的');
    });

    it('收藏夹里归到「对话」，能按整段文字搜到，取消后清掉', async () => {
        await saveConversationContentFavorite([message(21), message(22, { type: 'image', content: 'https://example.com/a.jpg' })], charId, 'Sully', 'Emma');
        const contents = await listContentFavorites();
        const entries = mergeMessageFavorites(contents, [], Object.fromEntries(
            (await Promise.all(contents.map(resolveContentFavorite))).map(item => [item.favorite.id, item]),
        ));
        expect(entries).toHaveLength(1);
        expect(entries[0].kind).toBe('conversation');
        expect(normalizeChatSearchText(searchableChatMessageText(entries[0].message))).toContain(normalizeChatSearchText('Emma：[图片]'));
        await removeMessageFavoriteEntry(entries[0]);
        expect(await listContentFavorites()).toEqual([]);
    });

    it('一条能收的都没有时报错，不写空收藏', async () => {
        await expect(saveConversationContentFavorite([message(31, { charId: 'someone-else' })], charId, 'Sully', 'Emma')).rejects.toThrow();
        expect(await listContentFavorites()).toEqual([]);
    });
});
