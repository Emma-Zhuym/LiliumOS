export const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

/** Keep persisted and displayed money values at cent precision. */
export const roundMoney = (value: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

/** Sum money values and normalize the result to cent precision. */
export const sumMoney = (values: number[]): number =>
  roundMoney(values.reduce((sum, value) => sum + (Number(value) || 0), 0));

/** Compact money display without floating-point tails or forced zeroes. */
export const formatMoney = (value: number): string => String(roundMoney(value));

/** Convert a persisted minute interval to a compact hour display. */
export const formatHours = (minutes: number): string => {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round((n / 60) * 10) / 10);
};
