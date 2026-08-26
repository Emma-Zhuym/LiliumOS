import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    loadExternalHealthSnapshot,
    parseExternalHealthSnapshot,
    refreshExternalHealthSnapshot,
    syncExternalHealthSnapshot,
} from './externalHealth';
import { DEFAULT_SMART_HOME_CONFIG, saveSmartHomeConfig, type HomeAssistantState } from './smartHome';

const state = (
    entityId: string,
    value: string,
    friendlyName: string,
    attributes: Record<string, unknown> = {},
): HomeAssistantState => ({
    entity_id: entityId,
    state: value,
    attributes: { friendly_name: friendlyName, ...attributes },
    last_updated: '2026-08-26T13:20:00Z',
});

describe('HealthSync Home Assistant adapter', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('maps HealthSync daily totals, sleep, vitals, weight and the latest workout', () => {
        const snapshot = parseExternalHealthSnapshot([
            state('sensor.healthsync_steps_today', '8241', 'HealthSync Steps today'),
            state('sensor.healthsync_active_calories_today', '412.4', 'HealthSync Active calories today'),
            state('sensor.healthsync_exercise_time_today', '48', 'HealthSync Exercise time today'),
            state('sensor.healthsync_heart_rate', '82', 'HealthSync Heart rate'),
            state('sensor.healthsync_resting_heart_rate', '58', 'HealthSync Resting heart rate'),
            state('sensor.healthsync_walking_heart_rate', '91', 'HealthSync Walking heart rate'),
            state('sensor.healthsync_heart_rate_recovery', '27', 'HealthSync Heart rate recovery'),
            state('sensor.healthsync_heart_rate_variability', '42.5', 'HealthSync Heart rate variability'),
            state('sensor.healthsync_blood_pressure_systolic', '116', 'HealthSync Blood pressure systolic'),
            state('sensor.healthsync_blood_pressure_diastolic', '72', 'HealthSync Blood pressure diastolic'),
            state('sensor.healthsync_afib_burden', '0.4', 'HealthSync AFib burden'),
            state('sensor.healthsync_blood_oxygen', '98', 'HealthSync Blood oxygen'),
            state('sensor.healthsync_respiratory_rate', '15.2', 'HealthSync Respiratory rate'),
            state('sensor.healthsync_body_temperature', '98.6', 'HealthSync Body temperature', { unit_of_measurement: '°F' }),
            state('sensor.healthsync_blood_glucose', '94', 'HealthSync Blood glucose', { unit_of_measurement: 'mg/dL' }),
            state('sensor.healthsync_flights_climbed_today', '13', 'HealthSync Flights climbed today'),
            state('sensor.healthsync_vo2_max', '41.7', 'HealthSync VO2 max'),
            state('sensor.healthsync_sleep_last_night', '6.8', 'HealthSync Sleep last night', {
                deep_minutes: 72, rem_minutes: 94, core_minutes: 242, awake_minutes: 18,
            }),
            state('sensor.healthsync_fell_asleep', '00:17', 'HealthSync Fell asleep', {
                timestamp: '2026-08-26T00:17:00-05:00',
            }),
            state('sensor.healthsync_woke_up', '07:12', 'HealthSync Woke up', {
                timestamp: '2026-08-26T07:12:00-05:00',
            }),
            state('sensor.healthsync_weight', '121.3', 'HealthSync Weight', { unit_of_measurement: 'lb' }),
            state('sensor.healthsync_body_mass_index', '20.7', 'HealthSync Body mass index'),
            state('sensor.healthsync_body_fat_percentage', '22.4', 'HealthSync Body fat percentage'),
            state('sensor.healthsync_lean_body_mass', '95.7', 'HealthSync Lean body mass', { unit_of_measurement: 'lb' }),
            state('sensor.healthsync_height', '5.41', 'HealthSync Height', { unit_of_measurement: 'ft' }),
            state('sensor.healthsync_waist_circumference', '27.5', 'HealthSync Waist circumference', { unit_of_measurement: 'in' }),
            state('sensor.healthsync_last_workout_type', 'strengthTraining', 'HealthSync Last workout type', {
                started_at: '2026-08-26T11:00:00-05:00', ended_at: '2026-08-26T11:45:00-05:00',
            }),
            state('sensor.healthsync_last_workout_duration', '45', 'HealthSync Last workout duration'),
            state('sensor.healthsync_last_workout_calories', '236', 'HealthSync Last workout calories'),
            state('sensor.unrelated_steps', '99999', 'Phone steps'),
        ], new Date('2026-08-26T14:00:00Z'));

        expect(snapshot).toMatchObject({
            stepsToday: 8241,
            activeCaloriesToday: 412.4,
            exerciseMinutesToday: 48,
            latestHeartRate: 82,
            restingHeartRate: 58,
            walkingHeartRate: 91,
            heartRateRecovery: 27,
            hrvMs: 42.5,
            bloodPressureSystolic: 116,
            bloodPressureDiastolic: 72,
            afibBurdenPercent: 0.4,
            bloodOxygenPercent: 98,
            respiratoryRate: 15.2,
            bodyTemperatureCelsius: 37,
            bloodGlucoseMgDl: 94,
            flightsClimbedToday: 13,
            vo2Max: 41.7,
            sleepHoursLastNight: 6.8,
            sleepDeepMinutes: 72,
            sleepStartedAt: '2026-08-26T00:17:00-05:00',
            latestWeightKg: 55,
            bodyMassIndex: 20.7,
            bodyFatPercent: 22.4,
            leanBodyMassKg: 43.4,
            heightMeters: 1.649,
            waistCircumferenceMeters: 0.699,
            lastWorkout: {
                type: 'strengthTraining', durationMinutes: 45, calories: 236,
                startedAt: '2026-08-26T11:00:00-05:00',
            },
        });
    });

    it('returns null when HA has no HealthSync sensors', () => {
        expect(parseExternalHealthSnapshot([
            state('sensor.iphone_steps', '1000', 'iPhone Steps'),
        ])).toBeNull();
    });

    it('fetches through the existing HA connection and caches the snapshot', async () => {
        const config = {
            ...DEFAULT_SMART_HOME_CONFIG,
            baseUrl: 'https://ha.example.com',
            token: 'token',
            demoMode: false,
        };
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
            state('sensor.healthsync_steps_today', '4321', 'HealthSync Steps today'),
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const snapshot = await syncExternalHealthSnapshot(config);

        expect(snapshot.stepsToday).toBe(4321);
        expect(loadExternalHealthSnapshot()?.stepsToday).toBe(4321);
        expect(fetchMock.mock.calls[0][0]).toBe('https://ha.example.com/api/states');
        expect((fetchMock.mock.calls[0][1]?.headers as Headers).get('Authorization')).toBe('Bearer token');
    });

    it('uses a fresh cached snapshot without another network request', async () => {
        saveSmartHomeConfig({
            ...DEFAULT_SMART_HOME_CONFIG,
            baseUrl: 'https://ha.example.com',
            token: 'token',
            demoMode: false,
        });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
            state('sensor.healthsync_steps_today', '100', 'HealthSync Steps today'),
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        await syncExternalHealthSnapshot();
        fetchMock.mockClear();

        expect((await refreshExternalHealthSnapshot({ maxAgeMs: 60_000 }))?.stepsToday).toBe(100);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
