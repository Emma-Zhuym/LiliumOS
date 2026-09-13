import { beforeEach, describe, expect, it } from 'vitest';
import { KITCHEN_DB_NAME, KitchenDB } from './kitchenDb';

const deleteKitchenDB = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(KITCHEN_DB_NAME);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Kitchen database deletion was blocked'));
});

beforeEach(async () => {
  await deleteKitchenDB();
});

describe('KitchenDB inventory ledger', () => {
  it('adds, consumes and undoes one lot while keeping the event history', async () => {
    const added = await KitchenDB.addLot({
      name: '鸡蛋',
      quantity: 6,
      unit: 'piece',
      storageZone: 'fridge',
      operationId: 'add-eggs',
    });

    await KitchenDB.changeLot({
      type: 'CONSUME',
      lotId: added.lot.id,
      amount: 1,
      operationId: 'eat-egg',
    });
    expect((await KitchenDB.getLots())[0].quantity).toBe(5);

    const undone = await KitchenDB.undoLatest('undo-eat-egg');
    expect(undone?.lot.quantity).toBe(6);
    expect((await KitchenDB.getLots())[0].quantity).toBe(6);
    expect((await KitchenDB.getEvents()).map(event => event.type)).toEqual(['ADD', 'CONSUME', 'UNDO']);
  });

  it('replays an operation id without deducting the lot twice', async () => {
    const added = await KitchenDB.addLot({
      name: '泡面', quantity: 4, unit: 'pack', storageZone: 'pantry', operationId: 'add-noodles',
    });
    const input = { type: 'CONSUME' as const, lotId: added.lot.id, amount: 1, operationId: 'eat-noodles' };

    const first = await KitchenDB.changeLot(input);
    const replay = await KitchenDB.changeLot(input);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.lot.quantity).toBe(3);
    expect((await KitchenDB.getEvents()).filter(event => event.type === 'CONSUME')).toHaveLength(1);
  });

  it('rejects over-consumption without changing stock or history', async () => {
    const added = await KitchenDB.addLot({
      name: '牛奶', quantity: 1, unit: 'pack', storageZone: 'fridge', operationId: 'add-milk',
    });

    await expect(KitchenDB.changeLot({
      type: 'CONSUME', lotId: added.lot.id, amount: 2, operationId: 'drink-too-much',
    })).rejects.toThrow('不能超过当前库存');
    expect((await KitchenDB.getLots())[0].quantity).toBe(1);
    expect(await KitchenDB.getEvents()).toHaveLength(1);
  });

  it('keeps discarded food and manual corrections separate from eating', async () => {
    const added = await KitchenDB.addLot({
      name: '小白菜', quantity: 3, unit: 'piece', storageZone: 'fridge', operationId: 'add-greens',
    });
    await KitchenDB.changeLot({
      type: 'DISCARD', lotId: added.lot.id, amount: 1, operationId: 'discard-greens',
    });
    await KitchenDB.changeLot({
      type: 'ADJUST', lotId: added.lot.id, quantity: 1, operationId: 'count-greens',
    });

    expect((await KitchenDB.getLots())[0].quantity).toBe(1);
    expect((await KitchenDB.getEvents()).map(event => event.type)).toEqual(['ADD', 'DISCARD', 'ADJUST']);
  });

  it('exports and restores all kitchen records', async () => {
    await KitchenDB.addLot({
      name: '鸡蛋', quantity: 6, unit: 'piece', storageZone: 'fridge', operationId: 'backup-eggs',
    });
    await KitchenDB.addLot({
      name: '鸡蛋', quantity: 12, unit: 'piece', storageZone: 'fridge', operationId: 'backup-eggs-second-lot',
    });
    const backup = await KitchenDB.exportAll();
    expect(backup.foods).toHaveLength(1);
    expect(backup.lots).toHaveLength(2);

    await KitchenDB.importAll({ foods: [], lots: [], events: [] });
    expect(await KitchenDB.getLots()).toHaveLength(0);
    await KitchenDB.importAll(backup);

    expect((await KitchenDB.getLots()).map(lot => lot.quantity).sort((a, b) => a - b)).toEqual([6, 12]);
    expect(await KitchenDB.getEvents()).toHaveLength(2);
  });
});
