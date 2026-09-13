/** 当前设备上的私聊与群聊共用的输入习惯。 */
export interface ChatInputPreferences {
    /** 固定交互；保留字段兼容旧备份，不再作为用户开关。 */
    sendButtonGenerates: true;
    enterToSend: boolean;
    autoReply: boolean;
    emojiSuggestions: boolean;
}

export const CHAT_INPUT_PREFERENCES_CHANGED_EVENT = 'lilium:chat-input-preferences-changed';

export const CHAT_INPUT_PREFERENCES_KEY = 'sully-chat-input-preferences-v1';

export const DEFAULT_CHAT_INPUT_PREFERENCES: ChatInputPreferences = {
    sendButtonGenerates: true,
    enterToSend: true,
    autoReply: false,
    emojiSuggestions: false,
};

/** 导入与读取共用；旧存档的按钮开关统一迁移为当前固定交互。 */
export const normalizeChatInputPreferences = (value: unknown): ChatInputPreferences => {
    const saved = value && typeof value === 'object' ? value as Partial<ChatInputPreferences> : {};
    return {
        sendButtonGenerates: true,
        enterToSend: saved.enterToSend !== false,
        autoReply: saved.autoReply === true,
        emojiSuggestions: saved.emojiSuggestions === true,
    };
};

export const loadChatInputPreferences = (): ChatInputPreferences => {
    try {
        const saved = JSON.parse(localStorage.getItem(CHAT_INPUT_PREFERENCES_KEY) || 'null');
        return normalizeChatInputPreferences(saved);
    } catch {
        return { ...DEFAULT_CHAT_INPUT_PREFERENCES };
    }
};

export const saveChatInputPreferences = (preferences: ChatInputPreferences): void => {
    try {
        localStorage.setItem(CHAT_INPUT_PREFERENCES_KEY, JSON.stringify(normalizeChatInputPreferences(preferences)));
        window.dispatchEvent(new Event(CHAT_INPUT_PREFERENCES_CHANGED_EVENT));
    } catch {
        // 存储不可用的 WebView 中仍允许在当前会话使用。
    }
};
