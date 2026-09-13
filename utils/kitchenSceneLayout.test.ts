import { describe, expect, it } from 'vitest';
import { eggVisibleCount, fridgeLayout, kitchenModelFor } from './kitchenSceneLayout';
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
    expect(a.position[1]).toBe(0.954);
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
    expect(frozen.entries.every(entry => entry.position[1] === 1.8525)).toBe(true);
  });
  it('excludes empty and other zones, and restores inventory after undo', () => {
    const items = [lot(0, { quantity: 0 }), lot(1, { storageZone: 'pantry' }), lot(2, { storageZone: 'freezer' })];
    expect(fridgeLayout(items, [])).toEqual({ entries: [], total: 0 });
    expect(fridgeLayout([{ ...items[0], quantity: 1 }], []).entries).toHaveLength(1);
    const partial = lot(3, { trackingMode: 'divisible', openContainerRemaining: 0.01 });
    expect(fridgeLayout([partial], []).entries[0].lot).toEqual(partial);
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
    for (const top of [0.56, 0.93, 1.3]) expect(nodes.some((node: { name: string }) => node.name === `Shelf-${top}`)).toBe(true);
    const model = readModel('fridge');
    expect(model.materials.find((material: { name: string }) => material.name === 'Clear crisper plastic').alphaMode).toBe('BLEND');
    for (const name of ['Satin enamel', 'Brushed aluminium']) {
      const material = model.materials.find((item: { name: string }) => item.name === name);
      const image = model.images[model.textures[material.normalTexture.index].source];
      expect(image.mimeType).toBe('image/png');
      expect(model.bufferViews[image.bufferView].byteLength).toBeGreaterThan(0);
    }
  });
  it('ships twelve separately hideable eggs and three door-bin bases', () => {
    const carton = readModel('egg-carton');
    expect(carton.nodes.filter((node: { name: string }) => /^Egg-\d+$/.test(node.name))).toHaveLength(12);
    expect(carton.nodes.filter((node: { name: string }) => /^Cup-\d+$/.test(node.name))).toHaveLength(12);
    expect(readModel('fridge').nodes.filter((node: { name: string }) => node.name === 'Door bin base')).toHaveLength(3);
  });
});
