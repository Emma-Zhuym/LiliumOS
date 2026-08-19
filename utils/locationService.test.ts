import { beforeEach, describe, expect, it } from 'vitest';
import {
  addLocationZone,
  buildLocationChatContext,
  haversineMeters,
  loadLocationAwareness,
  matchLocationZone,
  parseLocationCoordinates,
  saveLocationAwareness,
  snapshotForPosition,
  type LocationZone,
} from './locationService';

const home: LocationZone = {
  id: 'home',
  kind: 'home',
  name: '在家',
  latitude: 33.5,
  longitude: -86.8,
  radiusMeters: 250,
  createdAt: 1,
};

describe('locationService', () => {
  beforeEach(() => localStorage.clear());

  it('matches a point inside a geofence and rejects a distant point', () => {
    expect(matchLocationZone([home], { latitude: 33.5005, longitude: -86.8 })?.id).toBe('home');
    expect(matchLocationZone([home], { latitude: 33.51, longitude: -86.8 })).toBeNull();
  });

  it('uses the nearest matching zone when geofences overlap', () => {
    const shop = { ...home, id: 'shop', kind: 'supermarket' as const, name: '超市', latitude: 33.5004 };
    expect(matchLocationZone([home, shop], { latitude: 33.50035, longitude: -86.8 })?.id).toBe('shop');
  });

  it('stores only a coarse snapshot after matching', () => {
    const snapshot = snapshotForPosition([home], { latitude: 33.5, longitude: -86.8, accuracy: 12 }, 1000);
    expect(snapshot).toEqual({ zoneId: 'home', label: '在家', accuracy: 12, updatedAt: 1000 });
    expect(snapshot).not.toHaveProperty('latitude');
    expect(snapshot).not.toHaveProperty('longitude');
  });

  it('injects a privacy-safe outside hint and expires old snapshots', () => {
    const now = 10_000_000;
    const state = { enabled: true, zones: [home], lastSnapshot: { zoneId: null, label: '在外面', accuracy: 20, updatedAt: now - 60_000 } };
    const prompt = buildLocationChatContext(state, now);
    expect(prompt).toContain('在外面');
    expect(prompt).toContain('不知道她的精确坐标');
    expect(prompt).not.toContain('33.5');
    expect(buildLocationChatContext({ ...state, lastSnapshot: { ...state.lastSnapshot, updatedAt: now - 7 * 60 * 60 * 1000 } }, now)).toBeNull();
  });

  it('persists the privacy switch and zones locally', () => {
    saveLocationAwareness({ enabled: false, zones: [home], lastSnapshot: null });
    expect(loadLocationAwareness()).toMatchObject({ enabled: false, zones: [{ id: 'home' }] });
  });

  it('parses coordinates and full map links without geocoding', () => {
    expect(parseLocationCoordinates('33.5, -86.8')).toEqual({ latitude: 33.5, longitude: -86.8 });
    expect(parseLocationCoordinates('https://www.google.com/maps/place/Test/@33.501,-86.802,16z'))
      .toEqual({ latitude: 33.501, longitude: -86.802 });
    expect(parseLocationCoordinates('https://maps.apple.com/?ll=33.502%2C-86.803'))
      .toEqual({ latitude: 33.502, longitude: -86.803 });
    expect(parseLocationCoordinates('https://maps.app.goo.gl/short-link')).toBeNull();
  });

  it('stores a manually selected map point as a local zone', () => {
    const state = addLocationZone('school', '学校', 300, { latitude: 33.51, longitude: -86.81 });
    expect(state.zones[0]).toMatchObject({ kind: 'school', name: '学校', radiusMeters: 300 });
    expect(loadLocationAwareness().zones[0]).toMatchObject({ latitude: 33.51, longitude: -86.81 });
  });

  it('calculates realistic short distances', () => {
    expect(haversineMeters(33.5, -86.8, 33.501, -86.8)).toBeGreaterThan(100);
    expect(haversineMeters(33.5, -86.8, 33.501, -86.8)).toBeLessThan(120);
  });
});
