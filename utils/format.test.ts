import { describe, expect, it } from 'vitest';
import { formatHours, formatMoney, roundMoney, sumMoney } from './format';

describe('money formatting', () => {
  it('removes floating-point tails from sums', () => {
    const raw = [7.9, 12.9, 11.36, 11.9, 5.8].reduce((sum, value) => sum + value, 0);
    expect(String(raw)).toContain('49.859999');
    expect(sumMoney([7.9, 12.9, 11.36, 11.9, 5.8])).toBe(49.86);
    expect(formatMoney(raw)).toBe('49.86');
  });

  it('keeps compact integer and decimal displays', () => {
    expect(formatMoney(100)).toBe('100');
    expect(formatMoney(7.9)).toBe('7.9');
    expect(roundMoney(1.239)).toBe(1.24);
  });

  it('handles invalid and negative values safely', () => {
    expect(sumMoney([])).toBe(0);
    expect(formatMoney(Number.NaN)).toBe('0');
    expect(sumMoney([1.5, Number.NaN, 2])).toBe(3.5);
    expect(formatMoney(-0.1 - 0.2)).toBe('-0.3');
  });
});

describe('hour formatting', () => {
  it('keeps whole hours compact and rounds imported odd intervals', () => {
    expect(formatHours(60)).toBe('1');
    expect(formatHours(120)).toBe('2');
    expect(formatHours(100)).toBe('1.7');
    expect(formatHours(90)).toBe('1.5');
    expect(formatHours(Number.NaN)).toBe('0');
  });
});
