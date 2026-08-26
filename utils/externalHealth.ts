import {
    fetchHomeAssistantStates,
    loadSmartHomeConfig,
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
}

const EXTERNAL_HEALTH_KEY = 'liliumos.health.external.v1';
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
        !['source', 'fetchedAt', 'updatedAt'].includes(key) && value !== undefined,
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
