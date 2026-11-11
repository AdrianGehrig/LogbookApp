// Einzige Stelle mit Datenbankzugriff. Für den späteren Sync wird hier eine
// zweite Implementierung mit derselben Schnittstelle ergänzt.
const Store = (() => {
  'use strict';
  const DB_NAME = 'logbook-app';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('logbooks')) db.createObjectStore('logbooks', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function run(store, mode, work) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  return {
    getAll: store => run(store, 'readonly', s => s.getAll()),
    put: (store, value) => run(store, 'readwrite', s => s.put(value)),
    bulkPut: (store, values) => run(store, 'readwrite', s => { values.forEach(v => s.put(v)); }),
    remove: (store, id) => run(store, 'readwrite', s => s.delete(id)),
  };
})();
