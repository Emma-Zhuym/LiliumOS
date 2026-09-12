// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceFavoritesList from '../components/chat/VoiceFavoritesList';
import VoiceFavoriteActionSheet from '../components/voice/VoiceFavoriteActionSheet';
import { useVoiceFavoriteMenu, type VoiceFavoriteTarget } from '../hooks/useVoiceFavoriteMenu';
import { useVoiceFavoriteGesture } from '../hooks/useVoiceFavoriteGesture';
import { getVoiceFavorite, getVoiceFavoriteBlob, listVoiceFavorites, removeVoiceFavorite, removeVoiceFavoriteById, saveVoiceFavorite, type VoiceFavorite } from './voiceFavorites';

vi.mock('./voiceFavorites', () => ({
    VOICE_FAVORITES_CHANGED_EVENT: 'voice-test-changed',
    getVoiceFavorite: vi.fn(), getVoiceFavoriteBlob: vi.fn(), listVoiceFavorites: vi.fn(),
    removeVoiceFavorite: vi.fn(), removeVoiceFavoriteById: vi.fn(), saveVoiceFavorite: vi.fn(),
    voiceFavoriteSourceLabel: (source: string) => ({ chat: '聊天', date: '见面', call: '通话' })[source],
}));

let root: Root;
let container: HTMLDivElement;
const network = vi.fn();
const AudioMock = vi.fn();
const item = (overrides: Partial<VoiceFavorite> = {}): VoiceFavorite => ({ id: 'v1', source: 'chat', sourceKey: 'c:1', charId: 'c', charName: '测试角色', sourceTimestamp: 10, favoritedAt: 20, originalText: '保留第一行\n保留第二行', audioState: 'none', ...overrides });
const target: VoiceFavoriteTarget = { snapshot: { source: 'date', sourceKey: 'c:2-0', charId: 'c', charName: '测试角色', sourceTimestamp: 10, originalText: '没有语音 API 的对白' } };
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', network);
    vi.stubGlobal('Audio', AudioMock);
    vi.mocked(getVoiceFavorite).mockResolvedValue(null);
    vi.mocked(getVoiceFavoriteBlob).mockResolvedValue(null);
    vi.mocked(listVoiceFavorites).mockResolvedValue([]);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const renderList = async (query = '') => { await act(async () => { root.render(React.createElement(VoiceFavoritesList, { query })); }); };

describe('voice archive reading without synthesis', () => {
    it('reads text-only and omitted-audio entries, preserving paragraphs and the user speaker', async () => {
        vi.mocked(listVoiceFavorites).mockResolvedValue([item({ speakerRole: 'user', speakerName: 'Emma' }), item({ id: 'v2', audioState: 'omitted' })]);
        await renderList();
        expect(container.textContent).toContain('Emma · 你');
        expect(container.textContent).toContain('保留第一行\n保留第二行');
        expect(container.textContent).toContain('文字备份未包含音频');
        expect(container.querySelector('button[aria-label="播放收藏音频"]')).toBeNull();
        act(() => container.querySelector('article p')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(network).not.toHaveBeenCalled(); expect(AudioMock).not.toHaveBeenCalled(); expect(getVoiceFavoriteBlob).not.toHaveBeenCalled();
    });
    it('reports a missing saved attachment and keeps text readable without generating it', async () => {
        vi.mocked(listVoiceFavorites).mockResolvedValue([item({ audioState: 'stored' })]);
        await renderList();
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="播放收藏音频"]')!.click());
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('文字仍已保存');
        expect(container.textContent).toContain('保留第二行');
        expect(network).not.toHaveBeenCalled(); expect(AudioMock).not.toHaveBeenCalled();
    });
    it('does not start a pending audio read after leaving the archive', async () => {
        vi.mocked(listVoiceFavorites).mockResolvedValue([item({ audioState: 'stored' })]);
        let resolve!: (value: Blob) => void;
        vi.mocked(getVoiceFavoriteBlob).mockReturnValue(new Promise(done => { resolve = done; }));
        await renderList();
        act(() => container.querySelector<HTMLButtonElement>('button[aria-label="播放收藏音频"]')!.click());
        act(() => root.render(null));
        await act(async () => resolve(new Blob(['existing audio'])));
        expect(AudioMock).not.toHaveBeenCalled();
    });
    it('does not play a late attachment after the favorite was removed', async () => {
        vi.mocked(listVoiceFavorites).mockResolvedValue([item({ audioState: 'stored' })]);
        let resolve!: (value: Blob) => void;
        vi.mocked(getVoiceFavoriteBlob).mockReturnValue(new Promise(done => { resolve = done; }));
        await renderList();
        act(() => container.querySelector<HTMLButtonElement>('button[aria-label="播放收藏音频"]')!.click());
        vi.mocked(listVoiceFavorites).mockResolvedValue([]);
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="取消语音收藏"]')!.click());
        await act(async () => resolve(new Blob(['existing audio'])));
        expect(AudioMock).not.toHaveBeenCalled();
    });
    it('shows read failures and removes only the selected voice entry', async () => {
        vi.mocked(listVoiceFavorites).mockRejectedValueOnce(new Error('索引读取失败')).mockResolvedValue([item()]);
        await renderList();
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('索引读取失败');
        await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="取消语音收藏"]')!.click());
        expect(removeVoiceFavoriteById).toHaveBeenCalledWith('v1');
        expect(network).not.toHaveBeenCalled(); expect(AudioMock).not.toHaveBeenCalled();
    });
});

describe('voice archive menu', () => {
    let menu!: ReturnType<typeof useVoiceFavoriteMenu>;
    const notify = vi.fn();
    const mountMenu = () => {
        function Harness() { menu = useVoiceFavoriteMenu(notify); return null; }
        act(() => root.render(React.createElement(Harness)));
    };
    it('saves a date/call text snapshot with no provider config or audio requests', async () => {
        mountMenu();
        await act(async () => menu.open(target));
        await act(async () => menu.toggle());
        expect(saveVoiceFavorite).toHaveBeenCalledWith({ ...target.snapshot, blob: null });
        expect(network).not.toHaveBeenCalled(); expect(AudioMock).not.toHaveBeenCalled();
    });
    it('cancels an existing favorite without reading its source audio', async () => {
        vi.mocked(getVoiceFavorite).mockResolvedValue(item()); mountMenu();
        await act(async () => menu.open({ ...target, audio: { url: 'https://media.example/existing.mp3' } }));
        await act(async () => menu.toggle());
        expect(removeVoiceFavorite).toHaveBeenCalledWith('date', 'c:2-0');
        expect(network).not.toHaveBeenCalled(); expect(saveVoiceFavorite).not.toHaveBeenCalled();
    });
    it('ignores a lookup that finishes after closing or selecting another source', async () => {
        let finishFirst!: (value: VoiceFavorite) => void;
        vi.mocked(getVoiceFavorite).mockReturnValueOnce(new Promise(done => { finishFirst = done; })); mountMenu();
        act(() => { void menu.open(target); });
        act(() => menu.close());
        await act(async () => menu.open({ snapshot: { ...target.snapshot, sourceKey: 'c:3-0' } }));
        await act(async () => finishFirst(item()));
        expect(menu.target?.snapshot.sourceKey).toBe('c:3-0'); expect(menu.favorited).toBe(false);
    });
    it('a read failure cannot be treated as an empty favorite and overwritten', async () => {
        vi.mocked(getVoiceFavorite).mockRejectedValueOnce(new Error('索引损坏')); mountMenu();
        await act(async () => menu.open(target)); await act(async () => menu.toggle());
        expect(menu.target).toBeNull(); expect(saveVoiceFavorite).not.toHaveBeenCalled();
    });
});

describe('long-press does not also play or advance', () => {
    it('closing the portaled sheet backdrop does not advance the parent scene', () => {
        const advance = vi.fn(), close = vi.fn();
        act(() => root.render(React.createElement('div', { onClick: advance }, React.createElement(VoiceFavoriteActionSheet, { open: true, favorited: false, onClose: close, onToggle: () => {} }))));
        const dialog = document.querySelector('[role="dialog"]')!;
        act(() => dialog.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(close).toHaveBeenCalledTimes(1); expect(advance).not.toHaveBeenCalled();
    });
    it('consumes the following click and cancels selection on scroll', () => {
        vi.useFakeTimers(); const open = vi.fn(), play = vi.fn();
        function Harness() { const bind = useVoiceFavoriteGesture(); return React.createElement('div', { ...bind(open), onClick: play }, '对白'); }
        act(() => root.render(React.createElement(Harness)));
        const line = container.firstElementChild!;
        const touch = (kind: string) => { const event = new Event(kind, { bubbles: true }); Object.defineProperty(event, 'touches', { value: [{}] }); line.dispatchEvent(event); };
        act(() => touch('touchstart')); act(() => vi.advanceTimersByTime(451)); act(() => touch('touchend'));
        act(() => line.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
        expect(open).toHaveBeenCalledTimes(1); expect(play).not.toHaveBeenCalled();
        act(() => touch('touchstart')); act(() => touch('touchmove')); act(() => vi.advanceTimersByTime(1000));
        expect(open).toHaveBeenCalledTimes(1);
        act(() => touch('touchstart')); act(() => touch('touchend')); act(() => line.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(play).toHaveBeenCalledTimes(1);
    });
});
