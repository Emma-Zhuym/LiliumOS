import { describe, expect, it } from 'vitest';
import { INK_DOUBLE_TAP_MS, INK_RELOCK_AFTER_MS, isSecondTap, shouldInkRelock } from './inkAutoRelock';

describe('shouldInkRelock', () => {
  const base = { enabled: true, isLocked: false, hiddenAt: 1_000, now: 1_000 + INK_RELOCK_AFTER_MS };

  it('locks again after 15 minutes in the background', () => {
    expect(shouldInkRelock(base)).toBe(true);
  });

  it('does not lock after a short trip away', () => {
    expect(shouldInkRelock({ ...base, now: base.now - 1 })).toBe(false);
  });

  it('leaves the wallpaper lock style alone', () => {
    expect(shouldInkRelock({ ...base, enabled: false })).toBe(false);
  });

  it('does nothing when already locked or never hidden', () => {
    expect(shouldInkRelock({ ...base, isLocked: true })).toBe(false);
    expect(shouldInkRelock({ ...base, hiddenAt: null })).toBe(false);
  });
});

describe('isSecondTap', () => {
  it('counts two quick taps as a double tap', () => {
    expect(isSecondTap(100, 100 + INK_DOUBLE_TAP_MS)).toBe(true);
  });

  it('ignores a first tap and slow taps', () => {
    expect(isSecondTap(null, 100)).toBe(false);
    expect(isSecondTap(100, 101 + INK_DOUBLE_TAP_MS)).toBe(false);
  });
});
