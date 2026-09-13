// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import FavoritesPortal from '../components/chat/FavoritesPortal';
import { listContentFavorites, resolveContentFavorite, type ChatContentFavorite, type ImageContentFavorite } from './contentFavorites';
import { listVoiceFavorites } from './voiceFavorites';
vi.mock('../context/OSContext', () => ({ useOS: () => ({ characters: [], customThemes: [], userProfile: { name: 'Emma', avatar: '' } }) }));
vi.mock('./contentFavorites', async original => ({ ...await original<typeof import('./contentFavorites')>(), listContentFavorites: vi.fn(), resolveContentFavorite: vi.fn() }));
vi.mock('./voiceFavorites', async original => ({ ...await original<typeof import('./voiceFavorites')>(), listVoiceFavorites: vi.fn() }));

it('filters the shared collection by voice text without turning the result into plain text', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const text: ChatContentFavorite = { id: 'text', kind: 'chat', messageId: 1, charId: 'c', charName: 'Sully', sourceTimestamp: 10, favoritedAt: 10, owners: [{ kind: 'user', favoritedAt: 10 }], snapshot: { role: 'user', type: 'text', content: '文字第一段\n\n文字第二段', timestamp: 10 } };
    const image: ImageContentFavorite = { ...text, id: 'image', kind: 'image', fingerprint: 'img', references: [{ source: 'chat', charId: 'c', messageId: 2 }] };
    vi.mocked(listContentFavorites).mockResolvedValue([text, image]);
    vi.mocked(resolveContentFavorite).mockImplementation(async item => item.kind === 'image' ? { favorite: item, imageUrl: 'data:image/png;base64,iVBORw0KGgo=', reference: item.references[0] } : { favorite: item, message: { ...item.snapshot!, id: item.messageId, charId: item.charId }, sourceAvailable: false });
    vi.mocked(listVoiceFavorites).mockResolvedValue([{ id: 'voice', source: 'chat', sourceKey: 'c:3', charId: 'c', charName: 'Sully', sourceTimestamp: 20, favoritedAt: 20, originalText: '语音里的月亮\n仍保留换行', speakerRole: 'user', audioState: 'none' }]);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
        await act(async () => root.render(React.createElement(FavoritesPortal, { onClose: () => {} })));
        expect(document.querySelectorAll('article')).toHaveLength(3);
        expect(document.body.textContent).toContain('文字第一段');
        expect(document.querySelector('img[alt="收藏图片"]')).not.toBeNull();
        act(() => document.querySelector<HTMLButtonElement>('[aria-label="搜索收藏"]')!.click());
        const input = document.querySelector<HTMLInputElement>('[aria-label="搜索收藏中的关键词"]')!;
        act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '月亮'); input.dispatchEvent(new Event('input', { bubbles: true })); });
        expect(document.querySelectorAll('article')).toHaveLength(1);
        expect(document.querySelector('[data-favorite-kind="voice"]')).not.toBeNull();
        expect(document.body.textContent).not.toContain('语音里的月亮');
        act(() => document.querySelector<HTMLElement>('[aria-label="转文字"]')!.click());
        expect(document.body.textContent).toContain('语音里的月亮\n仍保留换行');
    } finally { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
