/**
 * kitchenDb.ts — Lilian Kitchen 的本地库存账本。
 *
 * 页面、未来的 3D 场景和角色查询都只能通过这里修改库存，避免出现多套扣减规则。
 */
import { looksLikeDish } from './kitchenDishNames';

/**
 * 单位。2026-10-13 阿萌定：按小票上的来——数的用「件」，称重的用磅 / 盎司（不换算成克），
 * 包装多大写在 packageSize（1 gal、18 ct）。个 / 包 / 袋 / 盒 / 大瓶小瓶这些旧单位不再给新东西选，
 * 旧数据照旧显示，不迁移。
 */
export type KitchenUnit =
  | 'item'
  | 'lb'
  | 'oz'
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
export type KitchenFridgePlacement = 'shelf' | 'door-upper' | 'door-middle' | 'door-lower';

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
  fridgePlacement?: KitchenFridgePlacement;
  packageState: 'sealed' | 'opened';
  foodState: 'raw' | 'prepared' | 'leftover';
  trackingMode?: KitchenTrackingMode;
  openContainerRemaining?: number;
  packageSize?: string;
  purchasedAt?: string;
  expiresAt?: string;
  /** 放常温柜的算哪段（速食 / 零食 / 饮料 / 米面油调料）；不填按名字猜，见 kitchenAppearance.pantryKindOf */
  pantryKind?: 'ready' | 'snack' | 'drink' | 'staple';
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
  /** 一起发生、一起撤销的一批（拍一张小票、做一道菜）：撤销最近操作时整批撤回 */
  batchId?: string;
  /** 做菜那一批记着是哪道菜、做之前上次做的日子：撤销时把「做过几次」退回去 */
  recipe?: { id: string; prevCookedAt?: number };
}

/**
 * 要买清单的一行（阿萌 2026-10-12 定：勾选式小票贴在冷冻门右半边）。
 * 划掉的留几天再从门上消失；买回来放进厨房时名字对上的自动划掉（checkedBy: 'bought'）。
 */
export interface KitchenShoppingItem {
  id: string;
  name: string;
  normalizedName: string;
  /** 从哪一样食物的「加进要买清单」来的 */
  lotId?: string;
  createdAt: number;
  updatedAt: number;
  checkedAt?: number;
  checkedBy?: 'hand' | 'bought';
  /** 被哪一笔「放进」划掉的：撤销那一笔时把这一行的勾取消 */
  boughtBy?: string;
}

/**
 * 菜谱和酱汁库（阿萌 2026-10-14 定）：
 * - 量是「数字 + 单位」，amount 为 null 就是「适量」，不跟着份数缩放。
 * - 酱汁是单独的库：一份糖醋汁可以挂在好几道菜上，改一处都变；菜谱上照样显示，但做菜时不扣库存
 *   （酱油醋糖这些本来就是「慢慢吃」的耐放东西）。
 * - 菜谱的食材做菜时扣库存，先弹核对单。
 */
export interface KitchenAmount { name: string; amount: number | null; unit: string }
export interface KitchenSauce {
  id: string;
  name: string;
  normalizedName: string;
  parts: KitchenAmount[];
  note?: string;
  createdAt: number;
  updatedAt: number;
}
export interface KitchenRecipe {
  id: string;
  name: string;
  normalizedName: string;
  /** 这份菜谱写的是几人份；看的时候可以调份数，数量按比例算 */
  servings: number;
  ingredients: KitchenAmount[];
  /** 挂的酱汁（引用酱汁库）；times 是放几份这个汁 */
  sauces: { sauceId: string; times: number }[];
  steps?: string;
  note?: string;
  cookedCount?: number;
  lastCookedAt?: number;
  createdAt: number;
  updatedAt: number;
}
export type SaveRecipeInput = Pick<KitchenRecipe, 'name' | 'servings' | 'ingredients' | 'sauces' | 'steps' | 'note'> & { id?: string };
export type SaveSauceInput = Pick<KitchenSauce, 'name' | 'parts' | 'note'> & { id?: string };

export interface KitchenBackup {
  foods: KitchenFood[];
  lots: KitchenLot[];
  events: KitchenEvent[];
  shopping?: KitchenShoppingItem[];
  recipes?: KitchenRecipe[];
  sauces?: KitchenSauce[];
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
  /** 做好的菜放进冰箱时是 prepared；不填就是买来的生食材 */
  foodState?: KitchenLot['foodState'];
  /** 放常温柜时手动选的段；不填按名字猜 */
  pantryKind?: KitchenLot['pantryKind'];
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

/**
 * Metadata edits deliberately do not create ledger events: they correct how a
 * batch is described, while quantity changes remain the only undoable events.
 */
export interface UpdateKitchenLotDetailsInput {
  lotId: string;
  name: string;
  unit: KitchenUnit;
  storageZone: KitchenStorageZone;
  packageSize?: string;
  purchasedAt?: string;
  expiresAt?: string;
  /** 是不是自己做的菜（按名字猜错了在这里改）；不传就不动 */
  foodState?: KitchenLot['foodState'];
  /** 柜子里算哪段；null = 改回按名字猜，不传就不动 */
  pantryKind?: KitchenLot['pantryKind'] | null;
}

export interface KitchenOperationResult {
  lot: KitchenLot;
  event: KitchenEvent;
  replayed: boolean;
}

export const KITCHEN_DB_NAME = 'LiliumOS_Kitchen';
const DB_VERSION = 4;   // 2：要买清单；3：菜谱、酱汁库；4：旧数据补上「做好的菜」标记
const STORE_FOODS = 'foods';
const STORE_LOTS = 'lots';
const STORE_EVENTS = 'events';
const STORE_SHOPPING = 'shopping';
const STORE_RECIPES = 'recipes';
const STORE_SAUCES = 'sauces';
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
    request.onupgradeneeded = event => {
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
      if (!db.objectStoreNames.contains(STORE_SHOPPING)) db.createObjectStore(STORE_SHOPPING, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_RECIPES)) db.createObjectStore(STORE_RECIPES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_SAUCES)) db.createObjectStore(STORE_SAUCES, { keyPath: 'id' });
      // v4：以前「是不是做好的菜」每次按名字猜，现在只看批次上的 foodState。
      // 旧数据里名字像菜、又不是拍小票买来的，补成 prepared，免得升级后小票上的「做了」变成「放进」
      if (event.oldVersion >= 1 && event.oldVersion < 4 && request.transaction) markOldDishes(request.transaction);
    };
  });
}

function markOldDishes(transaction: IDBTransaction): void {
  const foods = transaction.objectStore(STORE_FOODS), lots = transaction.objectStore(STORE_LOTS), events = transaction.objectStore(STORE_EVENTS);
  foods.getAll().onsuccess = foodRequest => {
    const names = new Map(((foodRequest.target as IDBRequest<KitchenFood[]>).result).map(food => [food.id, food.name]));
    events.getAll().onsuccess = eventRequest => {
      const fromReceipt = new Set(((eventRequest.target as IDBRequest<KitchenEvent[]>).result)
        .filter(item => item.type === 'ADD' && item.operationId.startsWith('receipt_')).map(item => item.lotId));
      lots.getAll().onsuccess = lotRequest => {
        for (const lot of (lotRequest.target as IDBRequest<KitchenLot[]>).result) {
          if (lot.foodState !== 'raw' || fromReceipt.has(lot.id) || !looksLikeDish(names.get(lot.foodId) ?? '')) continue;
          lots.put({ ...lot, foodState: 'prepared' });
        }
      };
    };
  };
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

/** 名字去多余空格；空的、数量不对的直接报错（写之前就挡住，整批要么全写要么不写） */
function checkAddInput(input: AddKitchenLotInput): string {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('请填写食物名称');
  assertPositiveNumber(input.quantity, '数量');
  return name;
}

/** 在已经开好的事务里放进一样（放进一样、拍小票一批、做菜剩的那份共用） */
async function putNewLot(
  stores: { foods: IDBObjectStore; lots: IDBObjectStore; events: IDBObjectStore },
  input: AddKitchenLotInput, operationId: string, now: number, extra: Pick<KitchenEvent, 'batchId' | 'recipe'> = {},
): Promise<KitchenOperationResult> {
  const name = checkAddInput(input);
  const normalizedName = normalizeName(name);
  let food = await requestValue(stores.foods.index('normalizedName').get(normalizedName)) as KitchenFood | undefined;
  if (!food) {
    food = { id: makeId('food'), name, normalizedName, defaultUnit: input.unit, createdAt: now, updatedAt: now };
    stores.foods.add(food);
  }
  const lot: KitchenLot = {
    id: makeId('lot'),
    foodId: food.id,
    quantity: input.quantity,
    unit: input.unit,
    storageZone: input.storageZone,
    packageState: 'sealed',
    foodState: input.foodState ?? 'raw',
    trackingMode: input.trackingMode ?? 'count',
    packageSize: input.packageSize?.trim() || undefined,
    ...(input.pantryKind ? { pantryKind: input.pantryKind } : {}),
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
    ...extra,
  };
  stores.lots.add(lot);
  stores.events.add(event);
  return { lot, event, replayed: false };
}

async function addLot(input: AddKitchenLotInput): Promise<KitchenOperationResult> {
  checkAddInput(input);
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
    const result = await putNewLot({ foods, lots, events }, input, operationId, now);
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

/**
 * 一次放进好几样（拍一张小票）：一个事务写完，中途出错一样都不留，重点一次不会重复；
 * 整批记同一个 batchId，「撤销最近操作」一次撤回整张小票。每样仍各有 operationId（小票分组认 receipt_ 前缀）。
 */
async function addLots(inputs: AddKitchenLotInput[], batchId = makeId('batch')): Promise<KitchenOperationResult[]> {
  if (!inputs.length) return [];
  inputs.forEach(checkAddInput);
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_FOODS, STORE_LOTS, STORE_EVENTS], 'readwrite');
    const foods = transaction.objectStore(STORE_FOODS);
    const lots = transaction.objectStore(STORE_LOTS);
    const events = transaction.objectStore(STORE_EVENTS);
    const now = nextOccurredAt(await requestValue(events.getAll()) as KitchenEvent[]);
    const results: KitchenOperationResult[] = [];
    for (const [i, input] of inputs.entries()) {
      const operationId = input.operationId ?? makeId('op');
      results.push(await findExistingOperation(events, lots, operationId)
        ?? await putNewLot({ foods, lots, events }, input, operationId, now + i, { batchId }));
    }
    await transactionDone(transaction);
    return results;
  } finally {
    db.close();
  }
}

export interface CookInput {
  recipeId: string;
  /** 每样从哪一批扣多少（按那一批的单位）；同一批出现两次就接着扣 */
  deductions: { lotId: string; amount: number }[];
  /** 做出来剩的放进冰箱（记成做好的菜） */
  leftover?: Pick<AddKitchenLotInput, 'name' | 'quantity' | 'unit' | 'storageZone'>;
  note: string;
  operationId?: string;
}

/**
 * 做了一道菜：扣食材、放进剩的、菜谱记一次，一个事务写完（2026-10-14 重审：原来一样一样扣，
 * 中途失败会扣一半）。整批同一个 batchId，撤销一次整道菜退回去，「做过几次」也退回去。
 */
async function cook(input: CookInput): Promise<void> {
  const batchId = input.operationId ?? makeId('cook');
  for (const item of input.deductions) assertPositiveNumber(item.amount, '扣除数量');
  if (input.leftover) checkAddInput({ ...input.leftover, foodState: 'prepared' });
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_FOODS, STORE_LOTS, STORE_EVENTS, STORE_RECIPES], 'readwrite');
    const foods = transaction.objectStore(STORE_FOODS);
    const lots = transaction.objectStore(STORE_LOTS);
    const events = transaction.objectStore(STORE_EVENTS);
    const recipes = transaction.objectStore(STORE_RECIPES);
    // 重点一次：第一笔已经在了就是写过了
    if (await requestValue(events.index('operationId').get(`${batchId}:0`))) {
      await transactionDone(transaction);
      return;
    }
    const recipe = await requestValue(recipes.get(input.recipeId)) as KitchenRecipe | undefined;
    if (!recipe) throw new Error('这道菜找不到了');
    const tag = { batchId, recipe: { id: recipe.id, prevCookedAt: recipe.lastCookedAt } };

    // 先在内存里把每一笔算完、核对完，有一笔不行就一笔都不写
    const current = new Map<string, KitchenLot>();
    const planned: { before: KitchenLot; after: KitchenLot; amount: number }[] = [];
    for (const item of input.deductions) {
      const before = current.get(item.lotId) ?? await requestValue(lots.get(item.lotId)) as KitchenLot | undefined;
      if (!before) throw new Error('有一样食材已经不在了，重新打开核对单');
      if (item.amount > before.quantity + CONTENT_EPSILON) {
        throw new Error('扣的比家里剩的多，改一下数量');
      }
      const quantity = Math.max(0, before.quantity - item.amount);
      const openContainerRemaining = quantity === 0 ? undefined : before.openContainerRemaining;
      const after: KitchenLot = { ...before, quantity, openContainerRemaining, packageState: openContainerRemaining === undefined ? 'sealed' : 'opened' };
      current.set(item.lotId, after);
      planned.push({ before, after, amount: item.amount });
    }

    let now = nextOccurredAt(await requestValue(events.getAll()) as KitchenEvent[]);
    planned.forEach(({ before, after }, i) => {
      events.add({
        id: makeId('event'), operationId: `${batchId}:${i}`, type: 'CONSUME', lotId: before.id, foodId: before.foodId,
        quantityDelta: after.quantity - before.quantity, quantityBefore: before.quantity, quantityAfter: after.quantity,
        contentDelta: totalContainerContent(after) - totalContainerContent(before),
        openContainerRemainingBefore: before.openContainerRemaining, openContainerRemainingAfter: after.openContainerRemaining,
        unit: before.unit, occurredAt: now, note: input.note, ...tag,
      } satisfies KitchenEvent);
      now += 1;
    });
    for (const lot of current.values()) lots.put({ ...lot, updatedAt: now });
    if (input.leftover) {
      await putNewLot({ foods, lots, events }, { ...input.leftover, foodState: 'prepared' }, `${batchId}:${planned.length}`, now, tag);
    }
    recipes.put({ ...recipe, cookedCount: (recipe.cookedCount ?? 0) + 1, lastCookedAt: now, updatedAt: now });
    await transactionDone(transaction);
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

async function moveLot(lotId: string, placement: KitchenFridgePlacement): Promise<void> {
  if (!['shelf', 'door-upper', 'door-middle', 'door-lower'].includes(placement)) throw new Error('请选择有效的摆放位置');
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction(STORE_LOTS, 'readwrite');
    const store = transaction.objectStore(STORE_LOTS);
    const lot = await requestValue(store.get(lotId)) as KitchenLot | undefined;
    if (!lot || lot.quantity <= 0 || !['fridge', 'freezer'].includes(lot.storageZone)) throw new Error('只能移动现有的冷藏或冷冻食材');
    if (lot.storageZone === 'freezer' && placement === 'door-middle') throw new Error('冷冻门只有上层和下层置物架');
    store.put({ ...lot, fridgePlacement: placement, updatedAt: Date.now() });
    await transactionDone(transaction);
  } finally { db.close(); }
}

async function updateLotDetails(input: UpdateKitchenLotDetailsInput): Promise<KitchenLot> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('请填写食材名称');

  const packageSize = input.packageSize?.trim() || undefined;
  const purchasedAt = input.purchasedAt || undefined;
  const expiresAt = input.expiresAt || undefined;
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_FOODS, STORE_LOTS], 'readwrite');
    const foods = transaction.objectStore(STORE_FOODS);
    const lots = transaction.objectStore(STORE_LOTS);
    const currentLot = await requestValue(lots.get(input.lotId)) as KitchenLot | undefined;
    if (!currentLot) throw new Error('这条库存已经不存在');
    const currentFood = await requestValue(foods.get(currentLot.foodId)) as KitchenFood | undefined;
    if (!currentFood) throw new Error('这条库存对应的食材不存在');

    const normalizedName = normalizeName(name);
    const sameName = normalizedName === currentFood.normalizedName;
    if (!sameName) {
      const existingFood = await requestValue(foods.index('normalizedName').get(normalizedName)) as KitchenFood | undefined;
      if (existingFood && existingFood.id !== currentFood.id) {
        throw new Error('已经有同名食材，请换个名称或继续使用原来的食材');
      }
    }

    const foodState = input.foodState ?? currentLot.foodState;
    const pantryKind = input.pantryKind === undefined ? currentLot.pantryKind : input.pantryKind ?? undefined;
    const lotUnchanged = currentLot.foodState === foodState
      && currentLot.pantryKind === pantryKind
      && currentLot.unit === input.unit
      && currentLot.storageZone === input.storageZone
      && currentLot.packageSize === packageSize
      && currentLot.purchasedAt === purchasedAt
      && currentLot.expiresAt === expiresAt;
    if (sameName && lotUnchanged) {
      await transactionDone(transaction);
      return currentLot;
    }

    const now = Date.now();
    const lot: KitchenLot = {
      ...currentLot,
      unit: input.unit,
      storageZone: input.storageZone,
      foodState,
      pantryKind,
      fridgePlacement: input.storageZone === currentLot.storageZone ? currentLot.fridgePlacement : undefined,
      packageSize,
      purchasedAt,
      expiresAt,
      updatedAt: now,
    };
    lots.put(lot);
    if (!sameName) {
      foods.put({
        ...currentFood,
        name,
        normalizedName,
        updatedAt: now,
      });
    }
    await transactionDone(transaction);
    return lot;
  } finally {
    db.close();
  }
}

/**
 * 撤销最近一笔；那一笔属于一批（一张小票、一道菜）就整批撤回。
 * 每一样都要还是那一笔之后的样子才撤：之后又动过的，说清楚撤不了，一样都不改。
 */
async function undoLatest(operationId = makeId('op')): Promise<KitchenOperationResult | null> {
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([STORE_LOTS, STORE_EVENTS, STORE_SHOPPING, STORE_RECIPES], 'readwrite');
    const lots = transaction.objectStore(STORE_LOTS);
    const events = transaction.objectStore(STORE_EVENTS);
    const existing = await findExistingOperation(events, lots, operationId);
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }

    const allEvents = await requestValue(events.getAll()) as KitchenEvent[];
    const undoable = allEvents
      .filter(event => event.type !== 'UNDO' && !event.undoneAt && hasKitchenEventChange(event))
      .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id));
    const target = undoable[0];
    if (!target) {
      await transactionDone(transaction);
      return null;
    }
    // 新的在前：同一批里同一样扣了两次，先退后一笔
    const group = target.batchId ? undoable.filter(event => event.batchId === target.batchId) : [target];

    const current = new Map<string, KitchenLot>();
    for (const item of group) {
      const lot = current.get(item.lotId) ?? await requestValue(lots.get(item.lotId)) as KitchenLot | undefined;
      if (!lot) throw new Error('无法撤销：对应的库存批次不存在');
      if (Math.abs(lot.quantity - item.quantityAfter) > CONTENT_EPSILON) {
        throw new Error('无法撤销：这批食物之后已经发生了变化');
      }
      const tracksOpenContainer = item.contentDelta !== undefined
        || item.openContainerRemainingBefore !== undefined
        || item.openContainerRemainingAfter !== undefined;
      if (tracksOpenContainer && !sameOptionalNumber(lot.openContainerRemaining, item.openContainerRemainingAfter)) {
        throw new Error('无法撤销：这批食物的开封余量已经发生了变化');
      }
      current.set(item.lotId, {
        ...lot,
        quantity: item.quantityBefore,
        packageState: item.openContainerRemainingBefore === undefined ? 'sealed' : 'opened',
        openContainerRemaining: item.openContainerRemainingBefore,
      });
    }

    const now = nextOccurredAt(allEvents);
    const undoEvents = group.map((item, i): KitchenEvent => ({
      id: makeId('event'),
      operationId: i === 0 ? operationId : `${operationId}:${i}`,
      type: 'UNDO',
      lotId: item.lotId,
      foodId: item.foodId,
      quantityDelta: item.quantityBefore - item.quantityAfter,
      quantityBefore: item.quantityAfter,
      quantityAfter: item.quantityBefore,
      contentDelta: -(item.contentDelta ?? item.quantityDelta),
      openContainerRemainingBefore: item.openContainerRemainingAfter,
      openContainerRemainingAfter: item.openContainerRemainingBefore,
      unit: item.unit,
      occurredAt: now,
      relatedOperationId: item.operationId,
    }));
    for (const lot of current.values()) lots.put({ ...lot, updatedAt: now });
    for (const item of group) events.put({ ...item, undoneAt: now });
    for (const event of undoEvents) events.add(event);

    // 撤销的是「放进」：这几笔顺手划掉的要买清单，勾也取消
    const added = new Set(group.filter(item => item.type === 'ADD').map(item => item.operationId));
    if (added.size) {
      const shopping = transaction.objectStore(STORE_SHOPPING);
      for (const item of await requestValue(shopping.getAll()) as KitchenShoppingItem[]) {
        if (!item.boughtBy || !added.has(item.boughtBy) || item.checkedBy !== 'bought') continue;
        shopping.put({ ...item, checkedAt: undefined, checkedBy: undefined, boughtBy: undefined, updatedAt: now });
      }
    }
    // 撤销的是做了一道菜：「做过几次」和「上次做」退回去
    const cooked = group.find(item => item.recipe)?.recipe;
    if (cooked) {
      const recipes = transaction.objectStore(STORE_RECIPES);
      const recipe = await requestValue(recipes.get(cooked.id)) as KitchenRecipe | undefined;
      if (recipe) recipes.put({ ...recipe, cookedCount: Math.max(0, (recipe.cookedCount ?? 1) - 1), lastCookedAt: cooked.prevCookedAt, updatedAt: now });
    }
    await transactionDone(transaction);
    return { lot: current.get(target.lotId)!, event: undoEvents[0], replayed: false };
  } finally {
    db.close();
  }
}

async function exportAll(): Promise<KitchenBackup> {
  const [foods, lots, events, shopping, recipes, sauces] = await Promise.all([
    getAll<KitchenFood>(STORE_FOODS),
    getAll<KitchenLot>(STORE_LOTS),
    getAll<KitchenEvent>(STORE_EVENTS),
    getAll<KitchenShoppingItem>(STORE_SHOPPING),
    getAll<KitchenRecipe>(STORE_RECIPES),
    getAll<KitchenSauce>(STORE_SAUCES),
  ]);
  return { foods, lots, events, shopping, recipes, sauces };
}

async function importAll(data: Partial<KitchenBackup>): Promise<void> {
  const db = await openKitchenDB();
  try {
    const selectedStores = [
      data.foods !== undefined ? STORE_FOODS : null,
      data.lots !== undefined ? STORE_LOTS : null,
      data.events !== undefined ? STORE_EVENTS : null,
      data.shopping !== undefined ? STORE_SHOPPING : null,
      data.recipes !== undefined ? STORE_RECIPES : null,
      data.sauces !== undefined ? STORE_SAUCES : null,
    ].filter((store): store is string => store !== null);
    if (selectedStores.length === 0) return;

    const transaction = db.transaction(selectedStores, 'readwrite');
    for (const store of selectedStores) transaction.objectStore(store).clear();
    for (const food of data.foods ?? []) transaction.objectStore(STORE_FOODS).put(food);
    for (const lot of data.lots ?? []) transaction.objectStore(STORE_LOTS).put(lot);
    for (const event of data.events ?? []) transaction.objectStore(STORE_EVENTS).put(event);
    for (const item of data.shopping ?? []) transaction.objectStore(STORE_SHOPPING).put(item);
    for (const recipe of data.recipes ?? []) transaction.objectStore(STORE_RECIPES).put(recipe);
    for (const sauce of data.sauces ?? []) transaction.objectStore(STORE_SAUCES).put(sauce);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

/* ── 要买清单 ── */

/**
 * 清单上写「牛奶」，买回来的是「有机全脂牛奶」也算买到了；菜谱写「番茄」，家里的「樱桃番茄」也算。
 * 只认一个方向：后一个名字比前一个更具体。名字后面再接「酱 / 面 / 粉 / 干…」就成了另一样东西
 * （番茄 ≠ 番茄酱，鸡蛋 ≠ 鸡蛋面，牛肉 ≠ 牛肉干），不算。2026-10-14 重审：原来两个方向都认，买番茄会划掉番茄酱。
 */
const DERIVED = /^(酱|面|粉|干|糖|汁|膏|饼|丸|酥|卷|酒|醋|油|露|味|罐头|饮料)/;
export const shoppingMatches = (listName: string, boughtName: string): boolean => {
  const a = normalizeName(listName).replace(/\s/g, ''), b = normalizeName(boughtName).replace(/\s/g, '');
  if (!a || !b) return false;
  if (a === b) return true;
  // 单字（葱、姜、蒜、米）：只认「小葱、生姜、大米」这种常见前缀加它；玉米不算「米」
  if (a.length === 1) return b.length === 2 && b.endsWith(a) && /^[小大生老嫩青白红黄紫香鲜]/.test(b);
  const at = b.indexOf(a);
  return at >= 0 && !DERIVED.test(b.slice(at + a.length));
};

async function writeShopping(work: (store: IDBObjectStore) => Promise<void>): Promise<void> {
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction(STORE_SHOPPING, 'readwrite');
    await work(transaction.objectStore(STORE_SHOPPING));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

/** 加一行；没划掉的同名已经在了就不重复加，划掉的同名重新打开 */
async function addShopping(name: string, lotId?: string): Promise<void> {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!clean) throw new Error('写一下要买什么');
  const normalizedName = normalizeName(clean), now = Date.now();
  await writeShopping(async store => {
    const all = await requestValue(store.getAll()) as KitchenShoppingItem[];
    const same = all.find(item => item.normalizedName === normalizedName);
    if (same && !same.checkedAt) return;
    if (same) { store.put({ ...same, checkedAt: undefined, checkedBy: undefined, boughtBy: undefined, updatedAt: now, ...(lotId ? { lotId } : {}) }); return; }
    store.put({ id: makeId('buy'), name: clean, normalizedName, ...(lotId ? { lotId } : {}), createdAt: now, updatedAt: now });
  });
}

/** 手动打勾 / 取消 */
async function toggleShopping(id: string): Promise<void> {
  await writeShopping(async store => {
    const item = await requestValue(store.get(id)) as KitchenShoppingItem | undefined;
    if (!item) return;
    const now = Date.now();
    store.put(item.checkedAt
      ? { ...item, checkedAt: undefined, checkedBy: undefined, boughtBy: undefined, updatedAt: now }
      : { ...item, checkedAt: now, checkedBy: 'hand', updatedAt: now });
  });
}

async function removeShopping(id: string): Promise<void> {
  await writeShopping(async store => { store.delete(id); });
}

async function clearCheckedShopping(): Promise<void> {
  await writeShopping(async store => {
    for (const item of await requestValue(store.getAll()) as KitchenShoppingItem[]) if (item.checkedAt) store.delete(item.id);
  });
}

/** 买回来放进厨房：名字对上的没划掉的行自动划掉，记下是哪一笔划的（撤销用），返回划掉了几行 */
async function markShoppingBought(added: { name: string; operationId: string }[]): Promise<number> {
  let count = 0;
  await writeShopping(async store => {
    const now = Date.now();
    for (const item of await requestValue(store.getAll()) as KitchenShoppingItem[]) {
      const by = item.checkedAt ? undefined : added.find(entry => shoppingMatches(item.name, entry.name));
      if (!by) continue;
      store.put({ ...item, checkedAt: now, checkedBy: 'bought', boughtBy: by.operationId, updatedAt: now });
      count += 1;
    }
  });
  return count;
}

/* ── 菜谱、酱汁库 ── */

/** 一行量：名字去空格，数量只认正数（不是正数就当「适量」），单位去空格、空的写「适量」 */
const cleanAmounts = (rows: KitchenAmount[]): KitchenAmount[] => rows
  .map(row => ({
    name: row.name.trim().replace(/\s+/g, ' ').slice(0, 60),
    amount: typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0 ? row.amount : null,
    unit: row.unit.trim().slice(0, 12),
  }))
  .filter(row => row.name)
  .map(row => ({ ...row, unit: row.amount === null ? '适量' : row.unit || '个' }));

async function writeStore(store: string, work: (objects: IDBObjectStore, transaction: IDBTransaction) => Promise<void>, also: string[] = []): Promise<void> {
  const db = await openKitchenDB();
  try {
    const transaction = db.transaction([store, ...also], 'readwrite');
    await work(transaction.objectStore(store), transaction);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

async function saveSauce(input: SaveSauceInput): Promise<KitchenSauce> {
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) throw new Error('给这个酱汁起个名字');
  const parts = cleanAmounts(input.parts);
  if (!parts.length) throw new Error('酱汁里至少写一样调料');
  let saved!: KitchenSauce;
  await writeStore(STORE_SAUCES, async store => {
    const now = Date.now();
    const old = input.id ? await requestValue(store.get(input.id)) as KitchenSauce | undefined : undefined;
    saved = { id: old?.id ?? makeId('sauce'), name, normalizedName: normalizeName(name), parts, note: input.note?.trim() || undefined, createdAt: old?.createdAt ?? now, updatedAt: now };
    store.put(saved);
  });
  return saved;
}

/** 删酱汁：挂着它的菜谱一起摘掉这一项，菜谱本身不动 */
async function deleteSauce(id: string): Promise<void> {
  await writeStore(STORE_SAUCES, async (store, transaction) => {
    store.delete(id);
    const recipes = transaction.objectStore(STORE_RECIPES);
    for (const recipe of await requestValue(recipes.getAll()) as KitchenRecipe[]) {
      if (!recipe.sauces.some(item => item.sauceId === id)) continue;
      recipes.put({ ...recipe, sauces: recipe.sauces.filter(item => item.sauceId !== id), updatedAt: Date.now() });
    }
  }, [STORE_RECIPES]);
}

async function saveRecipe(input: SaveRecipeInput): Promise<KitchenRecipe> {
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) throw new Error('给这道菜起个名字');
  const servings = Number.isFinite(input.servings) && input.servings > 0 ? Math.min(20, input.servings) : 1;
  const ingredients = cleanAmounts(input.ingredients);
  const sauces = input.sauces.filter((item, i, all) => item.sauceId && all.findIndex(other => other.sauceId === item.sauceId) === i)
    .map(item => ({ sauceId: item.sauceId, times: Number.isFinite(item.times) && item.times > 0 ? item.times : 1 }));
  if (!ingredients.length && !sauces.length) throw new Error('至少写一样食材或挂一个酱汁');
  let saved!: KitchenRecipe;
  await writeStore(STORE_RECIPES, async store => {
    const now = Date.now();
    const old = input.id ? await requestValue(store.get(input.id)) as KitchenRecipe | undefined : undefined;
    saved = {
      id: old?.id ?? makeId('recipe'), name, normalizedName: normalizeName(name), servings, ingredients, sauces,
      steps: input.steps?.trim() || undefined, note: input.note?.trim() || undefined,
      cookedCount: old?.cookedCount, lastCookedAt: old?.lastCookedAt, createdAt: old?.createdAt ?? now, updatedAt: now,
    };
    store.put(saved);
  });
  return saved;
}

async function deleteRecipe(id: string): Promise<void> {
  await writeStore(STORE_RECIPES, async store => { store.delete(id); });
}

export const KitchenDB = {
  addLot,
  addLots,
  cook,
  changeLot,
  consumePortion,
  setPortionRemaining,
  discardCurrentContainer,
  updateLotDetails,
  moveLot,
  undoLatest,
  getFoods: () => getAll<KitchenFood>(STORE_FOODS),
  getLots: () => getAll<KitchenLot>(STORE_LOTS),
  getEvents: async () => (await getAll<KitchenEvent>(STORE_EVENTS))
    .sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id)),
  getShopping: () => getAll<KitchenShoppingItem>(STORE_SHOPPING),
  getRecipes: () => getAll<KitchenRecipe>(STORE_RECIPES),
  getSauces: () => getAll<KitchenSauce>(STORE_SAUCES),
  saveRecipe,
  deleteRecipe,
  saveSauce,
  deleteSauce,
  addShopping,
  toggleShopping,
  removeShopping,
  clearCheckedShopping,
  markShoppingBought,
  exportAll,
  importAll,
};
