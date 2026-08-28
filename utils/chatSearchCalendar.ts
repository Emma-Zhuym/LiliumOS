import type { Message } from '../types';
import { getLocalDateKey } from './localDate';

export interface ChatCalendarCell {
  dateKey: string;
  day: number;
  active: boolean;
  today: boolean;
}

export function getChatDateKeys(messages: Message[]): Set<string> {
  return new Set(
    messages
      .filter(message => message.role !== 'system' && Number.isFinite(message.timestamp))
      .map(message => getLocalDateKey(new Date(message.timestamp))),
  );
}

export function buildChatCalendarMonth(
  year: number,
  month: number,
  activeDateKeys: Set<string>,
  todayKey = getLocalDateKey(),
): Array<ChatCalendarCell | null> {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<ChatCalendarCell | null> = Array.from({ length: firstWeekday }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = getLocalDateKey(new Date(year, month, day));
    cells.push({
      dateKey,
      day,
      active: activeDateKeys.has(dateKey),
      today: dateKey === todayKey,
    });
  }

  return cells;
}

export function shiftChatCalendarMonth(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}
