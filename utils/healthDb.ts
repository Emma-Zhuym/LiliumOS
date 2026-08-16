/**
 * healthDb.ts — LiliumOS 健康 App 的 IndexedDB 操作
 *
 * 独立数据库，不动上游 AetherOS_Data。
 * 一个 store：health_events（workout / period / symptom）
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type PeriodFlow = 'spotting' | 'light' | 'medium' | 'heavy';
export type SleepQuality = 'good' | 'ok' | 'poor';
export type HealthEventType = 'workout' | 'period' | 'symptom' | 'sleep' | 'diet' | 'weight';

interface HealthEventBase {
  id: string;
  date: string;         // 'YYYY-MM-DD'
  createdAt: number;    // Date.now()
}

export interface WorkoutHealthEvent extends HealthEventBase {
  type: 'workout';
  activities?: string[]; // ['力量', '跑步'] 运动项目
  parts: string[];      // ['背', '腿'] 力量训练部位
  duration: number;     // 分钟
  calories?: number;
  summary: string;      // 主要动作，供角色读取
  rawInput?: string;    // 用户原始文字输入（备注）
}

export interface PeriodHealthEvent extends HealthEventBase {
  type: 'period';
  flow: PeriodFlow;
}

export interface SymptomHealthEvent extends HealthEventBase {
  type: 'symptom';
  symptoms: string[];
}

export interface SleepHealthEvent extends HealthEventBase {
  type: 'sleep';
  bedtime: string;      // 'HH:MM'
  wakeTime: string;     // 'HH:MM'
  duration: number;     // 分钟
  quality: SleepQuality;
  note?: string;
}

export interface DietHealthEvent extends HealthEventBase {
  type: 'diet';
  calories: number;
  protein?: number;     // g
  carbs?: number;       // g
  fat?: number;         // g
  fiber?: number;       // g
  rawInput?: string;    // 用户原始描述
  note?: string;        // 早餐/午餐/晚餐 标签
}

export interface WeightHealthEvent extends HealthEventBase {
  type: 'weight';
  value: number;        // kg
  note?: string;
}

export type HealthEvent =
  | WorkoutHealthEvent
  | PeriodHealthEvent
  | SymptomHealthEvent
  | SleepHealthEvent
  | DietHealthEvent
  | WeightHealthEvent;

// ── DB Setup ─────────────────────────────────────────────────────────────────

// Physical name stays for existing installations; migrate it only with a dedicated IndexedDB copy step.
const LEGACY_DB_NAME = 'SullyEM_Health';
const DB_VERSION = 1;
const STORE      = 'health_events';

function openHealthDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME, DB_VERSION);
    req.onerror   = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('date', 'date',   { unique: false });
        store.createIndex('type', 'type',   { unique: false });
        store.createIndex('date_type', ['date', 'type'], { unique: false });
      }
    };
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** 保存（新增 or 覆盖）一条健康事件 */
export async function saveHealthEvent(event: HealthEvent): Promise<void> {
  const db = await openHealthDB();
  await tx(db, 'readwrite', store => store.put(event));
  db.close();
}

/** 删除一条健康事件 */
export async function deleteHealthEvent(id: string): Promise<void> {
  const db = await openHealthDB();
  await tx(db, 'readwrite', store => store.delete(id));
  db.close();
}

/** 获取某天的全部事件 */
export async function getEventsByDate(date: string): Promise<HealthEvent[]> {
  const db = await openHealthDB();
  const all = await tx<HealthEvent[]>(db, 'readonly', store =>
    store.index('date').getAll(date)
  );
  db.close();
  return all;
}

/** 获取一段时间范围内的全部事件（包含边界） */
export async function getEventsByDateRange(
  startDate: string,
  endDate: string,
): Promise<HealthEvent[]> {
  const db = await openHealthDB();
  const all = await tx<HealthEvent[]>(db, 'readonly', store =>
    store.index('date').getAll(IDBKeyRange.bound(startDate, endDate))
  );
  db.close();
  return all;
}

/** 获取全部事件（用于 cycleCalc 等全量计算） */
export async function getAllHealthEvents(): Promise<HealthEvent[]> {
  const db = await openHealthDB();
  const all = await tx<HealthEvent[]>(db, 'readonly', store => store.getAll());
  db.close();
  return all;
}

/** 获取某类型的全部事件，按 date 升序 */
export async function getEventsByType(type: HealthEventType): Promise<HealthEvent[]> {
  const db = await openHealthDB();
  const all = await tx<HealthEvent[]>(db, 'readonly', store =>
    store.index('type').getAll(type)
  );
  db.close();
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

/** 构建 eventMap：{ 'YYYY-MM-DD': HealthEvent[] } */
export function buildEventMap(events: HealthEvent[]): Record<string, HealthEvent[]> {
  const map: Record<string, HealthEvent[]> = {};
  for (const e of events) {
    if (!map[e.date]) map[e.date] = [];
    map[e.date].push(e);
  }
  return map;
}

// ── 备份导出/导入 ────────────────────────────────────────────────────────────

export async function exportAllHealthEvents(): Promise<HealthEvent[]> {
  return getAllHealthEvents();
}

export async function importAllHealthEvents(events: HealthEvent[]): Promise<void> {
  const db = await openHealthDB();
  const t = db.transaction(STORE, 'readwrite');
  t.objectStore(STORE).clear();
  for (const e of events) t.objectStore(STORE).put(e);
  return new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
