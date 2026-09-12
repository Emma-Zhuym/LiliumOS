import { DB, openDB } from './db';

export const VOICE_FAVORITES_INDEX_ASSET_ID = 'voice_favorites_index_v1';
export const VOICE_FAVORITE_AUDIO_PREFIX = 'voice_favorite_audio_';
export const VOICE_FAVORITES_CHANGED_EVENT = 'sully:voice-favorites-changed';

export type VoiceFavoriteSource = 'chat' | 'call' | 'date';
export type VoiceFavoriteAudioState = 'none' | 'stored' | 'omitted'; // [EM: text-voice-favorites]

export interface VoiceFavorite {
    id: string;
    source: VoiceFavoriteSource;
    /** Stable identity inside the source app (message id, call bubble id, etc.). */
    sourceKey: string;
    charId: string;
    charName: string;
    sourceTimestamp: number;
    favoritedAt: number;
    originalText: string;
    spokenText?: string;
    translation?: string;
    language?: string;
    // [EM-START: text-voice-favorites]
    audioState: VoiceFavoriteAudioState;
    speakerRole?: 'user' | 'assistant';
    speakerName?: string;
    // [EM-END: text-voice-favorites]
}

export interface SaveVoiceFavoriteInput extends Omit<VoiceFavorite, 'id' | 'favoritedAt' | 'audioState'> {
    blob?: Blob | null; // [EM: text-voice-favorites]
    favoritedAt?: number;
}

export interface VoiceFavoriteIndex {
    version: 1;
    items: VoiceFavorite[];
}

interface VoiceFavoriteAudioAsset {
    blob: Blob;
    mimeType: string;
    savedAt: number;
}

let writeQueue: Promise<unknown> = Promise.resolve();

const withWriteLock = async <T>(work: () => Promise<T>): Promise<T> => {
    const next = writeQueue.then(work, work);
    writeQueue = next.catch(() => undefined);
    return next;
};

const isSource = (value: unknown): value is VoiceFavoriteSource => (
    value === 'chat' || value === 'call' || value === 'date'
);

const normalizeTimestamp = (value: unknown, fallback: number): number => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

const sanitizeFavorite = (value: unknown): VoiceFavorite | null => {
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<VoiceFavorite>;
    if (typeof item.id !== 'string' || !item.id) return null;
    if (!isSource(item.source)) return null;
    if (typeof item.sourceKey !== 'string' || !item.sourceKey) return null;
    if (typeof item.charId !== 'string' || typeof item.charName !== 'string') return null;
    const now = Date.now();
    return {
        id: item.id,
        source: item.source,
        sourceKey: item.sourceKey,
        charId: item.charId,
        charName: item.charName || '未知角色',
        sourceTimestamp: normalizeTimestamp(item.sourceTimestamp, now),
        favoritedAt: normalizeTimestamp(item.favoritedAt, now),
        originalText: typeof item.originalText === 'string' ? item.originalText : '',
        spokenText: typeof item.spokenText === 'string' && item.spokenText ? item.spokenText : undefined,
        translation: typeof item.translation === 'string' && item.translation ? item.translation : undefined,
        language: typeof item.language === 'string' && item.language ? item.language : undefined,
        // [EM-START: text-voice-favorites]
        // Old v1 entries always required audio. Missing state therefore means stored.
        audioState: item.audioState === 'none' || item.audioState === 'omitted' ? item.audioState : 'stored',
        speakerRole: item.speakerRole === 'user' ? 'user' : 'assistant',
        speakerName: typeof item.speakerName === 'string' ? item.speakerName : undefined,
        // [EM-END: text-voice-favorites]
    };
};

// [EM-START: text-voice-favorites]
const readIndex = (raw: Partial<VoiceFavoriteIndex> | VoiceFavorite[] | null): VoiceFavorite[] => {
    if (raw == null) return [];
    const items = Array.isArray(raw) ? raw : raw?.items;
    if (!Array.isArray(items)) throw new Error('语音收藏索引无法读取，原有收藏未改动');
    const parsed = items.map(sanitizeFavorite);
    if (parsed.some(item => !item)) throw new Error('语音收藏索引包含损坏条目，原有收藏未改动');
    return parsed as VoiceFavorite[];
};

const loadIndex = async (): Promise<VoiceFavorite[]> => readIndex(await DB.getAssetRaw(VOICE_FAVORITES_INDEX_ASSET_ID));

export const validateVoiceFavoriteIndex = (raw: VoiceFavoriteIndex): VoiceFavoriteIndex => {
    if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.items)) {
        throw new Error('语音收藏索引无法读取，原有收藏未改动');
    }
    return { version: 1, items: readIndex(raw) };
};

// Index and audio commit together; a second tab must read the latest index
// inside its write transaction rather than overwrite a stale snapshot.
const mutateFavorites = async <T>(work: (items: VoiceFavorite[], store: IDBObjectStore) => T): Promise<T> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('assets', 'readwrite');
        const store = tx.objectStore('assets');
        const request = store.get(VOICE_FAVORITES_INDEX_ASSET_ID);
        let result: T;
        let failure: unknown;
        request.onsuccess = () => {
            try { result = work(readIndex(request.result?.data ?? null), store); }
            catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => { notifyChanged(); resolve(result); };
        tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('语音收藏未保存，请重试'));
    });
};
// [EM-END: text-voice-favorites]

const notifyChanged = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VOICE_FAVORITES_CHANGED_EVENT));
};

/** A compact deterministic id keeps the audio asset key stable without storing text or names in it. */
export const makeVoiceFavoriteId = (source: VoiceFavoriteSource, sourceKey: string): string => {
    const input = `${source}\u0000${sourceKey}`;
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        a = Math.imul(a ^ code, 0x01000193);
        b = Math.imul(b ^ code, 0x85ebca6b);
    }
    return `${source}_${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
};

export const voiceFavoriteAudioAssetId = (favoriteId: string): string => `${VOICE_FAVORITE_AUDIO_PREFIX}${favoriteId}`;

export const sortVoiceFavorites = (items: VoiceFavorite[]): VoiceFavorite[] => (
    [...items].sort((a, b) => b.sourceTimestamp - a.sourceTimestamp || b.favoritedAt - a.favoritedAt || b.id.localeCompare(a.id))
);

/** Reads metadata only; no audio Blob is pulled into memory. */
export const listVoiceFavorites = async (): Promise<VoiceFavorite[]> => sortVoiceFavorites(await loadIndex());

export const getVoiceFavorite = async (source: VoiceFavoriteSource, sourceKey: string): Promise<VoiceFavorite | null> => {
    const id = makeVoiceFavoriteId(source, sourceKey);
    return (await loadIndex()).find(item => item.id === id) || null;
};

export const getVoiceFavoriteBlob = async (favoriteId: string): Promise<Blob | null> => {
    const raw = await DB.getAssetRaw(voiceFavoriteAudioAssetId(favoriteId)).catch(() => null) as VoiceFavoriteAudioAsset | Blob | null;
    if (raw instanceof Blob) return raw;
    return raw?.blob instanceof Blob ? raw.blob : null;
};

export const saveVoiceFavorite = async (input: SaveVoiceFavoriteInput): Promise<VoiceFavorite> => withWriteLock(async () => {
    const blob = input.blob instanceof Blob && input.blob.size > 0 ? input.blob : null; // [EM: text-voice-favorites]
    if (!blob && ![input.originalText, input.spokenText, input.translation].some(text => text?.trim())) {
        throw new Error('没有可收藏的语音文字或音频'); // [EM: text-voice-favorites]
    }
    const id = makeVoiceFavoriteId(input.source, input.sourceKey);
    const now = Date.now();
    return mutateFavorites((current, store) => { // [EM: text-voice-favorites]
    const existing = current.find(item => item.id === id);
    const favorite: VoiceFavorite = {
        id,
        source: input.source,
        sourceKey: input.sourceKey,
        charId: input.charId,
        charName: input.charName || '未知角色',
        sourceTimestamp: normalizeTimestamp(input.sourceTimestamp, now),
        favoritedAt: normalizeTimestamp(input.favoritedAt, existing?.favoritedAt || now),
        originalText: input.originalText || '',
        spokenText: input.spokenText || undefined,
        translation: input.translation || undefined,
        language: input.language || undefined,
        // [EM-START: text-voice-favorites]
        audioState: blob ? 'stored' : existing?.audioState || 'none',
        speakerRole: input.speakerRole || existing?.speakerRole || 'assistant',
        speakerName: input.speakerName || existing?.speakerName,
        // [EM-END: text-voice-favorites]
    };

    // [EM-START: text-voice-favorites]
    if (blob) store.put({ id: voiceFavoriteAudioAssetId(id), data: {
        blob,
        mimeType: blob.type || 'audio/mpeg',
        savedAt: now,
    } satisfies VoiceFavoriteAudioAsset });
    store.put({ id: VOICE_FAVORITES_INDEX_ASSET_ID, data: {
        version: 1, items: [favorite, ...current.filter(item => item.id !== id)],
    } satisfies VoiceFavoriteIndex });
    return favorite;
    });
    // [EM-END: text-voice-favorites]
});

export const removeVoiceFavorite = async (source: VoiceFavoriteSource, sourceKey: string): Promise<boolean> => (
    removeVoiceFavoriteById(makeVoiceFavoriteId(source, sourceKey))
);

// [EM-START: text-voice-favorites]
export const removeVoiceFavoriteById = async (favoriteId: string): Promise<boolean> => withWriteLock(() => mutateFavorites((current, store) => {
    if (!current.some(item => item.id === favoriteId)) return false;
    store.put({ id: VOICE_FAVORITES_INDEX_ASSET_ID, data: { version: 1, items: current.filter(item => item.id !== favoriteId) } satisfies VoiceFavoriteIndex });
    store.delete(voiceFavoriteAudioAssetId(favoriteId));
    return true;
}));
// [EM-END: text-voice-favorites]

export const voiceFavoriteSourceLabel = (source: VoiceFavoriteSource): string => ({
    chat: '聊天',
    call: '通话',
    date: '见面',
}[source]);
