/**
 * mapWorlds.ts — 地图世界存储与匹配（LiliumOS 独有）
 *
 * 从 MapApp.tsx 抽出，让 scheduleGenerator 也能读角色的地图地点清单
 * （生成日程时注入 prompt，slot 直出 regionId）。
 */

import { ScheduleSlot } from '../types';

export interface MapRegion {
  id: string;
  name: string;
  glyph: string;
  color: string;          // legacy（旧版彩色圆点），Clay 版不再使用但保留存量数据
  x: number;              // 0-100 归一化坐标
  y: number;
  isHome?: boolean;       // "你" 的默认位置
  isCharDefault?: boolean; // 角色的默认位置
  locationKeys?: string[];
  description?: string;   // 一句话地点描述（展示 + 注入日程生成）
}

export interface MapWorld {
  id: string;
  charId: string;
  genre: string;
  tag: string;
  tagColor: string;       // legacy
  tagBg: string;          // legacy
  theme?: string;         // legacy（旧版主题皮肤），Clay 版统一暖白
  regions: MapRegion[];
  homeRegionId?: string;
  cityName?: string;      // 虚拟城市名，地图页标题
}

// Physical name stays for existing installations; migrate it only with a dedicated IndexedDB copy step.
const LEGACY_MAP_DB = 'SullyEM_Map';
const MAP_DB_VER = 2;
const STORE = 'worlds';

function openMapDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_MAP_DB, MAP_DB_VER);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
  });
}

export const MapDB = {
  getAll: async (): Promise<MapWorld[]> => {
    const db = await openMapDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  save: async (w: MapWorld) => {
    const db = await openMapDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(w);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  remove: async (id: string) => {
    const db = await openMapDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  importAll: async (worlds: MapWorld[]) => {
    const db = await openMapDB();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    for (const world of worlds) store.put(world);
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

/** 某角色的地图世界（没建过则 null）。 */
export async function getWorldForChar(charId: string): Promise<MapWorld | null> {
  const all = await MapDB.getAll().catch(() => [] as MapWorld[]);
  return all.find(w => w.charId === charId) || null;
}

/**
 * 时段 → 地图地点。优先级：
 *   1. slot.regionId（生成日程时 AI 直接绑定，最可靠）
 *   2. slot.location 含地点名（AI 常直接写地点原名）
 *   3. slot.location 命中 locationKeys 关键词（老日程回退，零迁移）
 */
export function matchRegionForSlot(world: MapWorld, slot?: ScheduleSlot | null): MapRegion | undefined {
  if (!slot) return undefined;
  if (slot.regionId) {
    const byId = world.regions.find(r => r.id === slot.regionId);
    if (byId) return byId;
  }
  const loc = slot.location?.toLowerCase();
  if (!loc) return undefined;
  const byName = world.regions.find(r => r.name && loc.includes(r.name.toLowerCase()));
  if (byName) return byName;
  return world.regions.find(r => r.locationKeys?.some(k => k && loc.includes(k.toLowerCase())));
}
