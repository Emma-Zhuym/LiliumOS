import type { KitchenFridgePlacement } from './kitchenDb';

// Shared by the GLB builder and inventory projection. Dimensions are in scene units.
export const FRIDGE_SHELVES = {
  fridge: [1.3, 0.93, 0.56],
  freezer: [2.19, 1.8525],
} as const;

export const FRIDGE_DOOR_RACKS = {
  fridge: [
    { placement: 'door-upper', baseY: 1.4, wallHeight: 0.1, foodHeight: 0.24 },
    { placement: 'door-middle', baseY: 0.94, wallHeight: 0.12, foodHeight: 0.31 },
    { placement: 'door-lower', baseY: 0.42, wallHeight: 0.14, foodHeight: 0.31 },
  ],
  freezer: [
    { placement: 'door-upper', baseY: 2.25, wallHeight: 0.09, foodHeight: 0.17 },
    { placement: 'door-lower', baseY: 1.835, wallHeight: 0.1, foodHeight: 0.28 },
  ],
} as const;

export function fridgePlacementOptions(zone: 'fridge' | 'freezer') {
  const labels = { 'door-upper': '门内上层', 'door-middle': '门内中层', 'door-lower': '门内下层' };
  return [
    { value: 'shelf' as KitchenFridgePlacement, label: zone === 'fridge' ? '冷藏层板' : '冷冻层板' },
    ...FRIDGE_DOOR_RACKS[zone].map(rack => ({ value: rack.placement, label: labels[rack.placement] })),
  ];
}

export const fridgeDoorParent = (zone: 'fridge' | 'freezer') => zone === 'freezer' ? 'FreezerDoorPivot' : 'DoorPivot';
