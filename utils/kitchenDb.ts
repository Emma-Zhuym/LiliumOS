/**
 * kitchenDb.ts — Lilian Kitchen 的本地库存账本。
 *
 * 页面、未来的 3D 场景和角色查询都只能通过这里修改库存，避免出现多套扣减规则。
 */

export type KitchenUnit = 'piece' | 'pack' | 'gram' | 'milliliter' | 'portion';
export type KitchenStorageZone = 'staging' | 'fridge' | 'freezer' | 'pantry';
export type KitchenEventType = 'ADD' | 'CONSUME' | 'DISCARD' | 'ADJUST' | 'UNDO';

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
  purchasedAt?: string;
  expiresAt?: string;
  operationId?: string;
}

export type ChangeKitchenLotInput =
  | { type: 'CONSUME' | 'DISCARD'; lotId: string; amount: number; operationId?: string; note?: string }
  | { type: 'ADJUST'; lotId: string; quantity: number; operationId?: string; note?: string };

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
    if (input.type === 'ADJUST') {
      if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error('核对后的数量不能小于 0');
      nextQuantity = input.quantity;
    } else {
      assertPositiveNumber(input.amount, '扣除数量');
      if (input.amount > current.quantity) throw new Error('扣除数量不能超过当前库存');
      nextQuantity = current.quantity - input.amount;
    }

    const now = nextOccurredAt(await requestValue(events.getAll()) as KitchenEvent[]);
    const lot = { ...current, quantity: nextQuantity, updatedAt: now };
    const event: KitchenEvent = {
      id: makeId('event'),
      operationId,
      type: input.type,
      lotId: current.id,
      foodId: current.foodId,
      quantityDelta: nextQuantity - current.quantity,
      quantityBefore: current.quantity,
      quantityAfter: nextQuantity,
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
      .filter(event => event.type !== 'UNDO' && !event.undoneAt)
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

    const now = nextOccurredAt(allEvents);
    const lot = { ...current, quantity: target.quantityBefore, updatedAt: now };
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
  undoLatest,
  getFoods: () => getAll<KitchenFood>(STORE_FOODS),
  getLots: () => getAll<KitchenLot>(STORE_LOTS),
  getEvents: async () => (await getAll<KitchenEvent>(STORE_EVENTS))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id)),
  exportAll,
  importAll,
};
