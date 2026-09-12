// [EM-START: text-voice-favorites]
import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceFavorite, removeVoiceFavorite, saveVoiceFavorite, type SaveVoiceFavoriteInput } from '../utils/voiceFavorites';
import { readExistingVoiceFavoriteAudio, type ExistingVoiceSnapshot } from '../utils/voiceFavoriteSnapshot';

export interface VoiceFavoriteTarget {
    snapshot: Omit<SaveVoiceFavoriteInput, 'blob'>;
    audio?: ExistingVoiceSnapshot;
}

/** A menu can archive existing text/audio, but cannot ask any provider to create audio. */
export function useVoiceFavoriteMenu(notify: (message: string, type: 'success' | 'error' | 'info') => void) {
    const [target, setTarget] = useState<VoiceFavoriteTarget | null>(null);
    const [favorited, setFavorited] = useState(false);
    const [busy, setBusy] = useState(false);
    const saving = useRef(false);
    const version = useRef(0);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current++; }; }, []);
    const close = useCallback(() => { if (!saving.current) { version.current++; setTarget(null); setBusy(false); } }, []);
    const open = async (next: VoiceFavoriteTarget | null) => {
        if (!next || saving.current) return;
        const request = ++version.current;
        setTarget(next); setFavorited(false); setBusy(true);
        try {
            const saved = await getVoiceFavorite(next.snapshot.source, next.snapshot.sourceKey);
            if (mounted.current && request === version.current) setFavorited(!!saved);
        } catch (error) {
            if (mounted.current && request === version.current) { setTarget(null); notify(error instanceof Error ? error.message : '无法读取语音收藏，请重试', 'error'); }
        } finally { if (mounted.current && request === version.current) setBusy(false); }
    };
    const toggle = async () => {
        if (!target || busy || saving.current) return;
        saving.current = true; setBusy(true);
        const request = version.current;
        try {
            const { snapshot, audio } = target;
            // Re-read in case another tab changed this source while the menu was open.
            const saved = await getVoiceFavorite(snapshot.source, snapshot.sourceKey);
            if (saved) await removeVoiceFavorite(snapshot.source, snapshot.sourceKey);
            else await saveVoiceFavorite({ ...snapshot, blob: await readExistingVoiceFavoriteAudio(audio) });
            if (mounted.current && request === version.current) {
                setFavorited(!saved);
                notify(saved ? '已取消语音收藏' : '语音内容已收藏', 'success');
            }
        } catch (error) { if (mounted.current) notify(error instanceof Error ? error.message : '语音收藏失败，请重试', 'error'); }
        finally { saving.current = false; if (mounted.current && request === version.current) setBusy(false); }
    };
    return { target, favorited, busy, open, close, toggle };
}
// [EM-END: text-voice-favorites]
