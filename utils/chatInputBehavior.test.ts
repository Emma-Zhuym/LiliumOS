// @vitest-environment jsdom
import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatInputArea from '../components/chat/ChatInputArea';
import { useChatAutoReply } from '../hooks/useChatAutoReply';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('shared chat composer behavior', () => {
    const send = vi.fn(); const generate = vi.fn(); const panelAction = vi.fn();
    const renderComposer = (options: { enterToSend?: boolean; sendButtonGenerates?: boolean; suggestions?: boolean } = {}) => {
        send.mockReset(); generate.mockReset(); panelAction.mockReset();
        function Harness() {
            const [input, setInput] = useState('抱抱');
            return React.createElement(ChatInputArea, {
                input, setInput, isTyping: false, selectionMode: false, showPanel: 'none', setShowPanel: () => {},
                onSend: () => { send(); setInput(''); }, onGenerate: generate,
                onDeleteSelected: () => {}, selectedCount: 0,
                emojis: [{ name: '抱抱猫', url: 'https://media.example/hug.png' }],
                onPanelAction: panelAction, onImageSelect: () => {}, isSummarizing: false,
                onReroll: () => {}, canReroll: false,
                enterToSend: options.enterToSend, sendButtonGenerates: options.sendButtonGenerates,
                emojiSuggestionsEnabled: options.suggestions,
            });
        }
        act(() => root.render(React.createElement(Harness)));
        return container.querySelector('textarea')!;
    };
    const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

    it('keeps the default send behavior and honors Enter/Shift+Enter/composition', () => {
        const textarea = renderComposer();
        for (const init of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
            act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })));
        }
        expect(send).not.toHaveBeenCalled();
        act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
        expect(send).toHaveBeenCalledTimes(1);
        expect(generate).not.toHaveBeenCalled();
    });

    it('leaves Enter as a newline when disabled', () => {
        const textarea = renderComposer({ enterToSend: false });
        act(() => textarea.focus());
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        act(() => textarea.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
        expect(send).not.toHaveBeenCalled();
        act(() => button('发送文字').click());
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('retains a draft when outside click or Escape changes send into generate', () => {
        const textarea = renderComposer({ sendButtonGenerates: true });
        act(() => textarea.focus());
        expect(button('发送文字')).not.toBeNull();
        act(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
        expect(button('生成回复')).not.toBeNull();
        act(() => button('生成回复').click());
        expect(generate).toHaveBeenCalledTimes(1);
        expect(send).not.toHaveBeenCalled();
        expect(textarea.value).toBe('抱抱');
        act(() => textarea.focus());
        act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(button('生成回复')).not.toBeNull();
    });

    it('a pointer press while editing stays a send, without firing generation', () => {
        const textarea = renderComposer({ sendButtonGenerates: true });
        act(() => textarea.focus());
        const press = new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true });
        act(() => button('发送文字').dispatchEvent(press));
        expect(press.defaultPrevented).toBe(true);
        act(() => button('发送文字').click());
        expect(send).toHaveBeenCalledTimes(1);
        expect(generate).not.toHaveBeenCalled();
    });

    it('sends an emoji suggestion while keeping the text draft', () => {
        const textarea = renderComposer({ suggestions: true });
        act(() => button('发送表情：抱抱猫').click());
        expect(panelAction).toHaveBeenCalledWith('send-emoji', expect.objectContaining({ name: '抱抱猫' }));
        expect(textarea.value).toBe('抱抱');
        expect(send).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
    });
});

describe('automatic reply cancellation', () => {
    it('pauses for the EM API chooser and starts a fresh delay after closing it', () => {
        vi.useFakeTimers();
        const generate = vi.fn();
        let api!: ReturnType<typeof useChatAutoReply>;
        function Harness() {
            const [auxiliaryOpen, setAuxiliaryOpen] = useState(false);
            api = useChatAutoReply({ enabled: true, active: true, conversationId: 'a', blocked: auxiliaryOpen, generating: false, onGenerate: generate });
            return React.createElement(ChatInputArea, {
                input: '', setInput: () => {}, isTyping: false, selectionMode: false,
                showPanel: 'none', setShowPanel: () => {}, onSend: () => {},
                onDeleteSelected: () => {}, selectedCount: 0, emojis: [],
                onPanelAction: () => {}, onImageSelect: () => {}, isSummarizing: false,
                onReroll: () => {}, canReroll: false, quickToolbarEnabled: true,
                onAuxiliaryPanelChange: setAuxiliaryOpen,
            });
        }
        act(() => root.render(React.createElement(Harness)));
        act(() => { api.beginSend('a')(true); });
        const chooser = container.querySelector<HTMLButtonElement>('button[aria-label="切换 API 预设"]')!;
        act(() => chooser.click());
        act(() => vi.advanceTimersByTime(2500));
        expect(generate).not.toHaveBeenCalled();
        act(() => chooser.click());
        act(() => vi.advanceTimersByTime(1999));
        expect(generate).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('waits for a completed send and a quiet composer, then generates only once', () => {
        vi.useFakeTimers();
        const generate = vi.fn();
        let api!: ReturnType<typeof useChatAutoReply>;
        let blocked = false;
        function Harness() { api = useChatAutoReply({ enabled: true, active: true, conversationId: 'a', blocked, generating: false, onGenerate: generate }); return null; }
        const render = () => act(() => root.render(React.createElement(Harness)));
        render();
        act(() => vi.advanceTimersByTime(3000));
        expect(generate).not.toHaveBeenCalled();
        let finish!: (sent: boolean) => void;
        act(() => { finish = api.beginSend('a'); });
        act(() => vi.advanceTimersByTime(3000));
        expect(generate).not.toHaveBeenCalled();
        act(() => finish(true));
        act(() => vi.advanceTimersByTime(1000));
        blocked = true; render();
        act(() => vi.advanceTimersByTime(3000));
        expect(generate).not.toHaveBeenCalled();
        blocked = false; render();
        act(() => vi.advanceTimersByTime(1999));
        expect(generate).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(generate).toHaveBeenCalledTimes(1);
        act(() => vi.advanceTimersByTime(5000));
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it.each(['cancel', 'switch', 'leave', 'generating', 'failed-send'])('%s prevents a late send completion from resurrecting a reply', reason => {
        vi.useFakeTimers();
        const generate = vi.fn();
        let api!: ReturnType<typeof useChatAutoReply>;
        const options = { enabled: true, active: true, conversationId: 'a', blocked: false, generating: false, onGenerate: generate };
        function Harness() { api = useChatAutoReply(options); return null; }
        const render = () => act(() => root.render(React.createElement(Harness)));
        render();
        let finish!: (sent: boolean) => void;
        act(() => { finish = api.beginSend('a'); });
        if (reason === 'cancel') act(() => api.cancel());
        if (reason === 'switch') options.conversationId = 'b';
        if (reason === 'leave') options.active = false;
        if (reason === 'generating') options.generating = true;
        render();
        act(() => finish(reason !== 'failed-send'));
        options.active = true; options.generating = false; render();
        act(() => vi.advanceTimersByTime(5000));
        expect(generate).not.toHaveBeenCalled();
    });
});
