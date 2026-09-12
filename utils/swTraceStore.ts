// [EM-START: sw-trace-storage]
// Diagnostic records live apart from the inbox. A failed trace must never delay delivery.
const DB_NAME = 'ActiveMsgSwTrace';
const STORE = 'entries';
// v2 repairs the empty v1 database created by older page-side diagnostic reads.
const VERSION = 2;
const LIMIT = 300;
let connection: Promise<IDBDatabase> | null = null;

const openWriter = (): Promise<IDBDatabase> => {
  if (connection) return connection;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    let settled = false;
    const fail = (error: unknown) => {
      settled = true;
      if (connection === pending) connection = null;
      reject(error);
    };
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
      }
    };
    request.onblocked = () => fail(new Error('Diagnostic database is busy'));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      const release = () => { if (connection === pending) connection = null; };
      db.onversionchange = () => { db.close(); release(); };
      db.onclose = release;
      resolve(db);
    };
  });
  connection = pending;
  void pending.catch(() => { if (connection === pending) connection = null; });
  return pending;
};

export async function appendSwTraceEntry(entry: Record<string, any>): Promise<void> {
  const db = await openWriter();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.add(entry);
    const count = store.count();
    count.onsuccess = () => {
      let remaining = count.result - LIMIT;
      if (remaining <= 0) return;
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result || remaining-- <= 0) return;
        cursor.result.delete();
        cursor.result.continue();
      };
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Diagnostic write aborted'));
  });
}

/** A page read must not create a database, even before a new SW has run. */
export async function readSwTraceEntries(): Promise<Record<string, any>[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await new Promise<IDBDatabase | null>(resolve => {
      const request = indexedDB.open(DB_NAME);
      let settled = false;
      const unavailable = () => { settled = true; resolve(null); };
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onerror = unavailable;
      request.onblocked = unavailable;
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        resolve(request.result);
      };
    });
    if (!db) return [];
    try {
      if (!db.objectStoreNames.contains(STORE)) return [];
      return await new Promise<Record<string, any>[]>(resolve => {
        const tx = db.transaction(STORE, 'readonly');
        const read = tx.objectStore(STORE).getAll();
        let rows: Record<string, any>[] = [];
        read.onsuccess = () => { rows = read.result || []; };
        tx.oncomplete = () => resolve(rows);
        tx.onerror = tx.onabort = () => resolve([]);
      });
    } finally { db.close(); }
  } catch { return []; }
}
// [EM-END: sw-trace-storage]
