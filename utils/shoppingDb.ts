/**
 * shoppingDb.ts — IndexedDB persistence for ShoppingApp.
 * Stores: products, cart, orders, settings.
 */

export interface ShopProduct {
  id: string;
  name: string;
  brand: string;
  price: number;
  note: string;
  type: 'net' | 'food';
  cat: string;
  shop?: string;
  fav: boolean;
}

export interface CartItem {
  id: string;
  qty: number;
  note?: string;
}

export interface OrderLine {
  id: string;
  qty: number;
  note?: string;
}

export interface ShopOrder {
  id: string;
  type: 'net' | 'food';
  receiver: string;
  receiverCharId?: string;
  status: 'active' | 'done';
  note: string;
  placedAt: number;
  etaTimestamp?: number;
  lines: OrderLine[];
  isGiftFromChar?: boolean;
  awaitingReply?: boolean;
  charReply?: string;
}

// Physical name stays for existing installations; migrate it only with a dedicated IndexedDB copy step.
const LEGACY_DB_NAME = 'SullyEM_Shopping';
const DB_VERSION = 1;
const STORE_PRODUCTS = 'products';
const STORE_CART = 'cart';
const STORE_ORDERS = 'orders';
const STORE_SETTINGS = 'settings';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_CART)) db.createObjectStore(STORE_CART, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_ORDERS)) db.createObjectStore(STORE_ORDERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
    };
  });
}

async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put<T>(store: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function del(store: string, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clear(store: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const DEFAULT_PRODUCTS: ShopProduct[] = [
  { id: 'p1', name: '小熊玩偶', brand: 'Jellycat', price: 89, note: '', type: 'net', cat: 'toy', fav: false },
  { id: 'p2', name: '永生花束', brand: '野兽派', price: 128, note: '', type: 'net', cat: 'flower', fav: false },
  { id: 'p3', name: '细钻戒指', brand: 'Tiffany', price: 12800, note: '', type: 'net', cat: 'jewelry', fav: false },
  { id: 'p4', name: '巧克力礼盒', brand: 'GODIVA', price: 66, note: '', type: 'net', cat: 'snack', fav: false },
  { id: 'p5', name: '招牌热奶茶', brand: '霸王茶姬', price: 18, note: '温热 · 微糖', type: 'food', shop: '霸王茶姬', cat: 'drink', fav: true },
  { id: 'p6', name: '伯牙绝弦', brand: '霸王茶姬', price: 17, note: '冰 · 三分糖', type: 'food', shop: '霸王茶姬', cat: 'drink', fav: false },
  { id: 'p7', name: '手冲咖啡', brand: 'Manner', price: 22, note: '热 · 不加糖', type: 'food', shop: 'Manner', cat: 'drink', fav: false },
  { id: 'p8', name: '芝士蛋糕', brand: '奈雪的茶', price: 28, note: '一块装', type: 'food', shop: '奈雪的茶', cat: 'dessert', fav: false },
];

const SHOP_ETA: Record<string, number> = { '霸王茶姬': 20, 'Manner': 25, '奈雪的茶': 30 };

export const ShoppingDB = {
  init: async () => {
    const existing = await getAll<ShopProduct>(STORE_PRODUCTS);
    if (existing.length === 0) {
      for (const p of DEFAULT_PRODUCTS) await put(STORE_PRODUCTS, p);
    }
  },

  getProducts: () => getAll<ShopProduct>(STORE_PRODUCTS),
  saveProduct: (p: ShopProduct) => put(STORE_PRODUCTS, p),
  deleteProduct: (id: string) => del(STORE_PRODUCTS, id),

  getCart: () => getAll<CartItem>(STORE_CART),
  saveCartItem: (item: CartItem) => put(STORE_CART, item),
  removeCartItem: (id: string) => del(STORE_CART, id),
  clearCart: () => clear(STORE_CART),

  getOrders: () => getAll<ShopOrder>(STORE_ORDERS),
  saveOrder: (o: ShopOrder) => put(STORE_ORDERS, o),

  captureReply: async (charId: string, reply: string) => {
    const orders = await getAll<ShopOrder>(STORE_ORDERS);
    for (const o of orders) {
      if (o.awaitingReply && o.receiverCharId === charId) {
        await put(STORE_ORDERS, { ...o, awaitingReply: false, charReply: reply });
      }
    }
  },

  getShopEta: (shop: string) => SHOP_ETA[shop] ?? 30,

  exportAll: async () => {
    const [products, cart, orders, settings] = await Promise.all([
      getAll<ShopProduct>(STORE_PRODUCTS),
      getAll<CartItem>(STORE_CART),
      getAll<ShopOrder>(STORE_ORDERS),
      getAll<{ key: string; value: unknown }>(STORE_SETTINGS),
    ]);
    return { products, cart, orders, settings };
  },

  importAll: async (data: {
    products?: ShopProduct[];
    cart?: CartItem[];
    orders?: ShopOrder[];
    settings?: { key: string; value: unknown }[];
  }) => {
    const db = await openDB();
    const requestedStores = [
      data.products !== undefined ? STORE_PRODUCTS : null,
      data.cart !== undefined ? STORE_CART : null,
      data.orders !== undefined ? STORE_ORDERS : null,
      data.settings !== undefined ? STORE_SETTINGS : null,
    ];
    const storeNames = requestedStores
      .filter((s): s is string => s !== null && db.objectStoreNames.contains(s));
    if (storeNames.length === 0) return;
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) tx.objectStore(name).clear();
    if (data.products) for (const p of data.products) tx.objectStore(STORE_PRODUCTS).put(p);
    if (data.cart) for (const c of data.cart) tx.objectStore(STORE_CART).put(c);
    if (data.orders) for (const o of data.orders) tx.objectStore(STORE_ORDERS).put(o);
    if (data.settings) for (const s of data.settings) tx.objectStore(STORE_SETTINGS).put(s);
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
