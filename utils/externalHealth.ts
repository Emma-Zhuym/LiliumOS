import {
    callHomeAssistantActionWithResponse,
    fetchHomeAssistantStates,
    loadSmartHomeConfig,
    renderHomeAssistantTemplate,
    type HomeAssistantState,
    type SmartHomeConfig,
} from './smartHome';

export interface ExternalHealthWorkout {
    type?: string;
    durationMinutes?: number;
    calories?: number;
    distanceMeters?: number;
    startedAt?: string;
    endedAt?: string;
}

export interface ExternalHealthSnapshot {
    source: 'healthsync-home-assistant';
    fetchedAt: string;
    updatedAt: string;
    stepsToday?: number;
    activeCaloriesToday?: number;
    exerciseMinutesToday?: number;
    restingEnergyToday?: number;
    walkingRunningDistanceMetersToday?: number;
    latestHeartRate?: number;
    restingHeartRate?: number;
    walkingHeartRate?: number;
    heartRateRecovery?: number;
    hrvMs?: number;
    bloodPressureSystolic?: number;
    bloodPressureDiastolic?: number;
    afibBurdenPercent?: number;
    bloodOxygenPercent?: number;
    respiratoryRate?: number;
    bodyTemperatureCelsius?: number;
    bloodGlucoseMgDl?: number;
    flightsClimbedToday?: number;
    vo2Max?: number;
    sleepHoursLastNight?: number;
    sleepDeepMinutes?: number;
    sleepRemMinutes?: number;
    sleepCoreMinutes?: number;
    sleepAwakeMinutes?: number;
    sleepStartedAt?: string;
    sleepEndedAt?: string;
    latestWeightKg?: number;
    bodyMassIndex?: number;
    bodyFatPercent?: number;
    leanBodyMassKg?: number;
    heightMeters?: number;
    waistCircumferenceMeters?: number;
    lastWorkout?: ExternalHealthWorkout;
    /** Present when the snapshot is a date-scoped aggregate from HealthSync's archive. */
    summaryDate?: string;
    summaryKind?: 'current' | 'daily';
}

export type HealthSyncHistoryMetric =
    | 'steps'
    | 'heartRate'
    | 'heartRateVariability'
    | 'sleep'
    | 'activeCalories'
    | 'workouts'
    | 'flightsClimbed'
    | 'exerciseTime'
    | 'restingEnergy'
    | 'distanceWalkingRunning'
    | 'vo2Max'
    | 'weight'
    | 'restingHeartRate'
    | 'bloodPressureSystolic'
    | 'bloodPressureDiastolic'
    | 'walkingHeartRateAverage'
    | 'heartRateRecoveryOneMinute'
    | 'atrialFibrillationBurden'
    | 'oxygenSaturation'
    | 'respiratoryRate'
    | 'bodyTemperature'
    | 'bloodGlucose'
    | 'bodyMassIndex'
    | 'bodyFatPercentage'
    | 'leanBodyMass'
    | 'height'
    | 'waistCircumference';

export interface HealthSyncReading {
    value?: number | null;
    sleep_stage?: string | null;
    unit?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    source?: string | null;
    daily_total?: boolean | number | null;
    workout_type?: string | null;
    distance?: number | null;
}

export type HealthSyncReadingsByMetric = Partial<Record<HealthSyncHistoryMetric, HealthSyncReading[]>>;

const EXTERNAL_HEALTH_KEY = 'liliumos.health.external.v1';
const EXTERNAL_HEALTH_DAILY_KEY = 'liliumos.health.external.daily.v1';
const MAX_DAILY_SUMMARIES = 730;
const HEALTHSYNC_RE = /health[\s_-]*sync/i;
const UNAVAILABLE = new Set(['', 'unknown', 'unavailable', 'none', 'null']);

const normalizedText = (state: HomeAssistantState): string => {
    const friendlyName = typeof state.attributes?.friendly_name === 'string'
        ? state.attributes.friendly_name
        : '';
    return `${state.entity_id} ${friendlyName}`.toLowerCase();
};

const isHealthSyncSensor = (state: HomeAssistantState): boolean =>
    state.entity_id.startsWith('sensor.') && HEALTHSYNC_RE.test(normalizedText(state));

const numberState = (state: HomeAssistantState | undefined): number | undefined => {
    if (!state || UNAVAILABLE.has(String(state.state).trim().toLowerCase())) return undefined;
    const value = Number(state.state);
    return Number.isFinite(value) ? value : undefined;
};

const attrNumber = (state: HomeAssistantState | undefined, key: string): number | undefined => {
    const value = state?.attributes?.[key];
    if (value === undefined || value === null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const attrString = (state: HomeAssistantState | undefined, key: string): string | undefined => {
    const value = state?.attributes?.[key];
    if (typeof value !== 'string' || !value.trim()) return undefined;
    return value;
};

const findMetric = (states: HomeAssistantState[], pattern: RegExp): HomeAssistantState | undefined =>
    states.find(state => pattern.test(normalizedText(state)));

const findLatestHeartRate = (states: HomeAssistantState[]): HomeAssistantState | undefined =>
    states.find((state) => {
        const text = normalizedText(state);
        return /heart[\s_-]*rate/i.test(text)
            && !/(?:resting|walking)[\s_-]*heart[\s_-]*rate|heart[\s_-]*rate[\s_-]*(?:variability|recovery|reading)/i.test(text);
    });

const newestTimestamp = (states: HomeAssistantState[], fallback: Date): string => {
    const timestamps = states
        .flatMap(state => [state.last_updated, state.last_changed])
        .filter((value): value is string => typeof value === 'string')
        .map(value => Date.parse(value))
        .filter(Number.isFinite);
    return new Date(timestamps.length ? Math.max(...timestamps) : fallback.getTime()).toISOString();
};

const convertMassToKg = (state: HomeAssistantState | undefined): number | undefined => {
    const value = numberState(state);
    if (value === undefined) return undefined;
    const unit = String(state?.attributes?.unit_of_measurement || '').toLowerCase();
    if (unit === 'lb' || unit === 'lbs') return Math.round(value * 0.45359237 * 10) / 10;
    return value;
};

const convertLengthToMeters = (state: HomeAssistantState | undefined): number | undefined => {
    const value = numberState(state);
    if (value === undefined) return undefined;
    const unit = String(state?.attributes?.unit_of_measurement || 'm').trim().toLowerCase();
    if (unit === 'ft' || unit === 'feet') return Math.round(value * 0.3048 * 1000) / 1000;
    if (unit === 'in' || unit === 'inch' || unit === 'inches') return Math.round(value * 0.0254 * 1000) / 1000;
    if (unit === 'cm') return Math.round(value * 10) / 1000;
    if (unit === 'mm') return Math.round(value) / 1000;
    return value;
};

const convertTemperatureToCelsius = (state: HomeAssistantState | undefined): number | undefined => {
    const value = numberState(state);
    if (value === undefined) return undefined;
    const unit = String(state?.attributes?.unit_of_measurement || '').trim().toLowerCase();
    if (unit === '°f' || unit === 'f' || unit === 'fahrenheit') {
        return Math.round(((value - 32) * 5 / 9) * 10) / 10;
    }
    return value;
};

const convertDistanceToMeters = (state: HomeAssistantState | undefined): number | undefined => {
    const value = numberState(state);
    if (value === undefined) return undefined;
    const unit = String(state?.attributes?.unit_of_measurement || 'm').toLowerCase();
    if (unit === 'km') return value * 1000;
    if (unit === 'mi') return value * 1609.344;
    return value;
};

const hasSnapshotValues = (snapshot: ExternalHealthSnapshot): boolean =>
    Object.entries(snapshot).some(([key, value]) =>
        !['source', 'fetchedAt', 'updatedAt', 'summaryDate', 'summaryKind'].includes(key) && value !== undefined,
    );

export const parseExternalHealthSnapshot = (
    allStates: HomeAssistantState[],
    now = new Date(),
): ExternalHealthSnapshot | null => {
    const states = allStates.filter(isHealthSyncSensor);
    if (!states.length) return null;

    const steps = findMetric(states, /(?:steps[\s_-]*today|steps_today)/i);
    const activeCalories = findMetric(states, /active[\s_-]*calories[\s_-]*today/i);
    const exerciseTime = findMetric(states, /exercise[\s_-]*time[\s_-]*today/i);
    const restingEnergy = findMetric(states, /resting[\s_-]*energy[\s_-]*today/i);
    const walkingDistance = findMetric(states, /walking.*running.*distance.*today/i);
    const restingHeartRate = findMetric(states, /resting[\s_-]*heart[\s_-]*rate/i);
    const walkingHeartRate = findMetric(states, /walking[\s_-]*heart[\s_-]*rate/i);
    const heartRateRecovery = findMetric(states, /heart[\s_-]*rate[\s_-]*recovery/i);
    const hrv = findMetric(states, /heart[\s_-]*rate[\s_-]*variability|\bhrv\b/i);
    const latestHeartRate = findLatestHeartRate(states);
    const bloodPressureSystolic = findMetric(states, /blood[\s_-]*pressure[\s_-]*(?:systolic|sys)/i);
    const bloodPressureDiastolic = findMetric(states, /blood[\s_-]*pressure[\s_-]*(?:diastolic|dia)/i);
    const afibBurden = findMetric(states, /(?:afib|atrial[\s_-]*fibrillation)[\s_-]*burden/i);
    const bloodOxygen = findMetric(states, /blood[\s_-]*oxygen|\bspo2\b/i);
    const respiratoryRate = findMetric(states, /respiratory[\s_-]*rate/i);
    const bodyTemperature = findMetric(states, /body[\s_-]*temperature/i);
    const bloodGlucose = findMetric(states, /blood[\s_-]*glucose/i);
    const flightsClimbed = findMetric(states, /flights?[\s_-]*climbed[\s_-]*today/i);
    const vo2Max = findMetric(states, /vo2[\s_-]*max/i);
    const sleep = findMetric(states, /sleep[\s_-]*(?:last[\s_-]*night|duration)/i);
    const sleepOnset = findMetric(states, /fell[\s_-]*asleep|sleep[\s_-]*onset/i);
    const sleepWake = findMetric(states, /woke[\s_-]*up|sleep[\s_-]*wake/i);
    const weight = findMetric(states, /(?:^|[\s._-])weight(?:$|[\s._-])/i);
    const bodyMassIndex = findMetric(states, /body[\s_-]*mass[\s_-]*index|\bbmi\b/i);
    const bodyFat = findMetric(states, /body[\s_-]*fat[\s_-]*(?:percentage|percent)|body[\s_-]*fat(?:$|[\s._-])/i);
    const leanBodyMass = findMetric(states, /lean[\s_-]*body[\s_-]*mass/i);
    const height = findMetric(states, /(?:^|[\s._-])height(?:$|[\s._-])/i);
    const waistCircumference = findMetric(states, /waist[\s_-]*circumference/i);
    const workoutType = findMetric(states, /last[\s_-]*workout[\s_-]*type/i);
    const workoutDuration = findMetric(states, /last[\s_-]*workout[\s_-]*duration/i);
    const workoutCalories = findMetric(states, /last[\s_-]*workout[\s_-]*calories/i);
    const workoutDistance = findMetric(states, /last[\s_-]*workout[\s_-]*distance/i);
    const lastSync = findMetric(states, /last[\s_-]*sync/i);

    const lastSyncTime = lastSync && Number.isFinite(Date.parse(lastSync.state))
        ? new Date(lastSync.state).toISOString()
        : newestTimestamp(states, now);
    const workoutTypeValue = workoutType && !UNAVAILABLE.has(workoutType.state.toLowerCase())
        ? workoutType.state
        : undefined;
    const lastWorkout: ExternalHealthWorkout = {
        type: workoutTypeValue,
        durationMinutes: numberState(workoutDuration),
        calories: numberState(workoutCalories),
        distanceMeters: convertDistanceToMeters(workoutDistance),
        startedAt: attrString(workoutType, 'started_at'),
        endedAt: attrString(workoutType, 'ended_at'),
    };
    const hasWorkout = Object.values(lastWorkout).some(value => value !== undefined);

    const snapshot: ExternalHealthSnapshot = {
        source: 'healthsync-home-assistant',
        fetchedAt: now.toISOString(),
        updatedAt: lastSyncTime,
        summaryKind: 'current',
        stepsToday: numberState(steps),
        activeCaloriesToday: numberState(activeCalories),
        exerciseMinutesToday: numberState(exerciseTime),
        restingEnergyToday: numberState(restingEnergy),
        walkingRunningDistanceMetersToday: convertDistanceToMeters(walkingDistance),
        latestHeartRate: numberState(latestHeartRate),
        restingHeartRate: numberState(restingHeartRate),
        walkingHeartRate: numberState(walkingHeartRate),
        heartRateRecovery: numberState(heartRateRecovery),
        hrvMs: numberState(hrv),
        bloodPressureSystolic: numberState(bloodPressureSystolic),
        bloodPressureDiastolic: numberState(bloodPressureDiastolic),
        afibBurdenPercent: numberState(afibBurden),
        bloodOxygenPercent: numberState(bloodOxygen),
        respiratoryRate: numberState(respiratoryRate),
        bodyTemperatureCelsius: convertTemperatureToCelsius(bodyTemperature),
        bloodGlucoseMgDl: numberState(bloodGlucose),
        flightsClimbedToday: numberState(flightsClimbed),
        vo2Max: numberState(vo2Max),
        sleepHoursLastNight: numberState(sleep),
        sleepDeepMinutes: attrNumber(sleep, 'deep_minutes'),
        sleepRemMinutes: attrNumber(sleep, 'rem_minutes'),
        sleepCoreMinutes: attrNumber(sleep, 'core_minutes'),
        sleepAwakeMinutes: attrNumber(sleep, 'awake_minutes'),
        sleepStartedAt: attrString(sleepOnset, 'timestamp'),
        sleepEndedAt: attrString(sleepWake, 'timestamp'),
        latestWeightKg: convertMassToKg(weight),
        bodyMassIndex: numberState(bodyMassIndex),
        bodyFatPercent: numberState(bodyFat),
        leanBodyMassKg: convertMassToKg(leanBodyMass),
        heightMeters: convertLengthToMeters(height),
        waistCircumferenceMeters: convertLengthToMeters(waistCircumference),
        lastWorkout: hasWorkout ? lastWorkout : undefined,
    };

    return hasSnapshotValues(snapshot) ? snapshot : null;
};

export const loadExternalHealthSnapshot = (): ExternalHealthSnapshot | null => {
    try {
        const raw = localStorage.getItem(EXTERNAL_HEALTH_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<ExternalHealthSnapshot>;
        if (parsed.source !== 'healthsync-home-assistant' || typeof parsed.updatedAt !== 'string') return null;
        return parsed as ExternalHealthSnapshot;
    } catch {
        return null;
    }
};

export const saveExternalHealthSnapshot = (snapshot: ExternalHealthSnapshot): void => {
    localStorage.setItem(EXTERNAL_HEALTH_KEY, JSON.stringify(snapshot));
};

// [EM-START: apple-health-daily-history]
// HealthSync 会把所有 Apple 原始样本永久归档在 HA 内。这里仅缓存按日汇总，
// 原始读数仍以 Home Assistant 为事实来源，避免在 LiliumOS 复制一整套健康库。
export const loadExternalHealthDailySummaries = (): Record<string, ExternalHealthSnapshot> => {
    try {
        const raw = localStorage.getItem(EXTERNAL_HEALTH_DAILY_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, Partial<ExternalHealthSnapshot>>;
        return Object.fromEntries(Object.entries(parsed).filter(([date, snapshot]) =>
            /^\d{4}-\d{2}-\d{2}$/.test(date)
            && snapshot.source === 'healthsync-home-assistant'
            && snapshot.summaryKind === 'daily'
            && snapshot.summaryDate === date
            && typeof snapshot.fetchedAt === 'string'
            && typeof snapshot.updatedAt === 'string',
        )) as Record<string, ExternalHealthSnapshot>;
    } catch {
        return {};
    }
};

export const loadExternalHealthDailySummary = (date: string): ExternalHealthSnapshot | null =>
    loadExternalHealthDailySummaries()[date] ?? null;

export const saveExternalHealthDailySummary = (summary: ExternalHealthSnapshot): void => {
    if (summary.summaryKind !== 'daily' || !summary.summaryDate) return;
    const summaries = loadExternalHealthDailySummaries();
    summaries[summary.summaryDate] = summary;
    const trimmed = Object.fromEntries(
        Object.entries(summaries)
            .sort(([left], [right]) => right.localeCompare(left))
            .slice(0, MAX_DAILY_SUMMARIES),
    );
    localStorage.setItem(EXTERNAL_HEALTH_DAILY_KEY, JSON.stringify(trimmed));
};

const HISTORY_METRICS: HealthSyncHistoryMetric[] = [
    'steps', 'heartRate', 'heartRateVariability', 'sleep', 'activeCalories', 'workouts',
    'flightsClimbed', 'exerciseTime', 'restingEnergy', 'distanceWalkingRunning', 'vo2Max',
    'weight', 'restingHeartRate', 'bloodPressureSystolic', 'bloodPressureDiastolic',
    'walkingHeartRateAverage', 'heartRateRecoveryOneMinute', 'atrialFibrillationBurden',
    'oxygenSaturation', 'respiratoryRate', 'bodyTemperature', 'bloodGlucose', 'bodyMassIndex',
    'bodyFatPercentage', 'leanBodyMass', 'height', 'waistCircumference',
];

const DAILY_TOTAL_METRICS = new Set<HealthSyncHistoryMetric>([
    'steps', 'activeCalories', 'flightsClimbed', 'exerciseTime', 'restingEnergy',
    'distanceWalkingRunning',
]);

const AVERAGE_METRICS = new Set<HealthSyncHistoryMetric>([
    'heartRate', 'heartRateVariability', 'restingHeartRate', 'bloodPressureSystolic',
    'bloodPressureDiastolic', 'walkingHeartRateAverage', 'heartRateRecoveryOneMinute',
    'atrialFibrillationBurden', 'oxygenSaturation', 'respiratoryRate', 'bodyTemperature',
    'bloodGlucose',
]);

const parseDateKey = (date: string): Date => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new Error('健康数据日期格式无效');
    const result = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(result.getTime()) || result.getMonth() !== Number(match[2]) - 1) {
        throw new Error('健康数据日期无效');
    }
    return result;
};

const localDateKey = (date: Date): string => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
].join('-');

const readingTimestamp = (reading: HealthSyncReading): number => {
    const raw = reading.end_date || reading.start_date || '';
    const timestamp = Date.parse(raw);
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const numericReadingValue = (reading: HealthSyncReading): number | undefined => {
    if (reading.value === undefined || reading.value === null) return undefined;
    const value = Number(reading.value);
    return Number.isFinite(value) ? value : undefined;
};

const convertReadingValue = (metric: HealthSyncHistoryMetric, reading: HealthSyncReading): number | undefined => {
    const value = numericReadingValue(reading);
    if (value === undefined) return undefined;
    const unit = String(reading.unit || '').trim().toLowerCase();
    if (metric === 'distanceWalkingRunning') {
        if (unit === 'km') return value * 1000;
        if (unit === 'mi') return value * 1609.344;
    }
    if (metric === 'weight' || metric === 'leanBodyMass') {
        if (unit === 'lb' || unit === 'lbs') return value * 0.45359237;
    }
    if (metric === 'height' || metric === 'waistCircumference') {
        if (unit === 'ft' || unit === 'feet') return value * 0.3048;
        if (unit === 'in' || unit === 'inch' || unit === 'inches') return value * 0.0254;
        if (unit === 'cm') return value / 100;
        if (unit === 'mm') return value / 1000;
    }
    if (metric === 'bodyTemperature' && (unit === '°f' || unit === 'f' || unit === 'fahrenheit')) {
        return (value - 32) * 5 / 9;
    }
    return value;
};

const round = (value: number | undefined, digits = 1): number | undefined => {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
};

const latestReading = (readings: HealthSyncReading[]): HealthSyncReading | undefined =>
    readings.reduce<HealthSyncReading | undefined>((latest, reading) =>
        !latest || readingTimestamp(reading) >= readingTimestamp(latest) ? reading : latest,
    undefined);

const aggregateDailyTotal = (
    metric: HealthSyncHistoryMetric,
    readings: HealthSyncReading[],
): number | undefined => {
    const bySource = new Map<string, number>();
    readings.forEach((reading) => {
        if (reading.daily_total) return;
        const value = convertReadingValue(metric, reading);
        if (value === undefined) return;
        const source = reading.source?.trim() || 'unknown';
        bySource.set(source, (bySource.get(source) ?? 0) + value);
    });
    if (bySource.size) return round(Math.max(...bySource.values()), 2);
    const snapshot = latestReading(readings.filter(reading => Boolean(reading.daily_total)));
    return snapshot ? round(convertReadingValue(metric, snapshot), 2) : undefined;
};

const aggregateAverage = (
    metric: HealthSyncHistoryMetric,
    readings: HealthSyncReading[],
): number | undefined => {
    const values = readings
        .filter(reading => !reading.daily_total)
        .map(reading => convertReadingValue(metric, reading))
        .filter((value): value is number => value !== undefined);
    return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : undefined;
};

const aggregateLatest = (
    metric: HealthSyncHistoryMetric,
    readings: HealthSyncReading[],
): number | undefined => {
    const latest = latestReading(readings.filter(reading => !reading.daily_total));
    return latest ? round(convertReadingValue(metric, latest), 3) : undefined;
};

const durationMinutes = (reading: HealthSyncReading): number | undefined => {
    const value = numericReadingValue(reading);
    if (value !== undefined) return value;
    const start = Date.parse(reading.start_date || '');
    const end = Date.parse(reading.end_date || '');
    return Number.isFinite(start) && Number.isFinite(end) && end >= start
        ? (end - start) / 60_000
        : undefined;
};

const aggregateSleep = (readings: HealthSyncReading[]): Partial<ExternalHealthSnapshot> => {
    const snapshots = readings.filter(reading => Boolean(reading.daily_total));
    const total = latestReading(snapshots.filter(reading => !reading.sleep_stage));
    const latestStage = (stage: string): HealthSyncReading | undefined => latestReading(
        snapshots.filter(reading => reading.sleep_stage === stage),
    );
    if (total) {
        return {
            sleepHoursLastNight: round((numericReadingValue(total) ?? 0) / 60, 2),
            sleepDeepMinutes: round(numericReadingValue(latestStage('asleepDeep') || {}), 1),
            sleepRemMinutes: round(numericReadingValue(latestStage('asleepREM') || {}), 1),
            sleepCoreMinutes: round(numericReadingValue(latestStage('asleepCore') || {}), 1),
            sleepAwakeMinutes: round(numericReadingValue(latestStage('awake') || {}), 1),
            sleepStartedAt: total.start_date || undefined,
            sleepEndedAt: total.end_date || undefined,
        };
    }

    const bySource = new Map<string, Record<string, number>>();
    readings.filter(reading => !reading.daily_total && reading.sleep_stage).forEach((reading) => {
        const minutes = durationMinutes(reading);
        if (minutes === undefined) return;
        const source = reading.source?.trim() || 'unknown';
        const stages = bySource.get(source) ?? {};
        stages[reading.sleep_stage!] = (stages[reading.sleep_stage!] ?? 0) + minutes;
        bySource.set(source, stages);
    });
    const selected = [...bySource.values()].sort((left, right) => {
        const asleep = (stages: Record<string, number>) =>
            (stages.asleepDeep ?? 0) + (stages.asleepREM ?? 0) + (stages.asleepCore ?? 0)
            + (stages.asleepUnspecified ?? 0);
        return asleep(right) - asleep(left);
    })[0];
    if (!selected) return {};
    const asleepMinutes = (selected.asleepDeep ?? 0) + (selected.asleepREM ?? 0)
        + (selected.asleepCore ?? 0) + (selected.asleepUnspecified ?? 0);
    const raw = readings.filter(reading => !reading.daily_total && reading.sleep_stage);
    const startedAt = raw.map(reading => reading.start_date).filter((value): value is string => Boolean(value)).sort()[0];
    const endedAt = raw.map(reading => reading.end_date).filter((value): value is string => Boolean(value)).sort().at(-1);
    return {
        sleepHoursLastNight: round(asleepMinutes / 60, 2),
        sleepDeepMinutes: round(selected.asleepDeep, 1),
        sleepRemMinutes: round(selected.asleepREM, 1),
        sleepCoreMinutes: round(selected.asleepCore, 1),
        sleepAwakeMinutes: round(selected.awake, 1),
        sleepStartedAt: startedAt,
        sleepEndedAt: endedAt,
    };
};

const aggregateWorkout = (readings: HealthSyncReading[]): ExternalHealthWorkout | undefined => {
    const latest = latestReading(readings.filter(reading => !reading.daily_total));
    if (!latest) return undefined;
    const start = Date.parse(latest.start_date || '');
    const end = Date.parse(latest.end_date || '');
    return {
        type: latest.workout_type || undefined,
        durationMinutes: Number.isFinite(start) && Number.isFinite(end) && end >= start
            ? round((end - start) / 60_000, 1)
            : undefined,
        calories: round(numericReadingValue(latest), 1),
        distanceMeters: latest.distance === undefined || latest.distance === null
            ? undefined
            : round(Number(latest.distance), 1),
        startedAt: latest.start_date || undefined,
        endedAt: latest.end_date || undefined,
    };
};

const metricValue = (
    metric: HealthSyncHistoryMetric,
    readings: HealthSyncReading[],
): number | undefined => {
    if (DAILY_TOTAL_METRICS.has(metric)) return aggregateDailyTotal(metric, readings);
    if (AVERAGE_METRICS.has(metric)) return aggregateAverage(metric, readings);
    return aggregateLatest(metric, readings);
};

export const aggregateExternalHealthDailySummary = (
    date: string,
    readingsByMetric: HealthSyncReadingsByMetric,
    now = new Date(),
): ExternalHealthSnapshot => {
    parseDateKey(date);
    const values = (metric: HealthSyncHistoryMetric) => readingsByMetric[metric] ?? [];
    const timestamps = Object.values(readingsByMetric).flatMap(readings =>
        (readings ?? []).flatMap(reading => [reading.end_date, reading.start_date]),
    ).filter((value): value is string => Boolean(value))
        .map(value => Date.parse(value))
        .filter(Number.isFinite);
    const fetchedAt = now.toISOString();
    const summary: ExternalHealthSnapshot = {
        source: 'healthsync-home-assistant',
        fetchedAt,
        updatedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : fetchedAt,
        summaryDate: date,
        summaryKind: 'daily',
        stepsToday: metricValue('steps', values('steps')),
        activeCaloriesToday: metricValue('activeCalories', values('activeCalories')),
        exerciseMinutesToday: metricValue('exerciseTime', values('exerciseTime')),
        restingEnergyToday: metricValue('restingEnergy', values('restingEnergy')),
        walkingRunningDistanceMetersToday: metricValue('distanceWalkingRunning', values('distanceWalkingRunning')),
        latestHeartRate: metricValue('heartRate', values('heartRate')),
        restingHeartRate: metricValue('restingHeartRate', values('restingHeartRate')),
        walkingHeartRate: metricValue('walkingHeartRateAverage', values('walkingHeartRateAverage')),
        heartRateRecovery: metricValue('heartRateRecoveryOneMinute', values('heartRateRecoveryOneMinute')),
        hrvMs: metricValue('heartRateVariability', values('heartRateVariability')),
        bloodPressureSystolic: metricValue('bloodPressureSystolic', values('bloodPressureSystolic')),
        bloodPressureDiastolic: metricValue('bloodPressureDiastolic', values('bloodPressureDiastolic')),
        afibBurdenPercent: metricValue('atrialFibrillationBurden', values('atrialFibrillationBurden')),
        bloodOxygenPercent: metricValue('oxygenSaturation', values('oxygenSaturation')),
        respiratoryRate: metricValue('respiratoryRate', values('respiratoryRate')),
        bodyTemperatureCelsius: metricValue('bodyTemperature', values('bodyTemperature')),
        bloodGlucoseMgDl: metricValue('bloodGlucose', values('bloodGlucose')),
        flightsClimbedToday: metricValue('flightsClimbed', values('flightsClimbed')),
        vo2Max: metricValue('vo2Max', values('vo2Max')),
        latestWeightKg: metricValue('weight', values('weight')),
        bodyMassIndex: metricValue('bodyMassIndex', values('bodyMassIndex')),
        bodyFatPercent: metricValue('bodyFatPercentage', values('bodyFatPercentage')),
        leanBodyMassKg: metricValue('leanBodyMass', values('leanBodyMass')),
        heightMeters: metricValue('height', values('height')),
        waistCircumferenceMeters: metricValue('waistCircumference', values('waistCircumference')),
        ...aggregateSleep(values('sleep')),
        lastWorkout: aggregateWorkout(values('workouts')),
    };
    return summary;
};

const mergeDefinedSummary = (
    base: ExternalHealthSnapshot,
    summary: ExternalHealthSnapshot,
): ExternalHealthSnapshot => {
    const merged: ExternalHealthSnapshot = { ...base };
    Object.entries(summary).forEach(([key, value]) => {
        if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
    });
    return merged;
};

const dateRangeForMetric = (date: string, metric: HealthSyncHistoryMetric): { start: string; end: string } => {
    const day = parseDateKey(date);
    if (metric === 'sleep') {
        const start = new Date(day);
        start.setDate(start.getDate() - 1);
        start.setHours(12, 0, 0, 0);
        const end = new Date(day);
        end.setHours(12, 0, 0, 0);
        return { start: start.toISOString(), end: end.toISOString() };
    }
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
};

const resolveHealthSyncDeviceId = async (
    config: SmartHomeConfig,
    states: HomeAssistantState[],
    timeoutMs: number,
): Promise<string> => {
    const sensor = states.find(isHealthSyncSensor);
    if (!sensor || !/^[a-z0-9_.]+$/i.test(sensor.entity_id)) {
        throw new Error('没有找到可用于读取历史的 HealthSync 设备');
    }
    const deviceId = await renderHomeAssistantTemplate(
        config,
        `{{ device_id('${sensor.entity_id}') }}`,
        { timeoutMs },
    );
    if (!deviceId || ['none', 'null', 'unknown'].includes(deviceId.toLowerCase())) {
        throw new Error('Home Assistant 没有返回 HealthSync 设备编号');
    }
    return deviceId;
};

export const syncExternalHealthDailySummary = async (
    date: string,
    config: SmartHomeConfig = loadSmartHomeConfig(),
    options: { timeoutMs?: number } = {},
): Promise<ExternalHealthSnapshot> => {
    if (!config.baseUrl || config.demoMode) throw new Error('请先在共栖舱连接真实 Home Assistant');
    const timeoutMs = options.timeoutMs ?? 10_000;
    const states = await fetchHomeAssistantStates(config, { timeoutMs });
    const deviceId = await resolveHealthSyncDeviceId(config, states, timeoutMs);
    const readingsByMetric: HealthSyncReadingsByMetric = {};
    let successfulActions = 0;

    // 控制并发，避免一次日期切换同时向小型 HA 虚拟机压入二十多条 SQLite 查询。
    for (let index = 0; index < HISTORY_METRICS.length; index += 6) {
        const batch = HISTORY_METRICS.slice(index, index + 6);
        const results = await Promise.allSettled(batch.map(async (metric) => {
            const range = dateRangeForMetric(date, metric);
            const response = await callHomeAssistantActionWithResponse<{ readings?: HealthSyncReading[] }>(
                config,
                'healthsync',
                'get_readings',
                { device_id: deviceId, metric, ...range },
                { timeoutMs },
            );
            return { metric, readings: Array.isArray(response.readings) ? response.readings : [] };
        }));
        results.forEach((result) => {
            if (result.status !== 'fulfilled') return;
            successfulActions += 1;
            readingsByMetric[result.value.metric] = result.value.readings;
        });
    }
    if (!successfulActions) {
        throw new Error('HealthSync 历史读取失败，请确认 HACS 集成已更新');
    }

    let summary = aggregateExternalHealthDailySummary(date, readingsByMetric);
    if (date === localDateKey(new Date())) {
        const live = parseExternalHealthSnapshot(states);
        if (live) {
            saveExternalHealthSnapshot(live);
            // 当天累计总量以 HealthKit 的权威快照为准；心率等日均值则来自原始档案。
            summary = mergeDefinedSummary(live, summary);
            const totalFields: Array<keyof ExternalHealthSnapshot> = [
                'stepsToday', 'activeCaloriesToday', 'exerciseMinutesToday', 'restingEnergyToday',
                'walkingRunningDistanceMetersToday', 'flightsClimbedToday',
            ];
            totalFields.forEach((field) => {
                const value = live[field];
                if (value !== undefined) (summary as unknown as Record<string, unknown>)[field] = value;
            });
        }
    }
    if (!hasSnapshotValues(summary)) throw new Error('HealthSync 在这一天还没有归档数据');
    summary.summaryDate = date;
    summary.summaryKind = 'daily';
    saveExternalHealthDailySummary(summary);
    return summary;
};

export const refreshExternalHealthDailySummary = async (
    date: string,
    options: { maxAgeMs?: number; timeoutMs?: number } = {},
): Promise<ExternalHealthSnapshot | null> => {
    const cached = loadExternalHealthDailySummary(date);
    const defaultMaxAge = date === localDateKey(new Date()) ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const maxAgeMs = options.maxAgeMs ?? defaultMaxAge;
    const fetchedAt = cached ? Date.parse(cached.fetchedAt) : Number.NaN;
    if (cached && Number.isFinite(fetchedAt) && Date.now() - fetchedAt < maxAgeMs) return cached;
    try {
        return await syncExternalHealthDailySummary(date, loadSmartHomeConfig(), {
            timeoutMs: options.timeoutMs ?? 10_000,
        });
    } catch {
        return cached;
    }
};
// [EM-END: apple-health-daily-history]

export const syncExternalHealthSnapshot = async (
    config: SmartHomeConfig = loadSmartHomeConfig(),
    options: { timeoutMs?: number } = {},
): Promise<ExternalHealthSnapshot> => {
    if (!config.baseUrl || config.demoMode) {
        throw new Error('请先在共栖舱连接真实 Home Assistant');
    }
    const states = await fetchHomeAssistantStates(config, { timeoutMs: options.timeoutMs ?? 8000 });
    const snapshot = parseExternalHealthSnapshot(states);
    if (!snapshot) throw new Error('Home Assistant 里还没有发现 HealthSync 数据');
    saveExternalHealthSnapshot(snapshot);
    return snapshot;
};

export const refreshExternalHealthSnapshot = async (options: {
    maxAgeMs?: number;
    timeoutMs?: number;
} = {}): Promise<ExternalHealthSnapshot | null> => {
    const cached = loadExternalHealthSnapshot();
    const maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
    const fetchedAt = cached ? Date.parse(cached.fetchedAt) : Number.NaN;
    if (cached && Number.isFinite(fetchedAt) && Date.now() - fetchedAt < maxAgeMs) return cached;
    try {
        return await syncExternalHealthSnapshot(loadSmartHomeConfig(), { timeoutMs: options.timeoutMs ?? 1800 });
    } catch {
        return cached;
    }
};
