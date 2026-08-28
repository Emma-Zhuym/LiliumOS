import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
  buildChatSearchSnippet,
  getMessageSearchText,
  matchesChatSearchCategory,
  searchChatMessages,
} from './chatSearch';

const message = (patch: Partial<Message>): Message => ({
  id: patch.id || 1,
  charId: patch.charId || 'char-a',
  role: patch.role || 'user',
  type: patch.type || 'text',
  content: patch.content || '',
  timestamp: patch.timestamp || new Date('2026-08-27T12:00:00').getTime(),
  ...patch,
});

describe('chatSearch', () => {
  it('keeps only text, voice, links, HTML and XHS cards', () => {
    const messages = [
      message({ id: 1, type: 'text', content: 'hello' }),
      message({ id: 2, type: 'image', content: 'blobref:image' }),
      message({ id: 3, type: 'music_card', content: 'song' }),
      message({ id: 4, type: 'html_card', metadata: { htmlTextPreview: 'weather card' } }),
      message({ id: 5, type: 'xhs_card', metadata: { xhsNote: { title: '晚饭' } } }),
    ];
    expect(searchChatMessages(messages, { category: 'all' }).map(item => item.id)).toEqual([5, 4, 1]);
  });

  it('treats webpage cards and URL text as links but not as the two supported card types', () => {
    const webpage = message({ type: 'webpage_card', metadata: { webpage: { title: 'Docs' } } });
    const urlText = message({ type: 'text', content: '看看 https://example.com' });
    expect(matchesChatSearchCategory(webpage, 'link')).toBe(true);
    expect(matchesChatSearchCategory(webpage, 'card')).toBe(false);
    expect(matchesChatSearchCategory(urlText, 'link')).toBe(true);
  });

  it('searches card metadata, voice transcripts, sender and local date ranges', () => {
    const messages = [
      message({ id: 1, role: 'assistant', type: 'voice', metadata: { transcript: '早点睡觉' } }),
      message({ id: 2, role: 'user', type: 'xhs_card', metadata: { xhsNote: { title: '牛肉面', desc: '汤更浓了' } } }),
      message({ id: 3, role: 'assistant', type: 'html_card', metadata: { htmlTextPreview: '明日行程' }, timestamp: new Date('2026-08-29T12:00:00').getTime() }),
    ];
    expect(searchChatMessages(messages, { keyword: '牛肉面', sender: 'user' }).map(item => item.id)).toEqual([2]);
    expect(searchChatMessages(messages, { keyword: '睡觉', category: 'voice' }).map(item => item.id)).toEqual([1]);
    expect(searchChatMessages(messages, { dateFrom: '2026-08-29', dateTo: '2026-08-29' }).map(item => item.id)).toEqual([3]);
  });

  it('uses readable HTML/XHS text and centers a long snippet around the keyword', () => {
    const html = message({ type: 'html_card', metadata: { htmlSource: '<div>今天吃了 <b>意面</b></div>' } });
    expect(getMessageSearchText(html)).toContain('今天吃了 意面');
    const long = message({ content: `${'前文'.repeat(50)}关键词${'后文'.repeat(50)}` });
    expect(buildChatSearchSnippet(long, '关键词', 48)).toContain('关键词');
  });
});
