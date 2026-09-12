import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { buildChatVoiceFavoriteSnapshot, readExistingVoiceFavoriteAudio } from './voiceFavoriteSnapshot';

const message = (content: string, extras: Partial<Message> = {}): Message => ({ id: 42, charId: 'c', timestamp: 10, role: 'assistant', type: 'text', content, ...extras });
const snapshot = (msg: Message) => buildChatVoiceFavoriteSnapshot(msg, { id: 'c', name: '角色' }, '我');
afterEach(() => vi.unstubAllGlobals());

describe('text voice snapshots', () => {
    it('preserves user paragraphs without requiring real voice configuration', () => {
        expect(snapshot(message('第一行\n第二行', { role: 'user', metadata: { voice: true } }))).toMatchObject({
            originalText: '第一行\n第二行', speakerRole: 'user', speakerName: '我', sourceKey: 'c:42',
        });
        expect(snapshot(message('普通消息'))).toBeNull();
        expect(snapshot(message('普通消息', { role: 'user' }))).toBeNull();
        expect(snapshot(message('<语音></语音>'))).toBeNull();
        expect(snapshot(message('块外闲聊<语音>[happy]</语音>'))).toBeNull();
    });
    it('uses explicit subtitles and excludes outside chatter from the voice snapshot', () => {
        const saved = snapshot(message('块外闲聊<语音>[happy]Hello.\n(sighs)Good night.</语音><字幕>你好。\n晚安。</字幕>另一句闲聊'));
        expect(saved).toMatchObject({ originalText: '你好。\n晚安。', spokenText: 'Hello.\nGood night.', translation: '你好。\n晚安。' });
        expect(JSON.stringify(saved)).not.toContain('闲聊');
    });
    it('repairs traditional or unfinished tags and never guesses a translation from outside text', () => {
        expect(snapshot(message('旁边的话＜語音＞第一行\n第二行'))).toMatchObject({ originalText: '第一行\n第二行', translation: undefined });
    });
    it('keeps existing foreign audio metadata meanings', () => {
        expect(buildChatVoiceFavoriteSnapshot(message('普通正文'), { id: 'c', name: '角色' }, '我', {
            blob: new Blob(['audio']), originalText: '你好', spokenText: 'Hello', lang: 'en',
        })).toMatchObject({ originalText: '你好', spokenText: 'Hello', translation: '你好', language: 'en' });
    });
    it('makes no request for text-only or stored Blob and only GETs an existing URL once', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('existing-audio'));
        vi.stubGlobal('fetch', fetchMock);
        expect(await readExistingVoiceFavoriteAudio()).toBeNull();
        const blob = new Blob(['already stored']);
        expect(await readExistingVoiceFavoriteAudio({ blob })).toBe(blob);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await (await readExistingVoiceFavoriteAudio({ url: 'https://media.example/existing.mp3' }))?.text()).toBe('existing-audio');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockRejectedValueOnce(new Error('gone'));
        expect(await readExistingVoiceFavoriteAudio({ url: 'https://media.example/missing.mp3' })).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
