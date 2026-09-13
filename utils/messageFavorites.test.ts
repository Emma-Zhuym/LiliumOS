import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import type { Message } from '../types';
import { CONTENT_FAVORITES_INDEX_ASSET_ID, listContentFavorites, resolveContentFavorite, saveMessageContentFavorite } from './contentFavorites';
import { VOICE_FAVORITES_INDEX_ASSET_ID, listVoiceFavorites } from './voiceFavorites';
import { mergeMessageFavorites, removeMessageFavoriteEntry, toggleChatMessageFavorite } from './messageFavorites';

const charId = 'unified-favorites';
const message = (id: number, overrides: Partial<Message> = {}): Message => ({ id, charId, timestamp: 10, type: 'text', role: 'assistant', content: '第一行\n\n第二段', ...overrides });
beforeEach(async () => { await DB.deleteAsset(CONTENT_FAVORITES_INDEX_ASSET_ID); await DB.deleteAsset(VOICE_FAVORITES_INDEX_ASSET_ID); });

describe('one Chat favorite state preserving message shape', () => {
    it('stores voice once, folds historical double stars together, and one removal clears the user state without a voice API', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const msg = message(81001, { role: 'user', metadata: { voice: true } });
        expect(await toggleChatMessageFavorite(msg, 'Sully', 'Emma')).toBe(true);
        expect(await listContentFavorites()).toHaveLength(0);
        expect((await listVoiceFavorites())[0].messageSnapshot).toMatchObject({ content: msg.content, metadata: { voice: true } });
        await saveMessageContentFavorite(msg, 'Sully'); // Older versions allowed both buttons.
        const contents = await listContentFavorites(), voices = await listVoiceFavorites();
        const entries = mergeMessageFavorites(contents, voices, {});
        expect(entries).toHaveLength(1); expect(entries[0].kind).toBe('voice');
        await removeMessageFavoriteEntry(entries[0]);
        expect(await listContentFavorites()).toEqual([]); expect(await listVoiceFavorites()).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
    });
    it('keeps original text and HTML metadata in snapshots after original messages are deleted', async () => {
        const text = message(81002), card = message(81003, { type: 'html_card', content: '[HTML小卡片]', metadata: { htmlSource: '<section><h2>晚安卡</h2><p>今天辛苦了</p></section>' } });
        await toggleChatMessageFavorite(text, 'Sully', 'Emma'); await toggleChatMessageFavorite(card, 'Sully', 'Emma');
        const restored = await Promise.all((await listContentFavorites()).map(resolveContentFavorite));
        const rows = restored.filter(item => 'message' in item);
        expect(rows.find(item => item.message?.id === text.id)?.message?.content).toBe(text.content);
        expect(rows.find(item => item.message?.id === card.id)?.message?.metadata?.htmlSource).toBe(card.metadata?.htmlSource);
        expect(rows.every(item => !item.sourceAvailable)).toBe(true);
    });
});
