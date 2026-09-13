import { describe, expect, it } from 'vitest';
import { eggVisibleCount, fridgePage, kitchenModelFor } from './kitchenSceneLayout';
import type { KitchenLot } from './kitchenDb';
import fs from 'node:fs';
import path from 'node:path';

const lot = (index: number, extra: Partial<KitchenLot> = {}): KitchenLot => ({
  id: `lot-${index}`, foodId: `food-${index}`, createdAt: index, updatedAt: index,
  quantity: 1, unit: 'pack', packageState: 'sealed', foodState: 'raw', storageZone: 'fridge', ...extra,
});

describe('fridge inventory projection', () => {
  it('reserves a whole rack for a twelve-egg carton and pages adjacent bottles', () => {
    const egg = lot(0, { unit: 'piece', quantity: 5, fridgePlacement: 'door-middle' });
    const food = { id: egg.foodId, name: '鸡蛋', normalizedName: '鸡蛋', defaultUnit: 'piece' as const, createdAt: 0, updatedAt: 0 };
    const lots = [egg, lot(1, { fridgePlacement: 'door-middle' })];
    const first = fridgePage(lots, [food], 0);
    expect(first.pageCount).toBe(2);
    expect(first.entries).toHaveLength(1);
    expect(first.entries[0].position).toEqual([0.62, 0.954, -0.18]);
    expect(fridgePage(lots, [food], 1).entries[0].lot.id).toBe('lot-1');
    expect(eggVisibleCount(egg)).toBe(5);
    expect(eggVisibleCount({ ...egg, quantity: 20 })).toBe(12);
    expect(eggVisibleCount({ ...egg, quantity: 1, unit: 'box' })).toBe(12);
  });
  it('assigns non-overlapping local door slots and pages overflow without losing lots', () => {
    const lots = Array.from({ length: 6 }, (_, i) => lot(i, { fridgePlacement: i < 3 ? 'door-upper' : 'door-lower' }));
    lots.push(lot(8));
    const first = fridgePage(lots, [], 0);
    const second = fridgePage(lots, [], 1);
    expect(first.pageCount).toBe(2);
    expect(first.entries).toHaveLength(5);
    expect(second.entries).toHaveLength(2);
    const entries = [...first.entries, ...second.entries];
    expect(new Set(entries.map(entry => entry.lot.id)).size).toBe(7);
    expect(new Set(first.entries.map(entry => `${entry.placement}:${entry.position.join(',')}`)).size).toBe(5);
    expect(first.entries.find(entry => entry.placement === 'door-upper')?.position).toEqual([0.38, 1.414, -0.18]);
    expect(first.entries.find(entry => entry.placement === 'door-lower')?.position[1]).toBe(0.434);
  });
  it('pages twenty lots without dropping or duplicating inventory', () => {
    const lots = Array.from({ length: 20 }, (_, i) => lot(i));
    const pages = [0, 1, 2].map(index => fridgePage(lots, [], index));
    expect(pages.map(page => page.entries.length)).toEqual([9, 9, 2]);
    expect(new Set(pages.flatMap(page => page.entries.map(entry => entry.lot.id))).size).toBe(20);
    expect(pages[0].entries.map(entry => entry.position.join(','))).toHaveLength(9);
    expect(new Set(pages[0].entries.map(entry => entry.position.join(','))).size).toBe(9);
  });
  it('excludes empty and non-fridge lots, clamps after clearing the last page and restores after undo', () => {
    const lots = Array.from({ length: 10 }, (_, i) => lot(i));
    const changed = lots.map((item, i) => i === 9 ? { ...item, quantity: 0 } : item);
    changed.push(lot(11, { storageZone: 'pantry' }), lot(12, { storageZone: 'freezer' }), lot(13, { storageZone: 'staging' }));
    expect(fridgePage(changed, [], 1)).toMatchObject({ total: 9, page: 0, pageCount: 1 });
    expect(fridgePage(lots, [], 1).entries[0].lot.id).toBe('lot-9');
    expect(fridgePage([], [], 3)).toMatchObject({ total: 0, page: 0, pageCount: 1, entries: [] });
  });
  it('keeps partly used packages visible without rounding away the stored remainder', () => {
    const item = lot(1, { trackingMode: 'divisible', openContainerRemaining: 0.01 });
    expect(fridgePage([item], [], 0).entries[0].lot).toEqual(item);
  });
  it('places only frozen inventory on the upper freezer shelf, three per page', () => {
    const lots = [lot(0), ...Array.from({ length: 4 }, (_, i) => lot(i + 1, { storageZone: 'freezer' }))];
    const first = fridgePage(lots, [], 0, 'freezer');
    expect(first).toMatchObject({ total: 4, pageCount: 2 });
    expect(first.entries).toHaveLength(3);
    expect(first.entries.every(entry => entry.position[1] === 1.8525 && entry.lot.storageZone === 'freezer')).toBe(true);
    expect(fridgePage(lots, [], 1, 'freezer').entries).toHaveLength(1);
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
