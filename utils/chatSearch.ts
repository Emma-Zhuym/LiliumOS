import type { Message } from '../types';
import { getVoiceTranscript } from './messageFormat';

export type ChatSearchCategory = 'all' | 'text' | 'voice' | 'link' | 'card';
export type ChatSearchSender = 'all' | 'user' | 'assistant';

export interface ChatSearchFilters {
  keyword?: string;
  category?: ChatSearchCategory;
  sender?: ChatSearchSender;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

const URL_RE = /https?:\/\/[^\s<>'"]+/i;
const SEARCHABLE_TYPES = new Set(['text', 'voice', 'html_card', 'xhs_card', 'webpage_card']);

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function getMessageSearchText(message: Message): string {
  const metadata = message.metadata || {};
  let content = '';

  switch (message.type) {
    case 'voice':
      content = getVoiceTranscript(message);
      break;
    case 'html_card':
      content = metadata.htmlTextPreview
        || stripHtml(metadata.htmlSource || message.content || '');
      break;
    case 'xhs_card': {
      const note = metadata.xhsNote || {};
      content = [note.title, note.desc, note.author, message.content].filter(Boolean).join(' ');
      break;
    }
    case 'webpage_card': {
      const webpage = metadata.webpage || {};
      content = [
        webpage.title,
        webpage.siteName,
        webpage.excerpt,
        webpage.content,
        webpage.finalUrl,
        webpage.url,
        message.content,
      ].filter(Boolean).join(' ');
      break;
    }
    default:
      content = message.content || '';
  }

  return [content, message.replyTo?.content, message.replyTo?.name]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLinkSearchMessage(message: Message): boolean {
  return message.type === 'webpage_card'
    || (message.type === 'text' && URL_RE.test(message.content || ''));
}

export function matchesChatSearchCategory(message: Message, category: ChatSearchCategory): boolean {
  if (!SEARCHABLE_TYPES.has(message.type)) return false;
  switch (category) {
    case 'text': return message.type === 'text';
    case 'voice': return message.type === 'voice';
    case 'link': return isLinkSearchMessage(message);
    case 'card': return message.type === 'html_card' || message.type === 'xhs_card';
    default: return true;
  }
}

function localDateBoundary(dateKey: string, endExclusive: boolean): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (endExclusive) date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function searchChatMessages(messages: Message[], filters: ChatSearchFilters): Message[] {
  const keyword = (filters.keyword || '').trim().toLocaleLowerCase();
  const category = filters.category || 'all';
  const sender = filters.sender || 'all';
  const from = filters.dateFrom ? localDateBoundary(filters.dateFrom, false) : null;
  const to = filters.dateTo ? localDateBoundary(filters.dateTo, true) : null;
  const limit = Math.max(1, filters.limit || 200);

  return messages
    .filter(message => message.role !== 'system')
    .filter(message => sender === 'all' || message.role === sender)
    .filter(message => matchesChatSearchCategory(message, category))
    .filter(message => from === null || message.timestamp >= from)
    .filter(message => to === null || message.timestamp < to)
    .filter(message => !keyword || getMessageSearchText(message).toLocaleLowerCase().includes(keyword))
    .sort((a, b) => (b.timestamp - a.timestamp) || (b.id - a.id))
    .slice(0, limit);
}

export function buildChatSearchSnippet(message: Message, keyword = '', maxLength = 132): string {
  const text = getMessageSearchText(message);
  if (!text) return message.type === 'voice' ? '语音消息' : '无文字摘要';
  if (text.length <= maxLength) return text;

  const normalizedKeyword = keyword.trim().toLocaleLowerCase();
  const matchIndex = normalizedKeyword
    ? text.toLocaleLowerCase().indexOf(normalizedKeyword)
    : -1;
  const start = matchIndex > 28 ? Math.max(0, matchIndex - 28) : 0;
  const excerpt = text.slice(start, start + maxLength).trim();
  return `${start > 0 ? '…' : ''}${excerpt}${start + maxLength < text.length ? '…' : ''}`;
}
