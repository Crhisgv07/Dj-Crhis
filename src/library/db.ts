/** Base IndexedDB compartida: `analysis` (BPM/rejilla/tonalidad/peaks) y
 *  `covers` (carátulas como data URL). */

const DB_NAME = "crhis";
const VERSION = 2;
export const STORE_ANALYSIS = "analysis";
export const STORE_COVERS = "covers";

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ANALYSIS)) {
          db.createObjectStore(STORE_ANALYSIS, { keyPath: "path" });
        }
        if (!db.objectStoreNames.contains(STORE_COVERS)) {
          db.createObjectStore(STORE_COVERS);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = db.transaction(store, "readonly").objectStore(store).get(key);
          req.onsuccess = () => resolve((req.result as T) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return openDb().then((db) => {
    if (!db) return;
    try {
      const os = db.transaction(store, "readwrite").objectStore(store);
      key === undefined ? os.put(value) : os.put(value, key);
    } catch {
      /* cuota / modo privado */
    }
  });
}
