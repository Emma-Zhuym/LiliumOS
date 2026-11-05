/**
 * 健康里她自己加的症状（2026-11-04）：两组各一份，存本机，随文字 / 完整备份走（emHealthCustomSymptoms）。
 * 移出列表只是不再显示成按钮，记过的那几天不动。
 */

export type SymptomGroup = 'period' | 'general';
export type CustomSymptoms = Record<SymptomGroup, string[]>;

const KEY = 'em_health_custom_symptoms_v1';
const MAX_PER_GROUP = 24;
const MAX_LEN = 12;

const clean = (list: unknown): string[] => Array.isArray(list)
    ? [...new Set(list.filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, MAX_LEN)).filter(Boolean))].slice(0, MAX_PER_GROUP)
    : [];

export const loadCustomSymptoms = (): CustomSymptoms => {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
        return { period: clean(raw?.period), general: clean(raw?.general) };
    } catch {
        return { period: [], general: [] };
    }
};

const save = (next: CustomSymptoms) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 存不下就算了 */ }
    return next;
};

/** 加一个；跟预设或另一组重名的不加（两组不能有重复项，保存时按组归属合并） */
export const addCustomSymptom = (group: SymptomGroup, name: string, taken: string[]): CustomSymptoms => {
    const current = loadCustomSymptoms();
    const value = name.trim().slice(0, MAX_LEN);
    const other = group === 'period' ? current.general : current.period;
    if (!value || taken.includes(value) || other.includes(value) || current[group].includes(value)) return current;
    return save({ ...current, [group]: [...current[group], value].slice(0, MAX_PER_GROUP) });
};

export const removeCustomSymptom = (group: SymptomGroup, name: string): CustomSymptoms => {
    const current = loadCustomSymptoms();
    return save({ ...current, [group]: current[group].filter(x => x !== name) });
};

export const exportCustomSymptoms = (): CustomSymptoms | undefined => {
    const current = loadCustomSymptoms();
    return current.period.length || current.general.length ? current : undefined;
};

export const importCustomSymptoms = (data: unknown) => {
    if (!data || typeof data !== 'object') return;
    const raw = data as Partial<CustomSymptoms>;
    save({ period: clean(raw.period), general: clean(raw.general) });
};
