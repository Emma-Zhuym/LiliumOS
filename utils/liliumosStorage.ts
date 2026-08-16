export function readLiliumOSStorage(key: string, legacyKeys: string[] = []): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;

    for (const legacyKey of legacyKeys) {
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue === null) continue;
      localStorage.setItem(key, legacyValue);
      localStorage.removeItem(legacyKey);
      return legacyValue;
    }
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  return null;
}

export function writeLiliumOSStorage(key: string, value: string, legacyKeys: string[] = []): void {
  try {
    localStorage.setItem(key, value);
    for (const legacyKey of legacyKeys) localStorage.removeItem(legacyKey);
  } catch {
    // Keep settings non-fatal when storage is unavailable.
  }
}

export function removeLiliumOSStorage(key: string, legacyKeys: string[] = []): void {
  try {
    localStorage.removeItem(key);
    for (const legacyKey of legacyKeys) localStorage.removeItem(legacyKey);
  } catch {
    // Keep settings non-fatal when storage is unavailable.
  }
}
