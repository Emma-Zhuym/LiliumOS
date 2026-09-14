import { describe, expect, it } from 'vitest';
import { eggVisibleCount, fridgeLayout, kitchenModelFor } from './kitchenSceneLayout';
import { FRIDGE_DOOR_RACKS, FRIDGE_SHELVES, fridgeDoorParent, fridgePlacementOptions } from './kitchenFridgeSpec';
import type { KitchenLot } from './kitchenDb';
import fs from 'node:fs';
import path from 'node:path';

const lot = (index: number, extra: Partial<KitchenLot> = {}): KitchenLot => ({
  id: `lot-${index}`, foodId: `food-${index}`, createdAt: index, updatedAt: index,
  quantity: 1, unit: 'pack', packageState: 'sealed', foodState: 'raw', storageZone: 'fridge', ...extra,
});

describe('fridge inventory projection', () => {
  it('keeps eggs and bottles together on the chosen rack without overlap', () => {
    const egg = lot(0, { unit: 'piece', quantity: 5, fridgePlacement: 'door-middle' });
    const food = { id: egg.foodId, name: '鸡蛋', normalizedName: '鸡蛋', defaultUnit: 'piece' as const, createdAt: 0, updatedAt: 0 };
    const result = fridgeLayout([egg, lot(1, { fridgePlacement: 'door-middle' })], [food]);
    expect(result.entries).toHaveLength(2);
    const [a, b] = result.entries;
    expect(a.position[1]).toBeCloseTo(0.954);
    expect(a.position[0] + a.width * a.scale / 2).toBeCloseTo(b.position[0] - b.width * b.scale / 2);
    expect(eggVisibleCount(egg)).toBe(5);
    expect(eggVisibleCount({ ...egg, quantity: 20 })).toBe(12);
    expect(eggVisibleCount({ ...egg, quantity: 1, unit: 'box' })).toBe(12);
  });
  it('fits all twenty lots on real shelves without dropping, duplicating or overlapping them', () => {
    const lots = Array.from({ length: 20 }, (_, i) => lot(i));
    const { entries } = fridgeLayout(lots, []);
    expect(entries).toHaveLength(20);
    expect(new Set(entries.map(entry => entry.lot.id)).size).toBe(20);
    for (const height of [1.3, 0.93, 0.56]) {
      const row = entries.filter(entry => entry.position[1] === height);
      row.forEach((entry, i) => {
        const left = entry.position[0] - entry.width * entry.scale / 2;
        const right = entry.position[0] + entry.width * entry.scale / 2;
        expect(left).toBeGreaterThanOrEqual(-0.541);
        expect(right).toBeLessThanOrEqual(0.541);
        if (i) expect(left).toBeCloseTo(row[i-1].position[0] + row[i-1].width * row[i-1].scale / 2);
      });
    }
    expect(lots.every(item => item.quantity === 1)).toBe(true);
  });
  it('keeps every door-rack lot and frozen lot visible', () => {
    for (const placement of ['door-upper', 'door-middle', 'door-lower'] as const) {
      const entries = fridgeLayout(Array.from({ length: 20 }, (_, i) => lot(i, { fridgePlacement: placement })), []).entries;
      expect(entries).toHaveLength(20);
      expect(entries.every(entry => entry.placement === placement && entry.scale > 0)).toBe(true);
    }
    const frozen = fridgeLayout(Array.from({ length: 10 }, (_, i) => lot(i, { storageZone: 'freezer' })), [], 'freezer');
    expect(frozen.entries).toHaveLength(10);
    expect(frozen.entries.every(entry => FRIDGE_SHELVES.freezer.some(height => entry.position[1] === height))).toBe(true);
  });
  it('excludes empty and other zones, and restores inventory after undo', () => {
    const items = [lot(0, { quantity: 0 }), lot(1, { storageZone: 'pantry' }), lot(2, { storageZone: 'freezer' })];
    expect(fridgeLayout(items, [])).toEqual({ entries: [], total: 0 });
    expect(fridgeLayout([{ ...items[0], quantity: 1 }], []).entries).toHaveLength(1);
    const partial = lot(3, { trackingMode: 'divisible', openContainerRemaining: 0.01 });
    expect(fridgeLayout([partial], []).entries[0].lot).toEqual(partial);
  });
  it('places all frozen inventory on its own two door racks or shelves with safe heights', () => {
    const items = ['door-upper', 'door-lower', 'shelf', 'door-middle'].map((placement, i) =>
      lot(i, { storageZone: 'freezer', fridgePlacement: placement as KitchenLot['fridgePlacement'] }));
    const { entries } = fridgeLayout(items, [], 'freezer');
    expect(new Set(entries.map(entry => entry.lot.id)).size).toBe(4);
    expect(entries).toHaveLength(4);
    const upper = entries.find(entry => entry.lot.id === 'lot-0')!;
    const lower = entries.find(entry => entry.lot.id === 'lot-1')!;
    expect(upper.placement).toBe('door-upper');
    expect(lower.placement).toBe('door-lower');
    expect(upper.position[1] + upper.maxHeight).toBeLessThan(2.45);
    expect(lower.position[1] + lower.maxHeight).toBeLessThan(2.23);
    expect(entries.find(entry => entry.lot.id === 'lot-3')?.placement).toBe('shelf');
    expect(fridgePlacementOptions('freezer').map(option => option.value)).toEqual(['shelf', 'door-upper', 'door-lower']);
  });
  it('maps display models conservatively and falls back for unknown food', () => {
    expect(kitchenModelFor('鸡蛋')).toBe('egg-carton');
    expect(kitchenModelFor('全脂牛奶')).toBe('carton');
    expect(kitchenModelFor('牛肉')).toBe('meat-raw');
    expect(kitchenModelFor('生日蛋糕')).toBe('bag');
    expect(kitchenModelFor('未知食材')).toBe('bag');
  });
});

describe('shipped kitchen model contract', () => {
  const directory = path.resolve('public/kitchen/models');
  const readModel = (name: string) => {
    const bytes = fs.readFileSync(path.join(directory, `${name}.glb`));
    expect(bytes.toString('utf8', 0, 4)).toBe('glTF');
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    return JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  };
  it('ships all external image dependencies beside the GLBs', () => {
    for (const name of ['egg-carton', 'carton', 'meat-raw', 'bag', 'fridge']) {
      const model = readModel(name);
      expect(model.meshes.length).toBeGreaterThan(0);
      for (const image of model.images ?? []) {
        if (image.uri && !image.uri.startsWith('data:')) expect(fs.existsSync(path.join(directory, image.uri))).toBe(true);
      }
    }
  });
  it('keeps a separate door pivot and shelves at the inventory slot heights', () => {
    const nodes = readModel('fridge').nodes;
    const pivot = nodes.find((node: { name: string }) => node.name === 'DoorPivot');
    expect(pivot.children.length).toBeGreaterThan(1);
    for (const name of ['FreezerDoorPivot', 'CrisperLeft', 'CrisperRight']) expect(nodes.some((node: { name: string }) => node.name === name)).toBe(true);
    for (const top of [...FRIDGE_SHELVES.fridge, ...FRIDGE_SHELVES.freezer]) expect(nodes.some((node: { name: string }) => node.name === `Shelf-${top}`)).toBe(true);
    const model = readModel('fridge');
    expect(model.materials.find((material: { name: string }) => material.name === 'Clear crisper plastic').alphaMode).toBe('BLEND');
    for (const name of ['Satin enamel', 'Brushed aluminium']) {
      const material = model.materials.find((item: { name: string }) => item.name === name);
      const image = model.images[model.textures[material.normalTexture.index].source];
      expect(image.mimeType).toBe('image/png');
      expect(model.bufferViews[image.bufferView].byteLength).toBeGreaterThan(0);
    }
  });
  it('ships twelve separately hideable eggs and five door-bin bases', () => {
    const carton = readModel('egg-carton');
    expect(carton.nodes.filter((node: { name: string }) => /^Egg-\d+$/.test(node.name))).toHaveLength(12);
    expect(carton.nodes.filter((node: { name: string }) => /^Cup-\d+$/.test(node.name))).toHaveLength(12);
    expect(readModel('fridge').nodes.filter((node: { name: string }) => node.name === 'Door bin base')).toHaveLength(5);
  });
  it('gives the freezer a third of the door height and keeps its food below each ceiling', () => {
    const model = readModel('fridge');
    const panelHeight = (pivotName: string) => {
      const pivot = model.nodes.find((node: { name: string }) => node.name === pivotName);
      const panel = pivot.children.map((index: number) => model.nodes[index])
        .find((node: { name: string }) => node.name === 'Sculpted enamel door');
      const positions = model.accessors[model.meshes[panel.mesh].primitives[0].attributes.POSITION];
      return positions.max[1] - positions.min[1];
    };
    const freezerHeight = panelHeight('FreezerDoorPivot');
    const ratio = freezerHeight / (freezerHeight + panelHeight('DoorPivot'));
    expect(ratio).toBeGreaterThan(0.32);
    expect(ratio).toBeLessThan(0.35);
    const shelves = fridgeLayout([lot(0, { storageZone: 'freezer' }), lot(1, { storageZone: 'freezer' })], [], 'freezer').entries;
    for (const entry of shelves) {
      const ceiling = entry.position[1] === FRIDGE_SHELVES.freezer[0] ? 2.45 : FRIDGE_SHELVES.freezer[0] - 0.018;
      expect(entry.position[1] + entry.maxHeight).toBeLessThan(ceiling);
    }
  });
  it('attaches each rack to the correct independent door and keeps closed racks clear of shelves and drawers', () => {
    const { nodes } = readModel('fridge');
    for (const zone of ['fridge', 'freezer'] as const) {
      const pivot = nodes.find((node: { name: string }) => node.name === fridgeDoorParent(zone));
      const children = pivot.children.map((index: number) => nodes[index].name);
      for (const rack of FRIDGE_DOOR_RACKS[zone]) expect(children).toContain(`${zone}-${rack.placement}`);
    }
    for (const node of nodes.filter((item: { name: string }) => item.name.startsWith('Shelf-') || item.name === 'Transparent front')) {
      // Shelf front is 0.06; closed door-bin backs extend inwards to about 0.09.
      expect(node.translation?.[2] ?? 0).toBeLessThanOrEqual(0.061);
    }
  });

});
