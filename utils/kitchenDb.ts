/**
 * kitchenDb.ts — Lilian Kitchen 的本地库存账本。
 *
 * 页面、未来的 3D 场景和角色查询都只能通过这里修改库存，避免出现多套扣减规则。
 */

export type KitchenUnit =
  | 'piece'
  | 'pack'
  | 'bag'
  | 'box'
  | 'tray'
  | 'can'
  | 'large_bottle'
  | 'small_bottle'
  | 'portion'
  | 'gram'
  | 'milliliter';
export type KitchenStorageZone = 'staging' | 'fridge' | 'freezer' | 'pantry';
export type KitchenEventType = 'ADD' | 'CONSUME' | 'DISCARD' | 'ADJUST' | 'UNDO';
export type KitchenTrackingMode = 'count' | 'divisible';

export interface KitchenFood {
  id: string;
  name: string;
  normalizedName: string;
  defaultUnit: KitchenUnit;
  createdAt: number;
  updatedAt: number;
}

export interface KitchenLot {
  id: string;
  foodId: string;
  quantity: number;
  unit: KitchenUnit;
  storageZone: KitchenStorageZone;
  packageState: 'sealed' | 'opened';
  foodState: 'raw' | 'prepared' | 'leftover';
  trackingMode?: KitchenTrackingMode;
  openContainerRemaining?: number;
  packageSize?: string;
  purchasedAt?: string;
  expiresAt?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KitchenEvent {
  id: string;
  operationId: string;
  type: KitchenEventType;
  lotId: string;
  foodId: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  contentDelta?: number;
  openContainerRemainingBefore?: number;
  openContainerRemainingAfter?: number;
  unit: KitchenUnit;
  occurredAt: number;
  note?: string;
  relatedOperationId?: string;
  undoneAt?: number;
}

export interface KitchenBackup {
  foods: KitchenFood[];
  lots: KitchenLot[];
  events: KitchenEvent[];
}

export interface AddKitchenLotInput {
  name: string;
  quantity: number;
  unit: KitchenUnit;
  storageZone: KitchenStorageZone;
  trackingMode?: KitchenTrackingMode;
  packageSize?: string;
  purchasedAt?: string;
  expiresAt?: string;
  operationId?: string;
}

export type ChangeKitchenLotInput =
  | { type: 'CONSUME' | 'DISCARD'; lotId: string; amount: number; operationId?: string; note?: string }
  | { type: 'FINISH'; lotId: string; operationId?: string; note?: string }
  | { type: 'ADJUST'; lotId: string; quantity: number; operationId?: string; note?: string };

export interface ChangeKitchenPortionInput {
  lotId: string;
  fraction: number;
  operationId?: string;
  note?: string;
}

export interface KitchenOperationResult {
  lot: KitchenLot;
  event: KitchenEvent;
  replayed: boolean;
}

export const KITCHEN_DB_NAME = 'LiliumOS_Kitchen';
const DB_VERSION = 1;
const STORE_FOODS = 'foods';
const STORE_LOTS = 'lots';
const STORE_EVENTS = 'events';
const CONTENT_EPSILON = 0.000001;

export const hasKitchenEventChange = (event: KitchenEvent): boolean =>
  Math.abs(event.contentDelta ?? event.quantityDelta) > CONTENT_EPSILON;

const makeId = (prefix: string): string => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
};

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function openKitchenDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KITCHEN_DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FOODS)) {
        const foods = db.createObjectStore(STORE_FOODS, { keyPath: 'id' });
        foods.createIndex('normalizedName', 'normalizedName', { unique: true });
      }
      if (!db.objectStoreNames.contains(STORE_LOTS)) {
        const lots = db.createObjectStore(STORE_LOTS, { keyPath: 'id' });
        lots.createIndex('foodId', 'foodId', { unique: false });
        lots.createIndex('storageZone', 'storageZone', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const events = db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
        events.createIndex('operationId', 'operationId', { unique: true });
        events.createIndex('lotId', 'lotId', { unique: false });
        events.createIndex('occurredAt', 'occurredAt', { unique: false });
      }
    };
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Kitchen transaction aborted'));
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction(storeName, 'readonly');
    const values = await requestValue(transaction.objectStore(storeName).getAll()) as T[];
    await transactionDone(transaction);
    return values;
  } finally {
    db.close();
  }
}

async function findExistingOperation(
  events: IDBObjectStore,
  lots: IDBObjectStore,
  operationId: string,
): Promise<KitchenOperationResult | null> {
  const event = await requestValue(events.index('operationId').get(operationId)) as KitchenEvent | undefined;
  if (!event) return null;
  const lot = await requestValue(lots.get(event.lotId)) as KitchenLot | undefined;
  if (!lot) throw new Error('这条操作对应的库存批次不存在');
  return { lot, event, replayed: true };
}

function assertPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}必须大于 0`);
}

function totalContainerContent(lot: KitchenLot): number {
  if (lot.trackingMode !== 'divisible' || lot.openContainerRemaining === undefined) return lot.quantity;
  return Math.max(0, lot.quantity - 1) + lot.openContainerRemaining;
}

function sameOptionalNumber(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return Math.abs(left - right) <= CONTENT_EPSILON;
}

function nextOccurredAt(allEvents: KitchenEvent[]): number {
  let latest = 0;
  for (const event of allEvents) latest = Math.max(latest, event.occurredAt);
  return Math.max(Date.now(), latest + 1);
}

async function addLot(input: AddKitchenLotInput): Promise<KitchenOperationResult> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('请填写食物名称');
  assertPositiveNumber(input.quantity, '数量');

  const operationId = input.operationId ?? makeId('op');
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_FOODS, STORE_LOTS, STORE_EVENTS], 'readwrite');
    const foods = transaction.objectStore(STORE_FOODS);
    const lots = transaction.objectStore(STORE_LOTS);
    const events = transaction.objectStore(STORE_EVENTS);

    const existing = await findExistingOperation(events, lots, operationId);
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }

    const now = nextOccurredAt(await requestValue(events.getAll()) as KitchenEvent[]);
    const normalizedName = normalizeName(name);
    let food = await requestValue(foods.index('normalizedName').get(normalizedName)) as KitchenFood | undefined;
    if (!food) {
      food = {
        id: makeId('food'),
        name,
        normalizedName,
        defaultUnit: input.unit,
        createdAt: now,
        updatedAt: now,
      };
      foods.add(food);
    }

    const lot: KitchenLot = {
      id: makeId('lot'),
      foodId: food.id,
      quantity: input.quantity,
      unit: input.unit,
      storageZone: input.storageZone,
      packageState: 'sealed',
      foodState: 'raw',
      trackingMode: input.trackingMode ?? 'count',
      packageSize: input.packageSize?.trim() || undefined,
      purchasedAt: input.purchasedAt,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    const event: KitchenEvent = {
      id: makeId('event'),
      operationId,
      type: 'ADD',
      lotId: lot.id,
      foodId: food.id,
      quantityDelta: input.quantity,
      quantityBefore: 0,
      quantityAfter: input.quantity,
      contentDelta: input.quantity,
      unit: input.unit,
      occurredAt: now,
    };
    lots.add(lot);
    events.add(event);
    await transactionDone(transaction);
    return { lot, event, replayed: false };
  } finally {
    db.close();
  }
}

async function changeLot(input: ChangeKitchenLotInput): Promise<KitchenOperationResult> {
  const operationId = input.operationId ?? makeId('op');
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_LOTS, STORE_EVENTS], 'readwrite');
    const lots = transaction.objectStore(STORE_LOTS);
    const events = transaction.objectStore(STORE_EVENTS);
    const existing = await findExistingOperation(events, lots, operationId);
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }

    const current = await requestValue(lots.get(input.lotId)) as KitchenLot | undefined;
    if (!current) throw new Error('这批食物已经不存在');

    let nextQuantity: number;
    if (input.type === 'FINISH') {
      nextQuantity = 0;
    } else if (input.type === 'ADJUST') {
      if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error('核对后的数量不能小于 0');
      nextQuantity = input.quantity;
    } else {
      assertPositiveNumber(input.amount, '扣除数量');
      if (input.amount > current.quantity) throw new Error('扣除数量不能超过当前库存');
      nextQuantity = current.quantity - input.amount;
    }

    const now = nextOccurredAt(await requestValue(events.getAll()) as KitchenEvent[]);
    const nextOpenContainerRemaining = nextQuantity === 0 ? undefined : current.openContainerRemaining;
    const lot = {
      ...current,
      quantity: nextQuantity,
      packageState: nextOpenContainerRemaining === undefined ? 'sealed' as const : 'opened' as const,
      openContainerRemaining: nextOpenContainerRemaining,
      updatedAt: now,
    };
    const event: KitchenEvent = {
      id: makeId('event'),
      operationId,
      type: input.type === 'FINISH' ? 'CONSUME' : input.type,
      lotId: current.id,
      foodId: current.foodId,
      quantityDelta: nextQuantity - current.quantity,
      quantityBefore: current.quantity,
      quantityAfter: nextQuantity,
      contentDelta: totalContainerContent(lot) - totalContainerContent(current),
      openContainerRemainingBefore: current.openContainerRemaining,
      openContainerRemainingAfter: nextOpenContainerRemaining,
      unit: current.unit,
      occurredAt: now,
      note: input.note,
    };
    lots.put(lot);
    events.add(event);
    await transactionDone(transaction);
    return { lot, event, replayed: false };
  } finally {
    db.close();
  }
}

async function consumePortion(input: ChangeKitchenPortionInput): Promise<KitchenOperationResult> {
  assertPositiveNumber(input.fraction, '本次用量');
  const operationId = input.operationId ?? makeId('op');
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_LOTS, STORE_EVENTS], 'readwrite');
    const lots = transaction.objectStore(STORE_LOTS);
    const events = transaction.objectStore(STORE_EVENTS);
    const existing = await findExistingOperation(events, lots, operationId);
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }

    const current = await requestValue(lots.get(input.lotId)) as KitchenLot | undefined;
    if (!current) throw new Error('这批食物已经不存在');
    if (current.trackingMode !== 'divisible') throw new Error('这种食物按整件计数');

    const contentBefore = totalContainerContent(current);
    if (input.fraction > contentBefore + 0.000001) throw new Error('本次用量不能超过当前余量');
    const contentAfter = Math.max(0, contentBefore - input.fraction);
    const quantityAfter = Math.ceil(contentAfter - 0.000001);
    const fractionalPart = contentAfter - Math.floor(contentAfter);
    const openContainerRemainingAfter = quantityAfter === 0 || fractionalPart < 0.000001
      ? undefined
      : fractionalPart;
    const now = nextOccurredAt(await requestValue(events.getAll()) as KitchenEvent[]);
    const lot: KitchenLot = {
      ...current,
      quantity: quantityAfter,
      packageState: openContainerRemainingAfter === undefined ? 'sealed' : 'opened',
      openContainerRemaining: openContainerRemainingAfter,
      updatedAt: now,
    };
    const event: KitchenEvent = {
      id: makeId('event'),
      operationId,
      type: 'CONSUME',
      lotId: current.id,
      foodId: current.foodId,
      quantityDelta: quantityAfter - current.quantity,
      quantityBefore: current.quantity,
      quantityAfter,
      contentDelta: -input.fraction,
      openContainerRemainingBefore: current.openContainerRemaining,
      openContainerRemainingAfter,
      unit: current.unit,
      occurredAt: now,
      note: input.note,
    };
    lots.put(lot);
    events.add(event);
    await transactionDone(transaction);
    return { lot, event, replayed: false };
  } finally {
    db.close();
  }
}

async function setPortionRemaining(input: ChangeKitchenPortionInput): Promise<KitchenOperationResult> {
  if (!Number.isFinite(input.fraction) || input.fraction < 0 || input.fraction > 1) {
    throw new Error('剩余比例必须在 0 到 1 之间');
  }
  const operationId = input.operationId ?? makeId('op');
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_LOTS, STORE_EVENTS], 'readwrite');
    const lots = transaction.objectStore(STORE_LOTS);
    const events = transaction.objectStore(STORE_EVENTS);
    const existing = await findExistingOperation(events, lots, operationId);
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }

    const current = await requestValue(lots.get(input.lotId)) as KitchenLot | undefined;
    if (!current) throw new Error('这批食物已经不存在');
    if (current.trackingMode !== 'divisible') throw new Error('这种食物按整件计数');
    if (current.quantity <= 0) throw new Error('这批食物已经用完');

    const contentBefore = totalContainerContent(current);
    const quantityAfter = input.fraction === 0 ? 0 : current.quantity;
    let openContainerRemainingAfter = input.fraction <= 0 || input.fraction >= 1
      ? undefined
      : input.fraction;
    const contentAfter = Math.max(0, quantityAfter - (openContainerRemainingAfter === undefined ? 0 : 1))
      + (openContainerRemainingAfter ?? 0);
    const unchanged = quantityAfter === current.quantity
      && Math.abs(contentAfter - contentBefore) <= CONTENT_EPSILON;
    // Preserve the stored value when an estimate only differs by floating-point noise.
    if (unchanged) openContainerRemainingAfter = current.openContainerRemaining;
    const now = nextOccurredAt(await requestValue(events.getAll()) as KitchenEvent[]);
    const lot: KitchenLot = {
      ...current,
      quantity: quantityAfter,
      packageState: openContainerRemainingAfter === undefined ? 'sealed' : 'opened',
      openContainerRemaining: openContainerRemainingAfter,
      updatedAt: unchanged ? current.updatedAt : now,
    };
    const event: KitchenEvent = {
      id: makeId('event'),
      operationId,
      type: 'ADJUST',
      lotId: current.id,
      foodId: current.foodId,
      quantityDelta: quantityAfter - current.quantity,
      quantityBefore: current.quantity,
      quantityAfter,
      contentDelta: unchanged ? 0 : contentAfter - contentBefore,
      openContainerRemainingBefore: current.openContainerRemaining,
      openContainerRemainingAfter,
      unit: current.unit,
      occurredAt: now,
      note: input.note ?? '手动核对开封包装余量',
    };
    lots.put(lot);
    events.add(event);
    await transactionDone(transaction);
    return { lot, event, replayed: false };
  } finally {
    db.close();
  }
}

async function discardCurrentContainer(input: Omit<ChangeKitchenPortionInput, 'fraction'>): Promise<KitchenOperationResult> {
  const operationId = input.operationId ?? makeId('op');
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_LOTS, STORE_EVENTS], 'readwrite');
    const lots = transaction.objectStore(STORE_LOTS);
    const events = transaction.objectStore(STORE_EVENTS);
    const existing = await findExistingOperation(events, lots, operationId);
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }

    const current = await requestValue(lots.get(input.lotId)) as KitchenLot | undefined;
    if (!current) throw new Error('这批食物已经不存在');
    if (current.trackingMode !== 'divisible') throw new Error('这种食物按整件计数');
    if (current.quantity <= 0) throw new Error('这批食物已经用完');

    const discardedContent = current.openContainerRemaining ?? Math.min(1, current.quantity);
    const quantityAfter = Math.max(0, current.quantity - 1);
    const now = nextOccurredAt(await requestValue(events.getAll()) as KitchenEvent[]);
    const lot: KitchenLot = {
      ...current,
      quantity: quantityAfter,
      packageState: 'sealed',
      openContainerRemaining: undefined,
      updatedAt: now,
    };
    const event: KitchenEvent = {
      id: makeId('event'),
      operationId,
      type: 'DISCARD',
      lotId: current.id,
      foodId: current.foodId,
      quantityDelta: quantityAfter - current.quantity,
      quantityBefore: current.quantity,
      quantityAfter,
      contentDelta: -discardedContent,
      openContainerRemainingBefore: current.openContainerRemaining,
      openContainerRemainingAfter: undefined,
      unit: current.unit,
      occurredAt: now,
      note: input.note,
    };
    lots.put(lot);
    events.add(event);
    await transactionDone(transaction);
    return { lot, event, replayed: false };
  } finally {
    db.close();
  }
}

async function undoLatest(operationId = makeId('op')): Promise<KitchenOperationResult | null> {
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_LOTS, STORE_EVENTS], 'readwrite');
    const lots = transaction.objectStore(STORE_LOTS);
    const events = transaction.objectStore(STORE_EVENTS);
    const existing = await findExistingOperation(events, lots, operationId);
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }

    const allEvents = await requestValue(events.getAll()) as KitchenEvent[];
    const target = allEvents
      .filter(event => event.type !== 'UNDO' && !event.undoneAt && hasKitchenEventChange(event))
      .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id))[0];
    if (!target) {
      await transactionDone(transaction);
      return null;
    }

    const current = await requestValue(lots.get(target.lotId)) as KitchenLot | undefined;
    if (!current) throw new Error('无法撤销：对应的库存批次不存在');
    if (current.quantity !== target.quantityAfter) {
      throw new Error('无法撤销：这批食物之后已经发生了变化');
    }
    const tracksOpenContainer = target.contentDelta !== undefined
      || target.openContainerRemainingBefore !== undefined
      || target.openContainerRemainingAfter !== undefined;
    if (tracksOpenContainer && !sameOptionalNumber(current.openContainerRemaining, target.openContainerRemainingAfter)) {
      throw new Error('无法撤销：这批食物的开封余量已经发生了变化');
    }

    const now = nextOccurredAt(allEvents);
    const lot = {
      ...current,
      quantity: target.quantityBefore,
      packageState: target.openContainerRemainingBefore === undefined ? 'sealed' as const : 'opened' as const,
      openContainerRemaining: target.openContainerRemainingBefore,
      updatedAt: now,
    };
    const undoneTarget = { ...target, undoneAt: now };
    const event: KitchenEvent = {
      id: makeId('event'),
      operationId,
      type: 'UNDO',
      lotId: target.lotId,
      foodId: target.foodId,
      quantityDelta: target.quantityBefore - target.quantityAfter,
      quantityBefore: target.quantityAfter,
      quantityAfter: target.quantityBefore,
      contentDelta: -(target.contentDelta ?? target.quantityDelta),
      openContainerRemainingBefore: target.openContainerRemainingAfter,
      openContainerRemainingAfter: target.openContainerRemainingBefore,
      unit: target.unit,
      occurredAt: now,
      relatedOperationId: target.operationId,
    };
    lots.put(lot);
    events.put(undoneTarget);
    events.add(event);
    await transactionDone(transaction);
    return { lot, event, replayed: false };
  } finally {
    db.close();
  }
}

async function exportAll(): Promise<KitchenBackup> {
  const [foods, lots, events] = await Promise.all([
    getAll<KitchenFood>(STORE_FOODS),
    getAll<KitchenLot>(STORE_LOTS),
    getAll<KitchenEvent>(STORE_EVENTS),
  ]);
  return { foods, lots, events };
}

async function importAll(data: Partial<KitchenBackup>): Promise<void> {
  const db = await openKitchenDB();
  try {
    const selectedStores = [
      data.foods !== undefined ? STORE_FOODS : null,
      data.lots !== undefined ? STORE_LOTS : null,
      data.events !== undefined ? STORE_EVENTS : null,
    ].filter((store): store is string => store !== null);
    if (selectedStores.length === 0) return;

    const transaction = db.transaction(selectedStores, 'readwrite');
    for (const store of selectedStores) transaction.objectStore(store).clear();
    for (const food of data.foods ?? []) transaction.objectStore(STORE_FOODS).put(food);
    for (const lot of data.lots ?? []) transaction.objectStore(STORE_LOTS).put(lot);
    for (const event of data.events ?? []) transaction.objectStore(STORE_EVENTS).put(event);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export const KitchenDB = {
  addLot,
  changeLot,
  consumePortion,
  setPortionRemaining,
  discardCurrentContainer,
  undoLatest,
  getFoods: () => getAll<KitchenFood>(STORE_FOODS),
  getLots: () => getAll<KitchenLot>(STORE_LOTS),
  getEvents: async () => (await getAll<KitchenEvent>(STORE_EVENTS))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id)),
  exportAll,
  importAll,
};
