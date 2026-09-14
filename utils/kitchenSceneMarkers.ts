export interface KitchenSceneMarker { lotId: string; x: number; y: number }

// Preserve each food's projected anchor unless its 44px target overlaps another.
export function spaceKitchenMarkers(markers: KitchenSceneMarker[], width: number, height: number) {
  const placed: KitchenSceneMarker[] = [];
  const gap = 46;
  const clamp = (value: number, size: number) => Math.max(22, Math.min(size - 22, value));
  for (const marker of markers) {
    const anchor = { x: clamp(marker.x, width), y: clamp(marker.y, height) };
    const isFree = (point: { x: number; y: number }) => placed.every(other =>
      Math.abs(point.x - other.x) >= gap || Math.abs(point.y - other.y) >= gap);
    if (isFree(anchor)) { placed.push({ ...marker, ...anchor }); continue; }
    const xs = [...new Set([anchor.x, ...placed.flatMap(other => [other.x - gap, other.x + gap])])];
    const ys = [...new Set([anchor.y, ...placed.flatMap(other => [other.y - gap, other.y + gap])])];
    const candidates = xs.flatMap(x => ys.map(y => ({ x, y })))
      .filter(point => point.x >= 22 && point.x <= width - 22 && point.y >= 22 && point.y <= height - 22)
      .sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y));
    const position = candidates.find(isFree) ?? anchor;
    placed.push({ ...marker, ...position });
  }
  return placed;
}
