import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_INPUT_PREFERENCES_KEY, CHAT_INPUT_PREFERENCES_CHANGED_EVENT, DEFAULT_CHAT_INPUT_PREFERENCES, loadChatInputPreferences, normalizeChatInputPreferences, saveChatInputPreferences } from './chatInputPreferences';

afterEach(() => { localStorage.removeItem(CHAT_INPUT_PREFERENCES_KEY); vi.unstubAllGlobals(); });
describe('shared input preferences and portable data', () => {
    it('uses the fixed composer interaction even when old backups disabled it', () => {
        expect(loadChatInputPreferences()).toEqual(DEFAULT_CHAT_INPUT_PREFERENCES);
        localStorage.setItem(CHAT_INPUT_PREFERENCES_KEY, 'broken');
        expect(loadChatInputPreferences()).toEqual(DEFAULT_CHAT_INPUT_PREFERENCES);
        expect(normalizeChatInputPreferences({ sendButtonGenerates: 'true', autoReply: 1 })).toEqual(DEFAULT_CHAT_INPUT_PREFERENCES);
        localStorage.setItem(CHAT_INPUT_PREFERENCES_KEY, JSON.stringify({ sendButtonGenerates: false }));
        expect(loadChatInputPreferences().sendButtonGenerates).toBe(true);
    });
    it('round-trips only supported flags and notifies another open chat', () => {
        const windowTarget = new EventTarget();
        const changed = vi.fn();
        windowTarget.addEventListener(CHAT_INPUT_PREFERENCES_CHANGED_EVENT, changed);
        vi.stubGlobal('window', windowTarget);
        const choices = { sendButtonGenerates: true as const, enterToSend: false, autoReply: true, emojiSuggestions: true };
        saveChatInputPreferences(choices);
        expect(changed).toHaveBeenCalledTimes(1);
        const backup = JSON.parse(JSON.stringify({ chatInputPreferences: loadChatInputPreferences() }));
        localStorage.clear();
        saveChatInputPreferences(backup.chatInputPreferences);
        expect(loadChatInputPreferences()).toEqual(choices);
    });
});
