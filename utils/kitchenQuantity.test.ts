import { describe, expect, it } from 'vitest';
import {
  formatPackageAmount,
  formatPortionFraction,
  formatPortionInput,
  parsePortionInput,
} from './kitchenQuantity';

describe('kitchen quantity input', () => {
  it.each([
    ['2/5', 0.4],
    ['20%', 0.2],
    ['0.25', 0.25],
  ])('parses %s as a package ratio', (input, expected) => {
    const result = parsePortionInput(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('ratio');
      expect(result.value.fraction).toBeCloseTo(expected);
    }
  });

  it('converts milliliters against a liter package', () => {
    const result = parsePortionInput('250 ml', '1 L');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fraction).toBeCloseTo(0.25);
      expect(result.value.display).toBe('250 ml');
    }
  });

  it('converts grams against a pound package', () => {
    const result = parsePortionInput('220 g', '1.1 lb');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fraction).toBeCloseTo(0.440923, 5);
  });

  it('converts milliliters against fluid ounces', () => {
    const result = parsePortionInput('300 ml', '30 fl oz');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fraction).toBeCloseTo(0.33814, 5);
  });

  it('explains that plain ounces are weight when volume is entered', () => {
    const result = parsePortionInput('300 ml', '30 oz');
    expect(result).toEqual({
      ok: false,
      error: '填写的用量和包装规格不是同一类单位；如果包装上的 oz 指容量，请把规格写成 fl oz',
    });
  });

  it('requires a package size before accepting a measured amount', () => {
    const result = parsePortionInput('200 g');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('包装规格');
  });

  it('rejects an amount larger than one package', () => {
    const result = parsePortionInput('1.2 L', '1 L');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('超过了一整件包装');
  });

  it('rejects a zero-sized package', () => {
    const result = parsePortionInput('0 ml', '0 L');
    expect(result).toEqual({ ok: false, error: '每件包装规格必须大于 0' });
  });

  it('shows remaining liters and kilograms in the smaller familiar unit', () => {
    expect(formatPackageAmount('1 L', 0.7)).toBe('700 ml');
    expect(formatPackageAmount('1.1 kg', 0.5)).toBe('550 g');
    expect(formatPackageAmount('30 fl oz', 0.5)).toBe('15 fl oz');
  });

  it('keeps precise edit values even when the friendly label is rounded', () => {
    expect(formatPortionFraction(0.7)).toBe('70%');
    expect(formatPortionInput(1 / 3)).toBe('1/3');
    expect(formatPortionInput(0.123456789)).toBe('0.123456789');
  });
});
