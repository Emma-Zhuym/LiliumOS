// [EM-START: text-voice-favorites]
import type { Message } from '../types';
import type { SaveVoiceFavoriteInput } from './voiceFavorites';
import { normalizeVoiceTags } from './sanitize';
import { cleanVoiceMarkupForDisplay, parseVoiceOutput } from './minimaxTts';
import { stripFishCuesForDisplay } from './fishAudioTts';
import { fetchBlobForShare } from './shareExport';

export interface ExistingVoiceSnapshot {
    originalText?: string;
    spokenText?: string;
    lang?: string;
    url?: string;
    remoteUrl?: string;
    blob?: Blob;
}

const clean = (text?: string) => stripFishCuesForDisplay(cleanVoiceMarkupForDisplay(text));

/** Extract what the voice bar represents; never translate, synthesize or play. */
export const buildChatVoiceFavoriteSnapshot = (
    message: Pick<Message, 'id' | 'type' | 'role' | 'content' | 'metadata' | 'timestamp'>,
    character: { id: string; name: string },
    userName: string,
    existing?: ExistingVoiceSnapshot | null,
): Omit<SaveVoiceFavoriteInput, 'blob' | 'favoritedAt'> | null => {
    if (message.type !== 'text') return null;
    const isUser = message.role === 'user';
    const raw = normalizeVoiceTags(message.content);
    const parsed = parseVoiceOutput(raw);
    const hasAudio = !!(existing?.url || existing?.remoteUrl || existing?.blob?.size);
    if (isUser ? message.metadata?.voice !== true : message.role !== 'assistant' || (!parsed.hasVoiceTag && !hasAudio)) return null;

    // The parser deliberately collapses whitespace for speech. The archive
    // instead keeps the displayed paragraphs and only removes provider cues.
    const voiceText = clean(raw.match(/<[语語]音[^>]*>([\s\S]*?)<\/\s*[语語]音\s*>/)?.[1]?.replace(/<字幕>[\s\S]*?<\/字幕>/g, ''));
    const subtitle = clean(parsed.subtitle);
    const originalText = isUser ? message.content.trim()
        : clean(existing?.originalText) || subtitle || (parsed.hasVoiceTag ? voiceText : clean(message.content));
    const spoken = isUser ? '' : clean(existing?.spokenText) || voiceText;
    if (!originalText && !spoken && !hasAudio) return null;
    return {
        source: 'chat',
        sourceKey: `${character.id}:${message.id}`,
        charId: character.id,
        charName: character.name,
        sourceTimestamp: message.timestamp,
        originalText,
        spokenText: spoken && spoken !== originalText ? spoken : undefined,
        translation: subtitle || (existing?.lang ? clean(existing.originalText) : undefined) || undefined,
        language: existing?.lang,
        speakerRole: isUser ? 'user' : 'assistant',
        speakerName: isUser ? userName : character.name,
    };
};

/** Only read an already existing attachment; a missing attachment stays absent. */
export const readExistingVoiceFavoriteAudio = async (existing?: ExistingVoiceSnapshot | null): Promise<Blob | null> => {
    if (existing?.blob instanceof Blob && existing.blob.size > 0) return existing.blob;
    const url = existing?.url || existing?.remoteUrl;
    if (!url) return null;
    try {
        return await fetchBlobForShare(url, 'audio/mpeg');
    } catch { return null; }
};
// [EM-END: text-voice-favorites]
