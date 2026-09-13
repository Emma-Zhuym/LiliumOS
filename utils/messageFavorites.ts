import type { Message } from '../types';
import { DB } from './db';
import { contentFavoriteIdForMessage, getContentFavoriteById, makeChatContentFavoriteId, removeUserContentFavoriteById, saveMessageContentFavorite, snapshotChatFavoriteMessage, type ContentFavorite, type ResolvedContentFavorite } from './contentFavorites';
import { buildChatVoiceFavoriteSnapshot, readExistingVoiceFavoriteAudio, type ExistingVoiceSnapshot } from './voiceFavoriteSnapshot';
import { getVoiceFavorite, removeVoiceFavorite, removeVoiceFavoriteById, saveVoiceFavorite, type VoiceFavorite } from './voiceFavorites';

export const chatVoiceKey = (message: Pick<Message, 'charId' | 'id'>) => `${message.charId}:${message.id}`;
export const voiceChatMessageId = (item: VoiceFavorite): number | null => {
    if (item.source !== 'chat' || !item.sourceKey.startsWith(`${item.charId}:`)) return null;
    const id = Number(item.sourceKey.slice(item.charId.length + 1));
    return Number.isSafeInteger(id) ? id : null;
};
let queue: Promise<unknown> = Promise.resolve();
const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work); queue = next.catch(() => undefined); return next;
};

/** One user-facing state, including the two historical indexes. New chat voice saves use only the voice index. */
export const toggleChatMessageFavorite = (message: Message, charName: string, userName: string, currentAudio?: ExistingVoiceSnapshot): Promise<boolean> => serialize(async () => {
    const id = contentFavoriteIdForMessage(message), key = chatVoiceKey(message);
    const [content, voice] = await Promise.all([getContentFavoriteById(id), getVoiceFavorite('chat', key)]);
    if (content?.owners.some(owner => owner.kind === 'user') || voice) {
        if (content) await removeUserContentFavoriteById(content.id);
        if (voice) await removeVoiceFavorite('chat', key);
        return false;
    }
    const stored = message.type === 'text' ? await DB.getAssetRaw(`voice_msg_${message.id}`) as ExistingVoiceSnapshot | null : null;
    const audio = { ...stored, ...currentAudio };
    const snapshot = buildChatVoiceFavoriteSnapshot(message, { id: message.charId, name: charName }, userName, audio);
    if (snapshot) await saveVoiceFavorite({ ...snapshot, messageSnapshot: snapshotChatFavoriteMessage(message), blob: await readExistingVoiceFavoriteAudio(audio) });
    else await saveMessageContentFavorite(message, charName);
    return true;
});

export interface MessageFavoriteEntry {
    id: string;
    kind: 'text' | 'image' | 'voice' | 'html';
    charId: string;
    charName: string;
    timestamp: number;
    message?: Message | null;
    imageUrl?: string | null;
    sourceAvailable?: boolean;
    content?: ContentFavorite;
    voice?: VoiceFavorite;
}

/** Classification never modifies a message. Historical double stars become one row. */
export const mergeMessageFavorites = (contents: ContentFavorite[], voices: VoiceFavorite[], resolved: Record<string, ResolvedContentFavorite>): MessageFavoriteEntry[] => {
    const entries = new Map<string, MessageFavoriteEntry>();
    for (const content of contents) {
        const result = resolved[content.id];
        const message = result && 'message' in result ? result.message : content.kind === 'chat' && content.snapshot
            ? { ...content.snapshot, id: content.messageId, charId: content.charId } as Message : null;
        const isVoice = message && buildChatVoiceFavoriteSnapshot(message, { id: content.charId, name: content.charName }, '你');
        entries.set(content.id, { id: content.id, kind: content.kind === 'image' ? 'image' : isVoice ? 'voice' : message?.type === 'html_card' ? 'html' : 'text', charId: content.charId, charName: content.charName, timestamp: content.sourceTimestamp, message, content,
            sourceAvailable: !!(result && 'sourceAvailable' in result && result.sourceAvailable), imageUrl: result && 'imageUrl' in result ? result.imageUrl : undefined });
    }
    for (const voice of voices) {
        const messageId = voiceChatMessageId(voice);
        const id = messageId === null ? `voice:${voice.id}` : makeChatContentFavoriteId(voice.charId, messageId);
        const previous = entries.get(id);
        const message = voice.messageSnapshot ? { ...voice.messageSnapshot, id: messageId ?? -1, charId: voice.charId } as Message : previous?.message;
        entries.set(id, { ...previous, id, kind: 'voice', charId: voice.charId, charName: voice.charName, timestamp: voice.sourceTimestamp, voice, message });
    }
    return [...entries.values()].sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
};

export const removeMessageFavoriteEntry = (entry: MessageFavoriteEntry): Promise<void> => serialize(async () => {
    if (entry.content) await removeUserContentFavoriteById(entry.content.id);
    if (entry.voice) await removeVoiceFavoriteById(entry.voice.id);
});
