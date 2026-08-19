import { getCurrentPositionSmart, type GeoResult } from './geo';

export type LocationZoneKind = 'home' | 'school' | 'supermarket';

export interface LocationZone {
  id: string;
  kind: LocationZoneKind;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  createdAt: number;
}

export interface CoarseLocationSnapshot {
  zoneId: string | null;
  label: string;
  accuracy: number;
  updatedAt: number;
}

export interface LocationAwarenessState {
  enabled: boolean;
  zones: LocationZone[];
  lastSnapshot: CoarseLocationSnapshot | null;
}

const STORAGE_KEY = 'liliumos_location_awareness_v1';
const DEFAULT_STATE: LocationAwarenessState = {
  enabled: true,
  zones: [],
  lastSnapshot: null,
};

export const LOCATION_FRESH_MS = 30 * 60 * 1000;
export const LOCATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function clampRadius(value: number): number {
  return Math.max(50, Math.min(2000, Math.round(value)));
}

function normalizeZone(value: unknown): LocationZone | null {
  if (!value || typeof value !== 'object') return null;
  const zone = value as Partial<LocationZone>;
  if (!['home', 'school', 'supermarket'].includes(zone.kind || '')) return null;
  if (!Number.isFinite(zone.latitude) || !Number.isFinite(zone.longitude)) return null;
  if (typeof zone.id !== 'string' || typeof zone.name !== 'string') return null;
  return {
    id: zone.id,
    kind: zone.kind as LocationZoneKind,
    name: zone.name.trim() || defaultZoneName(zone.kind as LocationZoneKind),
    latitude: Number(zone.latitude),
    longitude: Number(zone.longitude),
    radiusMeters: clampRadius(Number(zone.radiusMeters) || 250),
    createdAt: Number(zone.createdAt) || Date.now(),
  };
}

export function defaultZoneName(kind: LocationZoneKind): string {
  if (kind === 'home') return '家';
  if (kind === 'school') return '学校';
  return '常去超市';
}

export function loadLocationAwareness(): LocationAwarenessState {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_STATE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<LocationAwarenessState>;
    const zones = Array.isArray(parsed.zones)
      ? parsed.zones.map(normalizeZone).filter((zone): zone is LocationZone => !!zone)
      : [];
    const snapshot = parsed.lastSnapshot;
    const lastSnapshot = snapshot
      && typeof snapshot.label === 'string'
      && Number.isFinite(snapshot.updatedAt)
      ? {
          zoneId: typeof snapshot.zoneId === 'string' ? snapshot.zoneId : null,
          label: snapshot.label,
          accuracy: Number(snapshot.accuracy) || 0,
          updatedAt: Number(snapshot.updatedAt),
        }
      : null;
    return { enabled: parsed.enabled !== false, zones, lastSnapshot };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveLocationAwareness(state: LocationAwarenessState): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

function validCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

/**
 * Parses plain coordinates and full Google/Apple Maps URLs without contacting a
 * geocoding service. Short share links cannot be resolved offline.
 */
export function parseLocationCoordinates(input: string): LocationCoordinates | null {
  const text = input.trim();
  if (!text) return null;

  const candidates: Array<[string, string] | null> = [];
  const plain = text.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  candidates.push(plain ? [plain[1], plain[2]] : null);

  try {
    const url = new URL(text);
    const at = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    candidates.push(at ? [at[1], at[2]] : null);
    for (const key of ['q', 'query', 'll', 'center']) {
      const value = url.searchParams.get(key);
      const match = value?.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/);
      candidates.push(match ? [match[1], match[2]] : null);
    }
  } catch {
    // Plain coordinate input is handled above.
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const latitude = Number(candidate[0]);
    const longitude = Number(candidate[1]);
    if (validCoordinates(latitude, longitude)) return { latitude, longitude };
  }
  return null;
}

export function haversineMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latA = toRadians(latitudeA);
  const latB = toRadians(latitudeB);
  const deltaLat = toRadians(latitudeB - latitudeA);
  const deltaLon = toRadians(longitudeB - longitudeA);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function matchLocationZone(
  zones: LocationZone[],
  position: Pick<GeoResult, 'latitude' | 'longitude'>,
): LocationZone | null {
  return zones
    .map(zone => ({
      zone,
      distance: haversineMeters(position.latitude, position.longitude, zone.latitude, zone.longitude),
    }))
    .filter(entry => entry.distance <= entry.zone.radiusMeters)
    .sort((a, b) => a.distance - b.distance)[0]?.zone || null;
}

export function snapshotForPosition(
  zones: LocationZone[],
  position: GeoResult,
  updatedAt = Date.now(),
): CoarseLocationSnapshot {
  const zone = matchLocationZone(zones, position);
  return {
    zoneId: zone?.id || null,
    label: zone?.name || '在外面',
    accuracy: Math.round(position.accuracy),
    updatedAt,
  };
}

export async function refreshCoarseLocation(): Promise<LocationAwarenessState> {
  const state = loadLocationAwareness();
  const position = await getCurrentPositionSmart();
  const next = {
    ...state,
    lastSnapshot: snapshotForPosition(state.zones, position),
  };
  saveLocationAwareness(next);
  return next;
}

export async function addZoneAtCurrentPosition(
  kind: LocationZoneKind,
  name: string,
  radiusMeters: number,
): Promise<LocationAwarenessState> {
  const position = await getCurrentPositionSmart();
  return addLocationZone(kind, name, radiusMeters, position);
}

export function addLocationZone(
  kind: LocationZoneKind,
  name: string,
  radiusMeters: number,
  coordinates: LocationCoordinates,
): LocationAwarenessState {
  if (!validCoordinates(coordinates.latitude, coordinates.longitude)) {
    throw new Error('坐标无效，请重新选择地点');
  }
  const state = loadLocationAwareness();
  const zone: LocationZone = {
    id: crypto.randomUUID(),
    kind,
    name: name.trim() || defaultZoneName(kind),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    radiusMeters: clampRadius(radiusMeters),
    createdAt: Date.now(),
  };
  const withoutSingleton = kind === 'supermarket'
    ? state.zones
    : state.zones.filter(existing => existing.kind !== kind);
  const zones = [...withoutSingleton, zone];
  const next = {
    ...state,
    zones,
    lastSnapshot: Number.isFinite(coordinates.accuracy)
      ? snapshotForPosition(zones, {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          accuracy: Number(coordinates.accuracy),
        })
      : state.lastSnapshot?.zoneId && !zones.some(existing => existing.id === state.lastSnapshot?.zoneId)
        ? null
        : state.lastSnapshot,
  };
  saveLocationAwareness(next);
  return next;
}

export function removeLocationZone(zoneId: string): LocationAwarenessState {
  const state = loadLocationAwareness();
  const zones = state.zones.filter(zone => zone.id !== zoneId);
  const next = {
    ...state,
    zones,
    lastSnapshot: state.lastSnapshot?.zoneId === zoneId ? null : state.lastSnapshot,
  };
  saveLocationAwareness(next);
  return next;
}

export function setLocationAwarenessEnabled(enabled: boolean): LocationAwarenessState {
  const next = { ...loadLocationAwareness(), enabled };
  saveLocationAwareness(next);
  return next;
}

export function buildLocationChatContext(
  state = loadLocationAwareness(),
  now = Date.now(),
): string | null {
  if (!state.enabled || !state.lastSnapshot) return null;
  const age = Math.max(0, now - state.lastSnapshot.updatedAt);
  if (age > LOCATION_MAX_AGE_MS) return null;

  const minutes = Math.max(0, Math.round(age / 60000));
  const freshness = age <= LOCATION_FRESH_MS
    ? `约${minutes}分钟前更新`
    : `最近一次于约${minutes}分钟前更新，并非实时位置`;
  const outside = state.lastSnapshot.zoneId === null;
  return outside
    ? `【用户位置（粗略围栏）】在外面（${freshness}）。你不知道她的精确坐标或具体地点；如果当前话题自然需要，可以问她在哪里，但不要编造。不要无缘无故反复追问。`
    : `【用户位置（粗略围栏）】${state.lastSnapshot.label.startsWith('在') ? state.lastSnapshot.label : `在${state.lastSnapshot.label}`}（${freshness}）。你只知道这个语义地点，不知道精确坐标。除非话题相关，不要反复报出或追问位置。`;
}
