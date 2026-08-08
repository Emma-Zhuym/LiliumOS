/**
 * Personal-fork compatibility shim.
 *
 * Upstream UI code still contains telemetry call sites. SullyEM intentionally
 * ships without analytics, so every export here is local-only and side-effect
 * free: no script injection, storage access, identifiers, or network requests.
 */
export const initAnalytics = (): void => {};
export const trackEvent = (_name: string, _properties?: Record<string, unknown>): void => {};
export const noteMessageSent = (): void => {};
export const isAnalyticsConfigured = (): boolean => false;
export const isAnalyticsEnabled = (): boolean => false;
export const setAnalyticsEnabled = (_enabled: boolean): void => {};

export const presetOrCustom = (
    value: string,
    presets: readonly string[],
    emptyLabel = 'empty',
): string => value ? (presets.includes(value) ? value : 'custom') : emptyLabel;

export const bucketRetryCount = (count: number): string => {
    if (count <= 0) return '0';
    if (count === 1) return '1';
    if (count === 2) return '2';
    return '3+';
};
