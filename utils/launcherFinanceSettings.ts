export interface LauncherFinanceSettings {
  excludedCategoryIds: string[];
}

export const LAUNCHER_FINANCE_SETTINGS_KEY = 'launcherFinanceSettings';
export const LAUNCHER_FINANCE_SETTINGS_CHANGED_EVENT = 'lilium:launcher-finance-settings-changed';

export function normalizeLauncherFinanceSettings(value: unknown): LauncherFinanceSettings {
  const source = value && typeof value === 'object' ? value as Partial<LauncherFinanceSettings> : {};
  return {
    excludedCategoryIds: Array.isArray(source.excludedCategoryIds)
      ? [...new Set(source.excludedCategoryIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : [],
  };
}

export function announceLauncherFinanceSettingsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LAUNCHER_FINANCE_SETTINGS_CHANGED_EVENT));
}
