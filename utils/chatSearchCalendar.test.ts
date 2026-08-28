import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { buildChatCalendarMonth, getChatDateKeys, shiftChatCalendarMonth } from './chatSearchCalendar';

const makeMessage = (id: number, role: Message['role'], type: Message['type'], date: Date): Message => ({
  id,
  charId: 'char-1',
  role,
  type,
  content: '',
  timestamp: date.getTime(),
});

describe('chatSearchCalendar', () => {
  it('marks every day with a private chat message, including image-only days', () => {
    const keys = getChatDateKeys([
      makeMessage(1, 'user', 'text', new Date(2026, 7, 4, 9)),
      makeMessage(2, 'assistant', 'image', new Date(2026, 7, 6, 18)),
      makeMessage(3, 'system', 'text', new Date(2026, 7, 8, 12)),
    ]);

    expect([...keys]).toEqual(['2026-08-04', '2026-08-06']);
  });

  it('builds a Sunday-first month and dims dates without chat', () => {
    const cells = buildChatCalendarMonth(2026, 7, new Set(['2026-08-04']), '2026-08-27');
    const fourth = cells.find(cell => cell?.day === 4);
    const fifth = cells.find(cell => cell?.day === 5);
    const today = cells.find(cell => cell?.day === 27);

    expect(cells.slice(0, 6)).toEqual(Array(6).fill(null));
    expect(fourth).toMatchObject({ active: true, today: false });
    expect(fifth).toMatchObject({ active: false, today: false });
    expect(today).toMatchObject({ active: false, today: true });
  });

  it('moves across year boundaries', () => {
    const shifted = shiftChatCalendarMonth(new Date(2026, 0, 1), -1);
    expect([shifted.getFullYear(), shifted.getMonth()]).toEqual([2025, 11]);
  });
});
