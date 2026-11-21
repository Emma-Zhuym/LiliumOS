import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { CharacterProfile, Message, DateState, DialogueItem, UserProfile, DateObservation } from '../../types';
import Modal from '../../components/os/Modal';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import MeetSettings from './MeetSettings'; // [EM: meet-redesign]
import ObserveHUD from './ObserveHUD';
import { extractObservation, hasObservation } from '../../utils/datePrompts';
import { useBlobRefUrl } from '../../utils/blobRef';
import TokenImg from '../os/TokenImg';
import { clearDateResumeAttempt } from '../../utils/dateSessionRecovery';
import { cleanTextForTts, VALID_EMOTIONS } from '../../utils/minimaxTts';
import { synthesizeSpeech, characterHasVoice } from '../../utils/ttsRouter';
import { resolveTtsProvider } from '../../utils/ttsProvider';
import { cleanTextForTtsFish } from '../../utils/fishAudioTts';
import { planNovelLoadMore } from '../../utils/dateSessionHistory';
import { getPendingReplyText } from '../../utils/pendingReply';
import { MEETING_CONTINUE_DISPLAY_TEXT } from '../../utils/meetingContinue';
// [EM-START: text-voice-favorites]
import { useVoiceFavoriteMenu, type VoiceFavoriteTarget } from '../../hooks/useVoiceFavoriteMenu';
import { useVoiceFavoriteGesture } from '../../hooks/useVoiceFavoriteGesture';
import VoiceFavoriteActionSheet from '../voice/VoiceFavoriteActionSheet';
import { resolveCurrentDateVoiceLine } from '../../utils/dateVoiceSource';
// [EM-END: text-voice-favorites]
// [EM-START: meet-longform]
import MeetLongformReader from './MeetLongformReader';
import { isMeetLongform, lastLongformEmotion } from '../../utils/emMeetLongform';
// [EM-END: meet-longform]

// 语音情绪标记 [v:xxx]：跟立绘情绪 [emotion] 分开的独立通道。立绘的 happy 是
// 夸张的表情、语音的 happy 是音色情绪，两者强度/语义差异大，不能一概而论。
// 所以语音情绪由 LLM 用 [v:xxx] 单独标，没标就不传（让 MiniMax 自然朗读）。
// 从一行里抽出 [v:xxx]，返回 { voiceEmotion, rest（已剥掉该标记的文本）}。
const VOICE_EMOTION_TAG_RE = /\[v:\s*([a-zA-Z]+)\s*\]/i;
const extractVoiceEmotionTag = (line: string): { voiceEmotion?: string; rest: string } => {
    let voiceEmotion: string | undefined;
    const rest = line.replace(VOICE_EMOTION_TAG_RE, (_m, e: string) => {
        const k = (e || '').toLowerCase();
        if (VALID_EMOTIONS.has(k)) voiceEmotion = k;
        return '';
    });
    return { voiceEmotion, rest };
};

// Helper: Parse dialogue with simple state machine
const isContextNoise = (line: string) => {
    const l = line.trim().toLowerCase();
    if (l.startsWith('(') && l.endsWith(')')) {
        if (l.includes('in person') || l.includes('face-to-face') || l.includes('location') || l.includes('time')) return true;
    }
    if (l.startsWith('[system') || l.startsWith('(system')) return true;
    return false;
};

// Helper: Strip emotion tags like [shy], [happy] for pure text display
const cleanTextForDisplay = (text: string) => {
    // Remove content inside brackets [] and trim extra spaces
    // Also remove typical system prompts if any leak through
    return text.replace(/\[.*?\]/g, '').trim();
};

// Helper: Check if a line is dialogue (starts with quoted speech "...")
// A dialogue line must BEGIN with a quote character (after trimming).
// Lines that merely contain incidental quotes (e.g. 把"项圈草图"塞进...) are narration.
const isDialogueLine = (text: string) => {
    const clean = cleanTextForDisplay(text);
    return /^[""\u201C\u300C]/.test(clean);
};

// Helper: Extract only the dialogue text from a line for TTS
const extractDialogueText = (text: string): string => {
    const clean = cleanTextForDisplay(text);
    const matches = clean.match(/["\u201C]([^"\u201D]*)["\u201D]/g)
        || clean.match(/[\u300C]([^\u300D]*)[\u300D]/g);
    if (matches) {
        return matches.map(m => m.replace(/["\u201C\u201D\u300C\u300D]/g, '')).join(' ');
    }
    return clean;
};

const parseDialogue = (fullText: string, initialEmotion: string = 'normal'): DialogueItem[] => {
    if (!fullText) return [];
    const lines = fullText.split('\n').map(l => l.trim());
    const results: DialogueItem[] = [];
    let currentEmotion = initialEmotion;

    for (const [sourceLineIndex, rawLine] of lines.entries()) {
        if (isContextNoise(rawLine)) continue;
        // 先把独立的语音情绪标记 [v:xxx] 抽出来（跟立绘情绪互不影响），再解析立绘标签
        const { voiceEmotion, rest } = extractVoiceEmotionTag(rawLine);
        const line = rest.trim();
        if (!line) continue;
        const tagMatch = line.match(/^\[([a-zA-Z0-9_\-]+)\]\s*(.*)/);
        let content = line;

        if (tagMatch) {
            currentEmotion = tagMatch[1].toLowerCase();
            content = tagMatch[2];
        } else {
            const standaloneTag = line.match(/^\[([a-zA-Z0-9_\-]+)\]$/);
            if (standaloneTag) {
                currentEmotion = standaloneTag[1].toLowerCase();
                continue;
            }
        }
        if (content) {
            results.push({ text: content, emotion: currentEmotion, voiceEmotion, sourceLineIndex });
        }
    }
    return results;
};

interface DateSessionProps {
    char: CharacterProfile;
    userProfile: UserProfile;
    messages: Message[]; // The DB messages for history/novel mode
    peekStatus: string;  // Initial text from the Peek phase
    initialState?: DateState; // Resume state
    onSendMessage: (text: string, kind?: 'continue') => Promise<string>; // Returns AI content
    onReroll: () => Promise<string>;
    onExit: (currentState: DateState) => void;
    onEditMessage: (msg: Message) => void;
    onDeleteMessage: (msg: Message) => void;
    onDeleteMessages: (ids: number[]) => Promise<void>;
    onSettings: () => void;
    /** 阅读模式「加载更早」铺满已加载部分后，回库里取下一批（limit 递增式重取）。 */
    onLoadMoreHistory?: (nextLimit: number) => Promise<void>;
    /** 当前查询用的 limit（配合 onLoadMoreHistory 递增）。 */
    historyLoadLimit?: number;
    /** 库里的见面记录是否已经取完。 */
    historyReachedEnd?: boolean;
}

// Long replies can expand into many DOM lines. Keeping a smaller reading window
// materially reduces iOS WebKit content-process crashes while older entries
// remain available through the existing "加载更早" button.
const NOVEL_MESSAGE_WINDOW_SIZE = 40;
/** 铺满已加载部分后，每次回库多取多少条见面消息。 */
const NOVEL_HISTORY_FETCH_STEP = 220;
const NOVEL_MESSAGE_LOAD_STEP = 40;
const REQUIRED_EMOTIONS_SET = ['normal', 'happy', 'angry', 'sad', 'shy'];

const DateSession: React.FC<DateSessionProps> = ({ 
    onLoadMoreHistory,
    historyLoadLimit = 0,
    historyReachedEnd = true,
    char, 
    userProfile,
    messages, 
    peekStatus, 
    initialState,
    onSendMessage, 
    onReroll, 
    onExit,
    onEditMessage,
    onDeleteMessage,
    onDeleteMessages,
    onSettings
}) => {
    const { addToast, registerBackHandler, apiConfig, updateCharacter } = useOS();
    
    // Core VN State
    const [bgImage, setBgImage] = useState<string>(char.dateBackground || '');
    // bgImage state 里存的一直是原始字段值（令牌 / data: / 外链），只在渲染这一刻解析成能喂 CSS 的 url
    const bgImageUrl = useBlobRefUrl(bgImage);
    const [currentSprite, setCurrentSprite] = useState<string>('');
    const [currentSpriteKey, setCurrentSpriteKey] = useState<string>('');
    const [spriteConfig, setSpriteConfig] = useState(char.spriteConfig || { scale: 1, x: 0, y: 0 });
    
    // Dialogue Engine State
    const [dialogueQueue, setDialogueQueue] = useState<DialogueItem[]>([]);
    const [dialogueBatch, setDialogueBatch] = useState<DialogueItem[]>([]); // For replaying current batch
    const [currentText, setCurrentText] = useState('');
    const [displayedText, setDisplayedText] = useState('');
    const [isTextAnimating, setIsTextAnimating] = useState(false);

    // 观测协议 OBSERVE：当前批次解析出的结构化观测，驱动全息 HUD
    const observeEnabled = !!char.dateObserve?.enabled;
    const [observation, setObservation] = useState<DateObservation | null>(initialState?.observation ?? null);
    
    // Interaction State
    const [input, setInput] = useState('');
    const [showInputBox, setShowInputBox] = useState(false);
    const [isTyping, setIsTyping] = useState(false); // Waiting for API
    const [isShowingOpening, setIsShowingOpening] = useState(!initialState); // True until first user interaction
    const [showExitModal, setShowExitModal] = useState(false);
    // API 失败时本地记住本轮输入，不依赖父组件的 DB 刷新是否已经完成；用户可直接点重试。
    const [pendingRetryText, setPendingRetryText] = useState('');

    useEffect(() => {
        if (!getPendingReplyText(messages)) setPendingRetryText('');
    }, [messages]);
    
    // Settings Overlay State (Internal)
    const [showSettings, setShowSettings] = useState(false);

    // 顶栏折叠菜单：常驻只留「输入」+「菜单」两钮，低频操作全收进来
    const [showMenu, setShowMenu] = useState(false);

    // Edit Msg Logic
    const [modalType, setModalType] = useState<'none' | 'options'>('none');
    const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);

    // Voice TTS — single shared cache keyed by dialogue text, used by both GAL & novel mode
    const [dateVoicePlaying, setDateVoicePlaying] = useState(false);
    const [galVoiceLoading, setGalVoiceLoading] = useState(false);
    const [showVoiceLangPicker, setShowVoiceLangPicker] = useState(false);
    const voiceCacheRef = useRef<Record<string, string>>({});
    const voiceSnapshotCacheRef = useRef<Record<string, { url: string; spokenText: string; lang?: string }>>({}); // [EM: text-voice-favorites]
    const [novelVisibleCount, setNovelVisibleCount] = useState(NOVEL_MESSAGE_WINDOW_SIZE);
    const dateAudioRef = useRef<HTMLAudioElement | null>(null);
    const voiceEnabled = !!char.dateVoiceEnabled;
    const voiceLang = char.dateVoiceLang || '';
    // Bridges the current line's VOICE emotion ([v:xxx], 跟立绘情绪分开) to the GAL
    // voice effect (which keys off currentText only). undefined = 不传情绪，自然朗读。
    // A ref so it doesn't churn the effect's deps.
    const currentLineEmotionRef = useRef<string | undefined>(undefined);

    const VOICE_LANG_LABELS: Record<string, string> = { en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', es: 'Español' };
    const VOICE_LANG_OPTIONS = [{v:'',l:'默认'},{v:'en',l:'EN'},{v:'ja',l:'JP'},{v:'ko',l:'KR'},{v:'fr',l:'FR'},{v:'es',l:'ES'}];

    const translateAndSpeak = async (text: string, emotion?: string): Promise<string | null> => {
        if (!characterHasVoice(char, apiConfig)) return null;
        try {
            // 鱼声保留 inline cue，用 Fish 专属清洗；MiniMax 走原来的清洗。
            let ttsText = resolveTtsProvider(apiConfig) === 'fishaudio' ? cleanTextForTtsFish(text) : cleanTextForTts(text);
            if (!ttsText || ttsText.length < 2) return null;
            if (voiceLang) {
                const langLabel = VOICE_LANG_LABELS[voiceLang] || voiceLang;
                try {
                    const transRes = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                        body: JSON.stringify({
                            model: apiConfig.model,
                            messages: [{ role: 'system', content: `Translate the following text to ${langLabel}. Output ONLY the translation, nothing else.` }, { role: 'user', content: ttsText }],
                            temperature: 0.3,
                        }),
                    });
                    const transData = await transRes.json();
                    const translated = transData?.choices?.[0]?.message?.content?.trim();
                    if (translated) ttsText = translated;
                } catch { /* use original */ }
            }
            const url = await synthesizeSpeech(ttsText, char, apiConfig, {
                languageBoost: voiceLang || undefined,
                groupId: apiConfig.minimaxGroupId || undefined,
                emotion,
            });
            if (url) voiceSnapshotCacheRef.current[text] = { url, spokenText: cleanTextForDisplay(ttsText), lang: voiceLang || undefined }; // [EM: text-voice-favorites]
            return url;
        } catch (err: any) {
            console.warn('Date TTS failed:', err?.message);
            return null;
        }
    };

    // GAL mode: auto-play voice only for dialogue lines (quoted text), stop previous on advance
    // Uses cache so replaying the same line doesn't re-fetch
    useEffect(() => {
        if (!voiceEnabled || !currentText || isTyping) return;
        // Stop any currently playing audio when text changes (advancing to next line)
        if (dateAudioRef.current) {
            dateAudioRef.current.pause();
            dateAudioRef.current.currentTime = 0;
            setDateVoicePlaying(false);
        }
        setGalVoiceLoading(false);
        // Skip voice during opening phase and for non-dialogue lines
        if (isShowingOpening) return;
        if (!isDialogueLine(currentText)) return;
        let cancelled = false;
        const dialogueText = extractDialogueText(currentText);
        const cacheKey = dialogueText;
        const play = async () => {
            // Check cache first
            let url = voiceCacheRef.current[cacheKey];
            if (!url) {
                setGalVoiceLoading(true);
                url = await translateAndSpeak(dialogueText, currentLineEmotionRef.current) || '';
                if (cancelled) return;
                setGalVoiceLoading(false);
                if (!url) return;
                voiceCacheRef.current[cacheKey] = url;
            }
            if (cancelled) return;
            if (!dateAudioRef.current) dateAudioRef.current = new Audio();
            dateAudioRef.current.src = url;
            dateAudioRef.current.onended = () => setDateVoicePlaying(false);
            dateAudioRef.current.play().catch(() => {});
            setDateVoicePlaying(true);
        };
        play();
        return () => { cancelled = true; setGalVoiceLoading(false); if (dateAudioRef.current) { dateAudioRef.current.pause(); } };
    }, [currentText, voiceEnabled]);

    // GAL mode: manual play/pause for the current dialogue line
    const handleGalVoiceToggle = async () => {
        if (!currentText || !isDialogueLine(currentText)) return;
        // If playing, pause
        if (dateVoicePlaying && dateAudioRef.current) {
            dateAudioRef.current.pause();
            setDateVoicePlaying(false);
            return;
        }
        const dialogueText = extractDialogueText(currentText);
        const cacheKey = dialogueText;
        let url = voiceCacheRef.current[cacheKey];
        if (!url) {
            setGalVoiceLoading(true);
            url = await translateAndSpeak(dialogueText, currentLineEmotionRef.current) || '';
            setGalVoiceLoading(false);
            if (!url) { addToast('语音合成失败，请稍后重试', 'error'); return; }
            voiceCacheRef.current[cacheKey] = url;
        }
        if (!dateAudioRef.current) dateAudioRef.current = new Audio();
        dateAudioRef.current.src = url;
        dateAudioRef.current.onended = () => setDateVoicePlaying(false);
        dateAudioRef.current.play().catch(() => {});
        setDateVoicePlaying(true);
    };

    // [EM-START: text-voice-favorites]
    const voiceFavoriteMenu = useVoiceFavoriteMenu(addToast);
    const bindVoiceFavorite = useVoiceFavoriteGesture();
    const voiceBatchMessageIdRef = useRef(initialState?.voiceBatchMessageId);
    const voiceBatchStartedAtRef = useRef(initialState?.voiceBatchStartedAt || initialState?.timestamp || Date.now());
    const dateVoiceTarget = (sourceKey: string, originalText: string, sourceTimestamp: number): VoiceFavoriteTarget => {
        const existing = voiceSnapshotCacheRef.current[originalText];
        return {
            snapshot: { source: 'date', sourceKey, originalText, sourceTimestamp, charId: char.id, charName: char.name,
                speakerRole: 'assistant', speakerName: char.name, spokenText: existing?.spokenText !== originalText ? existing?.spokenText : undefined, language: existing?.lang },
            audio: existing || { url: voiceCacheRef.current[originalText] },
        };
    };
    const resolveDateVoiceBatchMessage = () => {
        if (!dialogueBatch.length) return null;
        for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            if (message.role !== 'assistant' || message.metadata?.isOpening) continue;
            if (voiceBatchMessageIdRef.current !== undefined ? message.id !== voiceBatchMessageIdRef.current : message.timestamp > voiceBatchStartedAtRef.current) continue;
            const { rest } = extractObservation(message.content || '', { lenient: observeEnabled, custom: char.dateObserve?.custom });
            const parsed = parseDialogue(rest);
            if (parsed.length === dialogueBatch.length && parsed.every((line, i) => line.text === dialogueBatch[i].text)) return { message, parsed };
        }
        return null;
    };
    const currentDateVoiceTarget = (): VoiceFavoriteTarget | null => {
        if (!isDialogueLine(currentText)) return null;
        const text = extractDialogueText(currentText);
        // Use the position in the complete current batch: repeated dialogue such
        // as two separate “嗯” lines must not point to the last matching line.
        const currentIndex = dialogueBatch.length - dialogueQueue.length - 1;
        if (currentIndex < 0 || dialogueBatch[currentIndex]?.text !== currentText) return null;
        const source = resolveDateVoiceBatchMessage();
        if (!source) return null;
        const lineIndex = resolveCurrentDateVoiceLine(source.parsed, dialogueBatch, dialogueQueue.length, currentText);
        if (lineIndex !== null) return dateVoiceTarget(`${char.id}:${source.message.id}-${lineIndex}`, text, source.message.timestamp);
        return null;
    };
    // [EM-END: text-voice-favorites]

    // Back Handler
    useEffect(() => {
        const unregister = registerBackHandler(() => {
            if (voiceFavoriteMenu.target) { voiceFavoriteMenu.close(); return true; }
            if (showSettings) {
                setShowSettings(false);
                return true;
            }
            if (showMenu) {
                setShowMenu(false);
                setShowVoiceLangPicker(false);
                return true;
            }
            if (showExitModal) {
                setShowExitModal(false);
                return true;
            }
            setShowExitModal(true);
            return true;
        });
        return unregister;
    }, [showSettings, showMenu, showExitModal, registerBackHandler, voiceFavoriteMenu.target, voiceFavoriteMenu.close]);

    const dateEmotionKeys = [...REQUIRED_EMOTIONS_SET, ...(char.customDateSprites || [])];

    const getSpritesForSkin = (skinId?: string): Record<string, string> => {
        const explicitSkin = skinId && char.dateSkinSets?.find(s => s.id === skinId);
        if (explicitSkin && Object.keys(explicitSkin.sprites || {}).length > 0) return explicitSkin.sprites;
        if (char.activeSkinSetId && char.dateSkinSets) {
            const activeSkin = char.dateSkinSets.find(s => s.id === char.activeSkinSetId);
            if (activeSkin && Object.keys(activeSkin.sprites || {}).length > 0) return activeSkin.sprites;
        }
        return char.sprites || {};
    };

    const activeSprites = React.useMemo(() => getSpritesForSkin(), [char.activeSkinSetId, char.dateSkinSets, char.sprites]);

    const pickFallbackSprite = (sprites: Record<string, string>) => {
        const key = ['normal', 'default', ...dateEmotionKeys].find(k => sprites[k]);
        const stray = Object.entries(sprites).find(([k, v]) => k !== 'chibi' && v);
        return { key: key || stray?.[0] || '', src: (key && sprites[key]) || stray?.[1] || char.avatar || '' };
    };

    // 拿立绘的「字段值」反查它是哪个情绪键，靠的是跟 sprites 表里的值逐字相等。
    // 所以 currentSprite state 里必须一直是原始字段值（blobref 令牌 / data: / 外链），
    // 解析成 objectURL 只能发生在渲染那一刻（交给 TokenImg），否则这里永远查不到键。
    const inferSpriteKey = (src?: string, skinId?: string): string => {
        if (!src) return '';
        const sprites = getSpritesForSkin(skinId);
        return Object.entries(sprites).find(([, value]) => value === src)?.[0] || '';
    };

    const resolveSpriteByKey = (key?: string, skinId?: string) => {
        const sprites = getSpritesForSkin(skinId);
        if (key && sprites[key]) return { key, src: sprites[key] };
        return pickFallbackSprite(sprites);
    };

    const resolveSpriteFromState = (state: DateState) => {
        const bySavedKey = resolveSpriteByKey(state.currentSpriteKey, state.activeSkinSetId);
        if (state.currentSpriteKey && bySavedKey.src) return bySavedKey;
        const legacyKey = inferSpriteKey(state.currentSprite, state.activeSkinSetId) || inferSpriteKey(state.currentSprite);
        if (legacyKey) return resolveSpriteByKey(legacyKey, state.activeSkinSetId);
        const fallback = resolveSpriteByKey(undefined, state.activeSkinSetId);
        return { key: fallback.key, src: state.currentSprite || fallback.src };
    };

    // Filter messages for Novel Mode: Show only current session
    // Logic: Find the LAST message with `isOpening: true`. Show all messages from there onwards.
    const sessionMessages = React.useMemo(() => {
        const openingIndex = messages.map(m => m.metadata?.isOpening).lastIndexOf(true);
        if (openingIndex !== -1) {
            return messages.slice(openingIndex);
        }
        // Fallback: If no opening found (legacy data), show all
        return messages;
    }, [messages]);

    const visibleSessionMessages = React.useMemo(() => {
        return sessionMessages.slice(-novelVisibleCount);
    }, [sessionMessages, novelVisibleCount]);
    const hiddenNovelMessageCount = Math.max(0, sessionMessages.length - visibleSessionMessages.length);

    useEffect(() => {
        setNovelVisibleCount(NOVEL_MESSAGE_WINDOW_SIZE);
    }, [char.id]);

    // Initialization
    useEffect(() => {
        if (initialState) {
            // Resume: 新快照只保存 sprite key，不再复制 base64；旧快照的 bg/currentSprite 仍兼容读取一次。
            const restoredSprite = resolveSpriteFromState(initialState);
            setBgImage(char.dateBackground || initialState.bgImage || '');
            setCurrentSprite(restoredSprite.src);
            setCurrentSpriteKey(restoredSprite.key);
            setCurrentText(initialState.currentText || '');
            setDisplayedText(initialState.currentText || '');
            setDialogueQueue(Array.isArray(initialState.dialogueQueue) ? initialState.dialogueQueue : []);
            setDialogueBatch(Array.isArray(initialState.dialogueBatch) ? initialState.dialogueBatch : []);
        } else {
            // New Session - pick initial sprite from active skin set or default sprites
            const initialSprite = pickFallbackSprite(activeSprites);
            setCurrentSprite(initialSprite.src);
            setCurrentSpriteKey(initialSprite.key);
            
            // Parse Peek Status as opening — 先剥出观测块（开了 OBSERVE 才有）
            const startText = peekStatus || "Waiting for connection...";
            const { observation: peekObs, rest: peekRest } = extractObservation(startText, { lenient: observeEnabled, custom: char.dateObserve?.custom });
            if (hasObservation(peekObs)) setObservation(peekObs);
            const items = parseDialogue(peekRest, 'normal');
            setDialogueBatch(items);
            setDialogueQueue(items);
            
            if (items.length > 0) {
                // Manually trigger first item processing
                const first = items[0];
                setCurrentText(first.text);
                currentLineEmotionRef.current = first.voiceEmotion;
                // Note: Not setting sprite here because useEffect below will handle emotion->sprite mapping if needed,
                // or we rely on default.
                setDialogueQueue(items.slice(1));
            }
        }
    }, []); // Run once on mount

    // Sprite & Config Sync (If user goes to settings and comes back, this helps)
    useEffect(() => {
        if (char.spriteConfig) setSpriteConfig(char.spriteConfig);
        if (char.dateBackground || !initialState?.bgImage) setBgImage(char.dateBackground || '');
        if (currentSpriteKey) {
            const resolved = resolveSpriteByKey(currentSpriteKey);
            if (resolved.src) setCurrentSprite(resolved.src);
        }
    }, [char, currentSpriteKey]);

    // Typewriter effect
    useEffect(() => {
        if (!currentText) return;
        setIsTextAnimating(true);
        setDisplayedText('');
        let i = 0;
        const timer = setInterval(() => {
            setDisplayedText(currentText.substring(0, i + 1));
            i++;
            if (i >= currentText.length) {
                clearInterval(timer);
                setIsTextAnimating(false);
            }
        }, 20);
        return () => clearInterval(timer);
    }, [currentText]);

    // --- Logic ---

    const processNextDialogue = (item: DialogueItem, remaining: DialogueItem[]) => {
        setCurrentText(item.text);
        currentLineEmotionRef.current = item.voiceEmotion;
        if (item.emotion && activeSprites) {
            const emotionKey = item.emotion.toLowerCase();
            if (dateEmotionKeys.includes(emotionKey)) {
                const nextSprite = activeSprites[emotionKey];
                if (nextSprite) {
                    setCurrentSprite(nextSprite);
                    setCurrentSpriteKey(emotionKey);
                }
            } else {
                const found = dateEmotionKeys.find(k => emotionKey.includes(k));
                if (found && activeSprites[found]) {
                    setCurrentSprite(activeSprites[found]);
                    setCurrentSpriteKey(found);
                }
            }
        }
        setDialogueQueue(remaining);
    };

    // 立绘引擎（dialogueQueue / currentText / dialogueBatch）默认只在进会话或收到新回复时解析一次。
    // 若用户在阅读模式里编辑 / 重新生成了「最后一条 AI 回复」，messages 会更新、阅读模式即时反映，
    // 但立绘引擎不会自动重解析 —— 于是立绘停在旧文字、旧语音，感觉「没同步」。这里监听最后一条
    // assistant 消息的内容，变了就把当前批次重解析同步过来。首帧跳过（含 initialState 恢复的播放
    // 位置），isTyping 时也跳过（新回复交给 handleSend / handleRerollClick 处理，避免重复解析）。
    const lastAssistantContent = React.useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i]?.role === 'assistant') return messages[i].content || '';
        }
        return '';
    }, [messages]);
    const dialogueSyncMountRef = useRef(false);
    useEffect(() => {
        if (!dialogueSyncMountRef.current) { dialogueSyncMountRef.current = true; return; }
        if (isTyping || !lastAssistantContent) return;
        const { rest } = extractObservation(lastAssistantContent, { lenient: observeEnabled, custom: char.dateObserve?.custom });
        const items = parseDialogue(rest, 'normal');
        if (items.length === 0) return;
        voiceBatchMessageIdRef.current = [...messages].reverse().find(message => message.role === 'assistant')?.id;
        voiceBatchStartedAtRef.current = Date.now();
        setDialogueBatch(items);
        processNextDialogue(items[0], items.slice(1));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastAssistantContent]);

    const handleScreenClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, input, textarea, .control-panel')) return;
        // 菜单展开时，点击场景任意处先收起菜单，不推进对话
        if (showMenu) {
            setShowMenu(false);
            setShowVoiceLangPicker(false);
            return;
        }

        // Skip animation
        if (isTextAnimating) {
            setDisplayedText(currentText);
            setIsTextAnimating(false);
            return;
        }

        // Next item
        if (dialogueQueue.length > 0) {
            processNextDialogue(dialogueQueue[0], dialogueQueue.slice(1));
            return;
        }

        // Loop
        if (dialogueBatch.length > 0) {
            // Replay
addToast('重播对话', 'info');
            processNextDialogue(dialogueBatch[0], dialogueBatch.slice(1));
            return;
        }
    };

    const submitTurn = async (kind?: 'continue') => {
        if (isTyping) return;
        const inputText = input.trim();
        // 本地失败输入优先，DB 时间线兜底。这样即使父组件刷新尚未落到这一帧，重试键也不会失效。
        const retryText = pendingRetryText || getPendingReplyText(messages);
        if (kind !== 'continue' && !inputText && !retryText) return;
        const text = kind === 'continue' ? MEETING_CONTINUE_DISPLAY_TEXT : (inputText || retryText);
        if (kind !== 'continue' && inputText) {
            setInput('');
            setShowInputBox(false);
        }
        setIsTyping(true);
        setIsShowingOpening(false); // First user interaction - opening phase is over

        try {
            const aiContent = await onSendMessage(text, kind);
            // 先剥出观测块更新 HUD，再解析剩余正文
            const { observation: obs, rest } = extractObservation(aiContent, { lenient: observeEnabled, custom: char.dateObserve?.custom });
            if (hasObservation(obs)) setObservation(obs);
            const items = parseDialogue(rest, 'normal');
            voiceBatchMessageIdRef.current = undefined;
            voiceBatchStartedAtRef.current = Date.now();
            setDialogueBatch(items);
            setDialogueQueue(items);
            if (items.length > 0) {
                processNextDialogue(items[0], items.slice(1));
            }
            setPendingRetryText('');
        } catch (e: any) {
            // onSendMessage 内部含 API 调用 + 回复后处理, 抛错不一定是网络。用中性文案, 不误导成"连接中断"。
            setPendingRetryText(text);
            setCurrentText(`(出错了: ${e?.message || '未知错误'})`);
            setShowInputBox(true);
        } finally {
            setIsTyping(false);
        }
    };

    const handleSend = () => { void submitTurn(); };
    const handleContinue = () => { void submitTurn('continue'); };

    const handleRerollClick = async () => {
        if (isTyping) return;
        setIsTyping(true);
        try {
            const aiContent = await onReroll();
            const { observation: obs, rest } = extractObservation(aiContent, { lenient: observeEnabled, custom: char.dateObserve?.custom });
            if (hasObservation(obs)) setObservation(obs);
            const items = parseDialogue(rest, 'normal');
            voiceBatchMessageIdRef.current = undefined;
            voiceBatchStartedAtRef.current = Date.now();
            setDialogueBatch(items);
            setDialogueQueue(items);
            if (items.length > 0) processNextDialogue(items[0], items.slice(1));
        } catch(e: any) {
            // 父级 handleReroll 只抛不提示；这里不给反馈的话，点了「重新生成」
            // 没动静用户会以为没点上（旧版更糟：消息已被删还毫无提示）
            addToast(`重新生成失败: ${e?.message || '未知错误'}`, 'error');
        } finally {
            setIsTyping(false);
        }
    };

    const buildCurrentState = (): DateState => ({
        dialogueQueue,
        dialogueBatch,
        currentText,
        voiceBatchMessageId: voiceBatchMessageIdRef.current ?? resolveDateVoiceBatchMessage()?.message.id,
        voiceBatchStartedAt: voiceBatchStartedAtRef.current,
        // Keep recovery snapshots light: don't duplicate base64 background/sprite data here.
        // TODO(date-assets): migrate CharacterProfile dateBackground/sprites/dateSkinSets themselves
        // into the IndexedDB assets store and keep stable asset refs on the character.
        currentSpriteKey: currentSpriteKey || inferSpriteKey(currentSprite) || undefined,
        activeSkinSetId: char.activeSkinSetId,
        isNovelMode: false, // 小说页 2026-11-17 删了，字段留给旧存档
        timestamp: Date.now(),
        peekStatus,
        observation: observation || undefined,
    });

    const handleExitClick = () => {
        onExit(buildCurrentState());
    };

    // Auto-save: persist date state so refresh/close doesn't lose progress
    const stateRef = useRef<() => DateState>(buildCurrentState);
    stateRef.current = buildCurrentState;
    const charRef = useRef(char);
    charRef.current = char;

    useEffect(() => {
        // Direct DB save — works during beforeunload when React state updates are useless
        const saveStateToDB = () => {
            try {
                const state = stateRef.current();
                DB.saveCharacter({ ...charRef.current, savedDateState: state });
            } catch (e) { /* best-effort */ }
        };

        // beforeunload: catch page refresh / tab close
        const handleBeforeUnload = () => { saveStateToDB(); };
        // visibilitychange: catch tab switch / app background (more reliable on mobile)
        const handleVisibilityChange = () => { if (document.visibilityState === 'hidden') saveStateToDB(); };
        window.addEventListener('beforeunload', handleBeforeUnload);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Periodic auto-save every 30s
        const interval = setInterval(saveStateToDB, 30000);

        // 见面「继续上次」崩溃自愈：只要会话稳定挂载并渲染了一小段时间没崩，
        // 就撤销 DateApp 在恢复前武装的哨兵——证明这份快照能安全加载。若 iOS WebKit
        // 在此之前把内容进程撑崩（进程级崩溃，不会跑下面的卸载 cleanup），哨兵留存，
        // 下次进见面即被检出并丢弃这份有毒快照。新会话（无 initialState）无哨兵，clear 为空操作。
        const settleTimer = setTimeout(() => clearDateResumeAttempt(), 2500);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearInterval(interval);
            clearTimeout(settleTimer);
            // 干净卸载（SPA 内导航离开会话）= 非崩溃，撤销哨兵。
            clearDateResumeAttempt();
            // 卸载时只把进度直接落库，绝不调用 onExit。onExit 会执行「用户主动退出」的
            // 导航（setMode('select') + 弹「进度已保存」），而卸载在很多非用户意图的场景
            // 都会发生 —— 尤其 React.StrictMode (dev) 的「挂载→卸载→重挂载」探测：
            // 一进正式见面就被自己的卸载副作用导航回选择页，并弹两次「进度已保存」。
            // 直接 DB 持久化与其它自动保存路径（beforeunload / visibilitychange / 定时）一致。
            saveStateToDB();
        };
    }, []);

    // Determine if we can reroll (last message is assistant)
    const canReroll = messages.length > 0 && messages[messages.length - 1].role === 'assistant';

    // [EM-START: meet-longform] 长文模式：整段摊开读，人铺满、字在纸上；底下的立绘引擎照常跑（存档、恢复都不动）
    if (isMeetLongform(char)) {
        const longformEmotion = lastLongformEmotion(lastAssistantContent, dateEmotionKeys);
        const longformSprite = (longformEmotion && activeSprites[longformEmotion]) || currentSprite;
        return (
            <>
                <MeetLongformReader
                    char={char} userProfile={userProfile} messages={visibleSessionMessages}
                    hiddenCount={hiddenNovelMessageCount} canLoadMore={!historyReachedEnd}
                    onLoadMore={() => {
                        const plan = planNovelLoadMore({
                            loadedCount: sessionMessages.length, visibleCount: novelVisibleCount, windowStep: NOVEL_MESSAGE_LOAD_STEP,
                            loadLimit: historyLoadLimit, loadStep: NOVEL_HISTORY_FETCH_STEP, reachedDbEnd: historyReachedEnd,
                        });
                        setNovelVisibleCount(plan.nextVisibleCount);
                        if (plan.nextLoadLimit !== null) void onLoadMoreHistory?.(plan.nextLoadLimit);
                    }}
                    spriteSrc={longformSprite} input={input} setInput={setInput} isTyping={isTyping}
                    retryText={pendingRetryText || getPendingReplyText(messages)}
                    errorText={pendingRetryText && currentText.startsWith('(出错了') ? currentText : ''}
                    canReroll={canReroll} onSend={handleSend} onContinue={handleContinue} onReroll={() => void handleRerollClick()}
                    onOpenSettings={() => setShowSettings(true)} onSpriteMode={() => updateCharacter(char.id, { dateSpriteMode: true })} onExit={handleExitClick}
                    onEditMessage={onEditMessage} onDeleteMessage={onDeleteMessage} onDeleteMessages={onDeleteMessages /* [EM: meet-longform-multiselect] */}
                    onToast={(text, type) => addToast(text, type)} />
                {showSettings && (
                    <div className="absolute inset-0 z-[200] animate-slide-up bg-white">
                        <MeetSettings char={char} onBack={() => setShowSettings(false)} />
                    </div>
                )}
            </>
        );
    }
    // [EM-END: meet-longform]

    return (
        <div className="h-full w-full relative bg-black overflow-hidden font-sans select-none" onClick={handleScreenClick}>
            
            {/* Background Layer */}
            <div 
                className={`absolute inset-0 bg-cover bg-center transition-all duration-1000 opacity-80`} 
                style={{ backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : 'none' }}
            ></div>

            {/* Menu Layer — 继续按钮单独在左；菜单 / 输入上下叠在最右列。
                第二行的输入按钮贴右，避开阅读模式批量操作栏的中间区域。 */}
            <div className="absolute top-0 right-0 p-4 pt-12 z-[100] flex flex-col items-end gap-2 pointer-events-auto">
                <div className="flex items-start gap-3">
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowMenu(false); setShowVoiceLangPicker(false); handleContinue(); }}
                        disabled={isTyping}
                        className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center border bg-black/30 backdrop-blur-md border-white/20 text-white shadow-lg active:scale-95 transition-all hover:bg-white/20 disabled:opacity-40"
                        title={`本轮不主动行动，让${char.name}继续陪伴并推进见面`}
                        aria-label="继续当前见面"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd" /></svg>
                    </button>
                    <div className="flex flex-col gap-2">
                        <button onClick={(e) => { e.stopPropagation(); setShowMenu(prev => !prev); setShowVoiceLangPicker(false); }} className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all shadow-lg active:scale-95 ${showMenu ? 'bg-white text-black border-white' : 'bg-black/30 backdrop-blur-md border-white/20 text-white hover:bg-white/20'}`}>
                            {showMenu ? (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" /></svg>
                            )}
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowInputBox(!showInputBox); setShowMenu(false); setShowVoiceLangPicker(false); }}
                            className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all shadow-lg active:scale-95 ${showInputBox ? 'bg-primary border-primary text-white' : 'bg-black/30 backdrop-blur-md border-white/20 text-white hover:bg-white/20'}`}
                            title={showInputBox ? '收起输入框' : '展示输入框'}
                            aria-label={showInputBox ? '收起输入框' : '展示输入框'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                        </button>
                    </div>
                </div>

                {showMenu && (
                    <div className="flex flex-col items-end gap-1.5 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                        {!isTyping && canReroll && (
                            <button onClick={() => { setShowMenu(false); setShowVoiceLangPicker(false); handleRerollClick(); }} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-black/40 backdrop-blur-md border-white/15 text-white hover:bg-white/20">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                                重新生成
                            </button>
                        )}

                        {/* 语音：未开启时点击直接开启并展开语种；开启时点击展开/收起语种选择（含关闭项） */}
                        <button onClick={() => {
                                if (voiceEnabled) {
                                    setShowVoiceLangPicker(prev => !prev);
                                } else {
                                    updateCharacter(char.id, { dateVoiceEnabled: true });
                                    addToast('语音已开启', 'info');
                                    setShowVoiceLangPicker(true);
                                }
                            }}
                            className={`h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all backdrop-blur-md ${voiceEnabled ? 'bg-white/20 border-white/30 text-white' : 'bg-black/40 border-white/15 text-white/60 hover:bg-white/20'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                {voiceEnabled
                                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                                    : <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />}
                            </svg>
                            语音{voiceEnabled ? ((voiceLang && (VOICE_LANG_OPTIONS.find(o => o.v === voiceLang)?.l)) ? ` · ${VOICE_LANG_OPTIONS.find(o => o.v === voiceLang)?.l}` : ' · 开') : ' · 关'}
                        </button>
                        {voiceEnabled && showVoiceLangPicker && (
                            <div className="flex flex-wrap justify-end gap-1 max-w-[200px] animate-fade-in">
                                {VOICE_LANG_OPTIONS.map(opt => (
                                    <button key={opt.v} onClick={() => { updateCharacter(char.id, { dateVoiceLang: opt.v }); setShowVoiceLangPicker(false); }}
                                        className={`h-7 px-2.5 rounded-full text-[10px] font-bold transition-all active:scale-95 whitespace-nowrap ${voiceLang === opt.v ? 'bg-white/30 text-white shadow-md' : 'bg-black/30 backdrop-blur-md text-white/60 border border-white/10'}`}>
                                        {opt.l}
                                    </button>
                                ))}
                                <button onClick={() => { updateCharacter(char.id, { dateVoiceEnabled: false }); setShowVoiceLangPicker(false); addToast('语音已关闭', 'info'); }}
                                    className="h-7 px-2.5 rounded-full text-[10px] font-bold transition-all active:scale-95 whitespace-nowrap bg-red-500/50 text-white border border-red-300/40 shadow-md">
                                    关闭语音
                                </button>
                            </div>
                        )}

                        <button onClick={() => { setShowMenu(false); setShowVoiceLangPicker(false); updateCharacter(char.id, { dateSpriteMode: false }); }} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-black/40 backdrop-blur-md border-white/15 text-white hover:bg-white/20">{/* [EM: meet-redesign] */}
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
                            切到长文
                        </button>

                        

                        {/* 观测协议 OBSERVE 开关：开启后回复带「时间/地点/状态/细节」全息 HUD */}
                        <button onClick={() => {
                                const next = !observeEnabled;
                                updateCharacter(char.id, { dateObserve: { ...char.dateObserve, enabled: next } });
                                addToast(next ? '观测已开启 · 下条回复生效' : '观测已关闭', 'info');
                                setShowMenu(false); setShowVoiceLangPicker(false);
                            }}
                            className={`h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all backdrop-blur-md ${observeEnabled ? 'bg-cyan-400/20 border-cyan-300/40 text-cyan-50' : 'bg-black/40 border-white/15 text-white/60 hover:bg-white/20'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                            观测{observeEnabled ? ' · 开' : ' · 关'}
                        </button>

                        <button onClick={() => { setShowSettings(true); setShowMenu(false); setShowVoiceLangPicker(false); }} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-black/40 backdrop-blur-md border-white/15 text-white hover:bg-white/20">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 2.555c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.212 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-2.555c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                            见面设置{/* [EM: meet-redesign] */}
                        </button>

                        <button onClick={() => { setShowMenu(false); setShowVoiceLangPicker(false); setShowExitModal(true); }} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-red-500/70 backdrop-blur-md border-white/20 text-white hover:bg-red-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" /></svg>
                            离开
                        </button>
                    </div>
                )}
            </div>

            {/* 观测协议 OBSERVE — 立绘模式悬浮 HUD（左上角，独立查看可放大） */}
            {observeEnabled && hasObservation(observation) && (
                <div className="absolute top-0 left-0 p-4 pt-12 z-[90] pointer-events-none">
                    <div className="pointer-events-auto">
                        <ObserveHUD observation={observation!} variant="hud" charName={char.name} config={char.dateObserve} />
                    </div>
                </div>
            )}

            {/* Visual Mode View（小说页 2026-11-17 删了以后只剩这一种） */}
            <>
                    <div className="absolute inset-x-0 bottom-0 h-[90%] flex items-end justify-center pointer-events-none z-10 overflow-hidden">
                        {currentSprite && <TokenImg value={currentSprite} className="max-h-full max-w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] transition-all duration-300 origin-bottom" style={{ filter: showInputBox ? 'brightness(1)' : (isTextAnimating ? 'brightness(1.05)' : 'brightness(1)'), transform: `translate(${spriteConfig.x}%, ${spriteConfig.y}%) scale(${isTextAnimating ? spriteConfig.scale * 1.02 : spriteConfig.scale})` }} />}
                    </div>
                    {!isTyping && (
                        <div className="absolute inset-x-0 bottom-8 z-30 flex justify-center">
                            <div className="w-[90%] max-w-lg bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 min-h-[140px] shadow-2xl animate-slide-up hover:bg-black/70 cursor-pointer"
                                {...(!isTextAnimating && !isShowingOpening && isDialogueLine(currentText) ? bindVoiceFavorite(() => void voiceFavoriteMenu.open(currentDateVoiceTarget())) : {})}>
                                <div className="absolute -top-3 left-6 flex items-center gap-2">
                                    <div className="bg-white/90 text-black px-4 py-1 rounded-sm text-xs font-bold tracking-widest uppercase shadow-[0_4px_10px_rgba(0,0,0,0.3)] transform -skew-x-12">{char.name}</div>
                                    {/* Voice play button next to name */}
                                    {voiceEnabled && !isTextAnimating && !isShowingOpening && isDialogueLine(currentText) && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleGalVoiceToggle(); }}
                                            className={`w-6 h-6 rounded-full flex items-center justify-center transition-all active:scale-90 ${dateVoicePlaying ? 'bg-white/30 text-white/90' : 'bg-white/10 text-white/40 hover:bg-white/20'}`}
                                        >
                                            {galVoiceLoading ? (
                                                <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                                            ) : dateVoicePlaying ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z" /></svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" /></svg>
                                            )}
                                        </button>
                                    )}
                                </div>
                                <p className="text-white/90 text-[16px] leading-relaxed font-light tracking-wide drop-shadow-md mt-2">{displayedText}{isTextAnimating && <span className="inline-block w-2 h-4 bg-white/70 ml-1 animate-pulse align-middle"></span>}</p>
                                {!isTextAnimating && dialogueQueue.length > 0 && <div className="absolute bottom-3 right-4 animate-bounce opacity-70"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white"><path fillRule="evenodd" d="M12.53 16.28a.75.75 0 0 1-1.06 0l-7.5-7.5a.75.75 0 0 1 1.06-1.06L12 14.69l6.97-6.97a.75.75 0 1 1 1.06 1.06l-7.5 7.5Z" clipRule="evenodd" /></svg></div>}
                                {!isTextAnimating && dialogueQueue.length === 0 && dialogueBatch.length > 0 && <div className="absolute bottom-3 right-4 opacity-50 text-[10px] text-white flex items-center gap-1 animate-pulse"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>Loop</div>}
                            </div>
                        </div>
                    )}
                </>


            {/* Input Layer */}
            <div className={`absolute inset-x-0 bottom-0 z-40 flex justify-center pointer-events-none transition-all duration-300 ${isTyping || showInputBox ? 'opacity-100' : 'opacity-0'}`}>
                {isTyping && (
                    <div className="absolute bottom-1/2 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-auto">
                        <div className="bg-black/80 backdrop-blur-md px-6 py-3 rounded-full border border-white/20 shadow-2xl animate-pulse flex items-center gap-3">
                             <div className="flex gap-1.5"><div className="w-2 h-2 bg-white rounded-full animate-bounce"></div><div className="w-2 h-2 bg-white rounded-full animate-bounce delay-75"></div><div className="w-2 h-2 bg-white rounded-full animate-bounce delay-150"></div></div>
                             <span className="text-xs text-white font-bold tracking-widest uppercase">Typing...</span>
                        </div>
                    </div>
                )}
                {showInputBox && (
                    <div className={`w-[90%] max-w-lg backdrop-blur-xl rounded-2xl p-2 flex gap-2 shadow-2xl animate-fade-in mb-8 pointer-events-auto bg-white/10 border border-white/20`} onClick={(e) => e.stopPropagation()}>
                        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={isTyping ? "等待回应..." : "输入对话..."} disabled={isTyping} className={`min-w-0 flex-1 bg-transparent px-3 sm:px-4 py-3 outline-none font-light resize-none h-14 no-scrollbar leading-tight text-white placeholder:text-white/30`} autoFocus />
                        {(() => {
                            const retryText = pendingRetryText || getPendingReplyText(messages);
                            const canRetry = !input.trim() && !isTyping && !!retryText;
                            return (
                                <button
                                    onClick={handleSend}
                                    disabled={(!input.trim() && !canRetry) || isTyping}
                                    className="shrink-0 px-4 sm:px-6 bg-white text-black rounded-xl font-bold text-sm hover:bg-slate-200 disabled:opacity-50 transition-colors h-14 flex items-center justify-center"
                                >
                                    {canRetry ? '重试' : '发送'}
                                </button>
                            );
                        })()}
                    </div>
                )}
            </div>

            {/* Settings Overlay */}
            <VoiceFavoriteActionSheet open={!!voiceFavoriteMenu.target} favorited={voiceFavoriteMenu.favorited} busy={voiceFavoriteMenu.busy}
                title="见面语音" preview={voiceFavoriteMenu.target?.snapshot.originalText} onToggle={() => void voiceFavoriteMenu.toggle()} onClose={voiceFavoriteMenu.close}
                onMessageOptions={messages.some(message => voiceFavoriteMenu.target?.snapshot.sourceKey.startsWith(`${char.id}:${message.id}-`)) ? () => {
                    const message = messages.find(message => voiceFavoriteMenu.target?.snapshot.sourceKey.startsWith(`${char.id}:${message.id}-`));
                    if (message) { voiceFavoriteMenu.close(); setSelectedMessage(message); setModalType('options'); }
                } : undefined} />
            {showSettings && (
                <div className="absolute inset-0 z-[200] animate-slide-up bg-white">
                    <MeetSettings char={char} onBack={() => setShowSettings(false)} />
                </div>
            )}

            {/* Exit Modal */}
            <Modal isOpen={showExitModal} title="暂时离开?" onClose={() => setShowExitModal(false)} footer={<div className="flex gap-3 w-full"><button onClick={() => setShowExitModal(false)} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold">留在这里</button><button onClick={handleExitClick} className="flex-1 py-3 bg-slate-800 text-white rounded-2xl font-bold">保存并退出</button></div>}>
                <div className="text-center text-slate-500 text-sm py-2 leading-relaxed">选择“保存并退出”将保留当前对话进度。<br/>下次见面时，你可以选择继续话题。</div>
            </Modal>

            {/* Message Options Modal */}
            <Modal isOpen={modalType === 'options'} title="操作" onClose={() => setModalType('none')}>
                <div className="space-y-3">
                    <button onClick={() => {
                        if (selectedMessage) {
                            const clean = (selectedMessage.content || '').replace(/\[.*?\]/g, '').trim();
                            navigator.clipboard.writeText(clean).then(() => addToast('已复制', 'success')).catch(() => addToast('复制失败', 'error'));
                        }
                        setModalType('none');
                    }} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl">复制文本</button>
                    <button onClick={() => { onEditMessage(selectedMessage!); setModalType('none'); }} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl">编辑内容</button>
                    <button onClick={() => { onDeleteMessage(selectedMessage!); setModalType('none'); }} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl">删除记录</button>
                </div>
            </Modal>
        </div>
    );
};

export default DateSession;
