import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { PRESET_THEMES } from './ChatConstants';
import { resolveChatTheme } from '../../utils/groupChat/theme';
import { getVoiceFavoriteBlob } from '../../utils/voiceFavorites';
import type { MessageFavoriteEntry } from '../../utils/messageFavorites';
import type { Message } from '../../types';
import { F, STATUS } from '../../utils/clayTokens';
import MessageItem from './MessageItem';

const noop = () => {};
/** Reuse the Chat renderer. The only audio callback here reads a saved local attachment. */
export default function FavoriteMessageBody({ entry }: { entry: MessageFavoriteEntry }) {
    const { characters, customThemes, userProfile } = useOS();
    const char = characters.find(item => item.id === entry.charId);
    const theme = useMemo(() => resolveChatTheme(char?.bubbleStyle || 'default', customThemes, PRESET_THEMES), [char?.bubbleStyle, customThemes]);
    const [audioUrl, setAudioUrl] = useState('');
    const [playing, setPlaying] = useState(false);
    const [error, setError] = useState('');
    const player = useRef<HTMLAudioElement | null>(null);
    const playback = useRef(0);
    const urlRef = useRef('');
    useEffect(() => () => { playback.current++; player.current?.pause(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
    const voice = entry.voice;
    const message = useMemo(() => {
        if (entry.message && (entry.kind !== 'voice' || entry.message.metadata?.voice || /<[语語]音/.test(entry.message.content))) return entry.message;
        if (!voice) return entry.message;
        const original = voice.originalText || voice.translation || '';
        const spoken = voice.spokenText || original;
        return { id: -1, charId: entry.charId, timestamp: voice.sourceTimestamp, type: 'text', role: voice.speakerRole || 'assistant',
            content: voice.speakerRole === 'user' ? original : `<语音>${spoken}${voice.translation && voice.translation !== spoken ? `<字幕>${voice.translation}</字幕>` : ''}</语音>`,
            metadata: voice.speakerRole === 'user' ? { voice: true } : undefined } as Message;
    }, [entry.message, entry.kind, entry.charId, voice]);
    const play = async () => {
        if (playing) { playback.current++; player.current?.pause(); setPlaying(false); return; }
        if (voice?.audioState !== 'stored') return;
        const version = ++playback.current;
        const blob = await getVoiceFavoriteBlob(voice.id);
        if (version !== playback.current) return;
        if (!blob?.size) { setError('音频未随备份恢复，仍可转文字阅读。'); return; }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob); urlRef.current = url; setAudioUrl(url);
        player.current?.pause(); const audio = new Audio(url); player.current = audio;
        audio.onended = () => setPlaying(false);
        audio.onerror = () => { setPlaying(false); setError('音频无法播放，仍可转文字阅读。'); };
        try { await audio.play(); if (version === playback.current) setPlaying(true); else audio.pause(); }
        catch { if (version === playback.current) setError('音频无法播放，仍可转文字阅读。'); }
    };
    if (!message) return <p className="py-4 text-sm" style={{ color: F.textTertiary }}>旧版收藏没有可恢复的消息内容</p>;
    return <div className="min-w-0 pt-3" data-favorite-kind={entry.kind}>
        <MessageItem msg={message} activeTheme={theme} charAvatar={char?.avatar || ''} charName={entry.charName} userAvatar={userProfile.avatar || ''}
            isFirstInGroup isLastInGroup onLongPress={noop} onReply={noop} selectionMode={false} isSelected={false} onToggleSelect={noop}
            showTimestamp="never" suppressEntranceAnimation onPlayVoice={() => void play()} isVoicePlaying={playing}
            voiceData={audioUrl && voice ? { url: audioUrl, originalText: voice.originalText, spokenText: voice.spokenText, lang: voice.language } : undefined} />
        {error && <p role="alert" className="text-xs" style={{ color: STATUS.warning.ink }}>{error}</p>}
    </div>;
}
