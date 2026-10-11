import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNextOccurrenceForAnniversary, sortAnniversariesByNextOccurrence } from './anniversaryNext';

describe('anniversary next occurrence', () => {
  afterEach(() => vi.useRealTimers());

  it('rolls a yearly anniversary from a past source year into the next occurrence', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 12));

    const next = getNextOccurrenceForAnniversary({
      id: 'yearly', title: 'Yearly', date: '2025-11-09', charId: 'char', repeatYearly: true,
    });

    expect(next?.getFullYear()).toBe(2026);
    expect(next?.getMonth()).toBe(10);
    expect(next?.getDate()).toBe(9);
  });

  it('keeps one-time past anniversaries out of the upcoming list', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 12));

    const rows = sortAnniversariesByNextOccurrence([
      { id: 'past', title: 'Past', date: '2025-11-09', charId: 'char', repeatYearly: false },
      { id: 'yearly', title: 'Yearly', date: '2025-11-09', charId: 'char', repeatYearly: true },
    ]);

    expect(rows.map(row => row.anni.id)).toEqual(['yearly']);
  });
});
