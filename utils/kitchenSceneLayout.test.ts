import { describe, expect, it } from 'vitest';
import { fridgePage, kitchenModelFor } from './kitchenSceneLayout';
import type { KitchenLot } from './kitchenDb';
import fs from 'node:fs';
import path from 'node:path';

const lot = (index: number, extra: Partial<KitchenLot> = {}): KitchenLot => ({
  id: `lot-${index}`, foodId: `food-${index}`, createdAt: index, updatedAt: index,
  quantity: 1, unit: 'pack', packageState: 'sealed', foodState: 'raw', storageZone: 'fridge', ...extra,
});

describe('fridge inventory projection', () => {
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
  it('maps display models conservatively and falls back for unknown food', () => {
    expect(kitchenModelFor('鸡蛋')).toBe('egg');
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
    for (const name of ['egg', 'carton', 'meat-raw', 'bag', 'fridge']) {
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
    expect(pivot.children).toHaveLength(1);
    for (const top of [0.3, 0.76, 1.22]) expect(nodes.some((node: { name: string }) => node.name === `Shelf-${top}`)).toBe(true);
  });
});
