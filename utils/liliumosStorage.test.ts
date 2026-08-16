import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLiliumOSStorage, removeLiliumOSStorage, writeLiliumOSStorage } from './liliumosStorage';

function installStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

describe('LiliumOS localStorage migration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('moves an old SullyEM value to the current key on first read', () => {
    const values = installStorage({ old_key: 'saved-value' });

    expect(readLiliumOSStorage('new_key', ['old_key'])).toBe('saved-value');
    expect(values.get('new_key')).toBe('saved-value');
    expect(values.has('old_key')).toBe(false);
  });

  it('keeps the current value when both names exist', () => {
    const values = installStorage({ new_key: 'current', old_key: 'legacy' });

    expect(readLiliumOSStorage('new_key', ['old_key'])).toBe('current');
    expect(values.get('old_key')).toBe('legacy');
  });

  it('writes and removes only through the current LiliumOS key', () => {
    const values = installStorage({ old_key: 'legacy' });

    writeLiliumOSStorage('new_key', 'current', ['old_key']);
    expect(Object.fromEntries(values)).toEqual({ new_key: 'current' });

    removeLiliumOSStorage('new_key', ['old_key']);
    expect(values.size).toBe(0);
  });
});
