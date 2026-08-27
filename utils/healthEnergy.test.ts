import { describe, expect, it } from 'vitest';
import { resolveExerciseCalories } from './healthEnergy';

describe('resolveExerciseCalories', () => {
  it('prefers Apple Health active energy without adding the manual workout again', () => {
    expect(resolveExerciseCalories(236, 412.4)).toBe(412);
  });

  it('treats an explicit Apple Health zero as the canonical value', () => {
    expect(resolveExerciseCalories(236, 0)).toBe(0);
  });

  it('falls back to the manual workout when Apple Health is unavailable', () => {
    expect(resolveExerciseCalories(236)).toBe(236);
  });

  it('sanitizes missing, invalid and negative values', () => {
    expect(resolveExerciseCalories()).toBe(0);
    expect(resolveExerciseCalories(Number.NaN)).toBe(0);
    expect(resolveExerciseCalories(-20)).toBe(0);
  });
});
