import { describe, expect, it } from 'vitest';
import { spaceKitchenMarkers } from './kitchenSceneMarkers';

describe('kitchen marker touch targets', () => {
  it('leaves separated food anchors unchanged', () => {
    const markers = [{ lotId: 'egg', x: 100, y: 100 }, { lotId: 'milk', x: 100, y: 200 }];
    expect(spaceKitchenMarkers(markers, 300, 420)).toEqual(markers);
  });
  it('separates narrow door-rack targets while retaining ids and staying inside the canvas', () => {
    const markers = Array.from({ length: 20 }, (_, index) => ({ lotId: String(index), x: 25, y: 150 }));
    const result = spaceKitchenMarkers(markers, 280, 420);
    expect(result.map(marker => marker.lotId)).toEqual(markers.map(marker => marker.lotId));
    result.forEach((marker, index) => {
      expect(marker.x).toBeGreaterThanOrEqual(22);
      expect(marker.x).toBeLessThanOrEqual(258);
      expect(marker.y).toBeGreaterThanOrEqual(22);
      expect(marker.y).toBeLessThanOrEqual(398);
      for (const other of result.slice(0, index)) {
        expect(Math.abs(marker.x - other.x) >= 44 || Math.abs(marker.y - other.y) >= 44).toBe(true);
      }
    });
  });
  it('retains every food if the viewport cannot fit all targets', () => {
    expect(spaceKitchenMarkers([{ lotId: 'a', x: -20, y: 30 }, { lotId: 'b', x: 100, y: 30 }], 44, 44))
      .toEqual([{ lotId: 'a', x: 22, y: 22 }, { lotId: 'b', x: 22, y: 22 }]);
  });
});
