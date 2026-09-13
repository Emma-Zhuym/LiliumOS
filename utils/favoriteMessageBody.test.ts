// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FavoriteMessageBody from '../components/chat/FavoriteMessageBody';
import type { MessageFavoriteEntry } from './messageFavorites';
vi.mock('../context/OSContext', () => ({ useOS: () => ({ characters: [], customThemes: [], userProfile: { name: 'Emma', avatar: '' } }) }));
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const base = { id: 'entry', charId: 'c', charName: 'Sully', timestamp: 10 };
it('renders a saved voice as a bar, exposing paragraphs only after 转文字 with no request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const entry: MessageFavoriteEntry = { ...base, kind: 'voice', voice: { id: 'v', source: 'chat', sourceKey: 'c:1', charId: 'c', charName: 'Sully', sourceTimestamp: 10, favoritedAt: 10, originalText: '第一行\n\n第二段', speakerRole: 'user', audioState: 'none' } };
    await act(async () => root.render(React.createElement(FavoriteMessageBody, { entry })));
    expect(container.textContent).not.toContain('第一行');
    const toggle = container.querySelector<HTMLElement>('[aria-label="转文字"]')!;
    expect(toggle).not.toBeNull(); act(() => toggle.click());
    expect(container.textContent).toContain('第一行\n\n第二段');
    expect(fetch).not.toHaveBeenCalled();
});
it('renders the original HTML in the existing sandbox with source collapsed', async () => {
    const html = '<section><h2>晚安卡</h2></section>';
    await act(async () => root.render(React.createElement(FavoriteMessageBody, { entry: { ...base, kind: 'html', message: { id: 2, charId: 'c', role: 'assistant', timestamp: 10, type: 'html_card', content: '[HTML小卡片]', metadata: { htmlSource: html } } } })));
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('srcdoc')).toContain(html);
    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(container.querySelector('pre')).toBeNull();
});
