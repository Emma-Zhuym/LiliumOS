import { beforeEach, describe, expect, it } from 'vitest';
import { KITCHEN_DB_NAME, KitchenDB, hasKitchenEventChange } from './kitchenDb';
import { formatPackageAmount } from './kitchenQuantity';

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
  it('persists door placement across backup and quantity undo without changing food amounts', async () => {
    const { lot } = await KitchenDB.addLot({ name: '牛奶', quantity: 2, unit: 'large_bottle', storageZone: 'fridge', trackingMode: 'divisible' });
    await KitchenDB.setPortionRemaining({ lotId: lot.id, fraction: 0.7 });
    const eventCount = (await KitchenDB.getEvents()).length;
    await KitchenDB.moveLot(lot.id, 'door-middle');
    expect((await KitchenDB.getLots())[0].fridgePlacement).toBe('door-middle');
    await KitchenDB.moveLot(lot.id, 'door-upper');
    expect((await KitchenDB.getLots())[0]).toMatchObject({ quantity: 2, openContainerRemaining: 0.7, storageZone: 'fridge', fridgePlacement: 'door-upper' });
    expect(await KitchenDB.getEvents()).toHaveLength(eventCount);
    const backup = await KitchenDB.exportAll();
    await KitchenDB.importAll({ foods: [], lots: [], events: [] });
    await KitchenDB.importAll(backup);
    expect((await KitchenDB.getLots())[0].fridgePlacement).toBe('door-upper');
    await KitchenDB.changeLot({ type: 'FINISH', lotId: lot.id });
    await KitchenDB.undoLatest();
    expect((await KitchenDB.getLots())[0]).toMatchObject({ quantity: 2, openContainerRemaining: 0.7, fridgePlacement: 'door-upper' });
    await KitchenDB.moveLot(lot.id, 'shelf');
    expect((await KitchenDB.getLots())[0].fridgePlacement).toBe('shelf');
  });
  it('rejects moving frozen, missing or finished food onto the fridge door', async () => {
    const { lot } = await KitchenDB.addLot({ name: '冷冻牛肉', quantity: 1, unit: 'pack', storageZone: 'freezer' });
    await expect(KitchenDB.moveLot(lot.id, 'door-lower')).rejects.toThrow('冷藏');
    await expect(KitchenDB.moveLot('missing', 'shelf')).rejects.toThrow();
    await expect(KitchenDB.moveLot(lot.id, 'bad-slot' as never)).rejects.toThrow('有效');
    expect((await KitchenDB.getLots())[0]).toMatchObject({ storageZone: 'freezer', quantity: 1 });
    const cold = await KitchenDB.addLot({ name: '牛奶', quantity: 1, unit: 'pack', storageZone: 'fridge' });
    await KitchenDB.changeLot({ type: 'FINISH', lotId: cold.lot.id });
    await expect(KitchenDB.moveLot(cold.lot.id, 'door-lower')).rejects.toThrow();
  });
  it.each([0.5, 1, 2])('clears all %s packages and restores them on undo', async quantity => {
    const added = await KitchenDB.addLot({
      name: '牛奶', quantity, unit: 'large_bottle', storageZone: 'fridge', trackingMode: 'divisible',
    });
    if (quantity >= 1) await KitchenDB.setPortionRemaining({ lotId: added.lot.id, fraction: 0.7 });
    const before = (await KitchenDB.getLots())[0];
    const input = { type: 'FINISH' as const, lotId: added.lot.id, operationId: 'finish-all' };
    const finished = await KitchenDB.changeLot(input);
    expect(finished.lot.quantity).toBe(0);
    expect(finished.lot.openContainerRemaining).toBeUndefined();
    expect(finished.event.type).toBe('CONSUME');
    expect(finished.event.contentDelta).toBeCloseTo(-(quantity >= 1 ? quantity - 1 + 0.7 : quantity));
    expect((await KitchenDB.changeLot(input)).replayed).toBe(true);
    const undone = await KitchenDB.undoLatest();
    expect(undone?.lot.quantity).toBe(before.quantity);
    expect(undone?.lot.openContainerRemaining).toBe(before.openContainerRemaining);
    expect(undone?.lot.packageState).toBe(before.packageState);
  });

  it.each([0.5, 2])('setting zero remaining clears %s packages without negative stock', async quantity => {
    const added = await KitchenDB.addLot({
      name: '牛肉', quantity, unit: 'tray', storageZone: 'fridge', trackingMode: 'divisible',
    });
    const result = await KitchenDB.setPortionRemaining({ lotId: added.lot.id, fraction: 0 });
    expect(result.lot.quantity).toBe(0);
    expect((await KitchenDB.undoLatest())?.lot.quantity).toBe(quantity);
  });

  it('keeps unchanged estimates intact and skips them on undo', async () => {
    const added = await KitchenDB.addLot({
      name: '牛奶', quantity: 1, unit: 'large_bottle', storageZone: 'fridge', trackingMode: 'divisible',
    });
    const adjusted = await KitchenDB.setPortionRemaining({
      lotId: added.lot.id, fraction: 1 / 12, operationId: 'real-change',
    });
    const saved = await KitchenDB.setPortionRemaining({ lotId: added.lot.id, fraction: 0.0833333333333 });
    expect(saved.lot.openContainerRemaining).toBe(1 / 12);
    expect(saved.lot.updatedAt).toBe(adjusted.lot.updatedAt);
    expect(saved.event.contentDelta).toBe(0);
    expect(hasKitchenEventChange(saved.event)).toBe(false);
    // Previously stored round-off events must be skipped too.
    const backup = await KitchenDB.exportAll();
    const oldEvent = backup.events.find(event => event.id === saved.event.id)!;
    oldEvent.contentDelta = -3.3e-14;
    await KitchenDB.importAll(backup);
    expect((await KitchenDB.undoLatest())?.event.relatedOperationId).toBe('real-change');
  });

  it('does not make a fractional package negative when discarded', async () => {
    const added = await KitchenDB.addLot({
      name: '牛肉', quantity: 0.5, unit: 'tray', storageZone: 'fridge', trackingMode: 'divisible',
    });
    const discarded = await KitchenDB.discardCurrentContainer({ lotId: added.lot.id });
    expect(discarded.lot.quantity).toBe(0);
    expect(discarded.event.quantityDelta).toBe(-0.5);
    expect(discarded.event.contentDelta).toBe(-0.5);
  });
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

  it('skips zero-change records when undoing the latest operation', async () => {
    const added = await KitchenDB.addLot({
      name: '苹果', quantity: 2, unit: 'piece', storageZone: 'fridge', operationId: 'add-apples',
    });
    await KitchenDB.changeLot({
      type: 'CONSUME', lotId: added.lot.id, amount: 1, operationId: 'eat-apple',
    });
    await KitchenDB.changeLot({
      type: 'ADJUST', lotId: added.lot.id, quantity: 1, operationId: 'count-same-apple',
    });

    const undone = await KitchenDB.undoLatest('undo-past-zero-change');

    expect(undone?.event.relatedOperationId).toBe('eat-apple');
    expect(undone?.event.quantityDelta).toBe(1);
    expect((await KitchenDB.getLots())[0].quantity).toBe(2);
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

  it('stores household container units with an optional package size', async () => {
    const added = await KitchenDB.addLot({
      name: '橄榄油',
      quantity: 2,
      unit: 'large_bottle',
      storageZone: 'pantry',
      packageSize: ' 30 oz ',
      operationId: 'add-oil',
    });

    expect(added.lot.unit).toBe('large_bottle');
    expect(added.lot.packageSize).toBe('30 oz');
  });

  it('updates one lot metadata while preserving the open-package ratio and event ledger', async () => {
    const first = await KitchenDB.addLot({
      name: '鲜奶', quantity: 1, unit: 'large_bottle', storageZone: 'fridge',
      trackingMode: 'divisible', packageSize: '1 L', operationId: 'add-first-milk',
    });
    await KitchenDB.addLot({
      name: '鲜奶', quantity: 1, unit: 'large_bottle', storageZone: 'fridge', operationId: 'add-second-milk',
    });
    await KitchenDB.setPortionRemaining({
      lotId: first.lot.id, fraction: 0.7, operationId: 'milk-still-seventy-percent',
    });

    const updated = await KitchenDB.updateLotDetails({
      lotId: first.lot.id,
      name: '全脂鲜奶',
      unit: 'small_bottle',
      packageSize: '946 ml',
      storageZone: 'freezer',
      purchasedAt: '2026-09-12',
      expiresAt: '2026-09-18',
    });

    expect(updated.unit).toBe('small_bottle');
    expect(updated.storageZone).toBe('freezer');
    expect(updated.openContainerRemaining).toBeCloseTo(0.7);
    expect(formatPackageAmount(updated.packageSize, updated.openContainerRemaining!)).toBe('662.2 ml');
    expect(updated.purchasedAt).toBe('2026-09-12');
    expect(updated.expiresAt).toBe('2026-09-18');
    expect((await KitchenDB.getFoods())[0]).toMatchObject({ name: '全脂鲜奶', defaultUnit: 'large_bottle' });
    expect((await KitchenDB.getEvents())).toHaveLength(3);
  });

  it('tracks and undoes a partial container consumption', async () => {
    const added = await KitchenDB.addLot({
      name: '牛奶',
      quantity: 1,
      unit: 'large_bottle',
      storageZone: 'fridge',
      trackingMode: 'divisible',
      packageSize: '30 oz',
      operationId: 'add-divisible-milk',
    });

    const consumed = await KitchenDB.consumePortion({
      lotId: added.lot.id,
      fraction: 1 / 3,
      operationId: 'drink-third-milk',
    });
    expect(consumed.lot.quantity).toBe(1);
    expect(consumed.lot.packageState).toBe('opened');
    expect(consumed.lot.openContainerRemaining).toBeCloseTo(2 / 3);
    expect(consumed.event.quantityDelta).toBe(0);
    expect(consumed.event.contentDelta).toBeCloseTo(-1 / 3);

    const undone = await KitchenDB.undoLatest('undo-milk-third');
    expect(undone?.event.relatedOperationId).toBe('drink-third-milk');
    expect(undone?.lot.quantity).toBe(1);
    expect(undone?.lot.openContainerRemaining).toBeUndefined();
    expect(undone?.lot.packageState).toBe('sealed');
  });

  it('uses up the opened fraction before moving to the next container', async () => {
    const added = await KitchenDB.addLot({
      name: '牛肉',
      quantity: 2,
      unit: 'tray',
      storageZone: 'freezer',
      trackingMode: 'divisible',
      operationId: 'add-beef-boxes',
    });
    await KitchenDB.setPortionRemaining({
      lotId: added.lot.id,
      fraction: 1 / 3,
      operationId: 'count-beef-third',
    });

    const consumed = await KitchenDB.consumePortion({
      lotId: added.lot.id,
      fraction: 1 / 3,
      operationId: 'finish-beef-third',
    });

    expect(consumed.lot.quantity).toBe(1);
    expect(consumed.lot.openContainerRemaining).toBeUndefined();
    expect(consumed.lot.packageState).toBe('sealed');
  });

  it('discards only the current opened container remainder', async () => {
    const added = await KitchenDB.addLot({
      name: '果汁',
      quantity: 2,
      unit: 'small_bottle',
      storageZone: 'fridge',
      trackingMode: 'divisible',
      operationId: 'add-juice',
    });
    await KitchenDB.setPortionRemaining({
      lotId: added.lot.id,
      fraction: 1 / 4,
      operationId: 'count-juice-quarter',
    });

    const discarded = await KitchenDB.discardCurrentContainer({
      lotId: added.lot.id,
      operationId: 'discard-open-juice',
    });

    expect(discarded.lot.quantity).toBe(1);
    expect(discarded.lot.openContainerRemaining).toBeUndefined();
    expect(discarded.event.contentDelta).toBeCloseTo(-1 / 4);
  });
});
