// Small IndexedDB wrapper: "games" (keyed by id) and "meta" (key/value).
const DB_NAME = 'scacchiera-vik', VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const store = {
  allGames: () => tx('games', 'readonly', (s) => req(s.getAll())),
  putGame: (g) => tx('games', 'readwrite', (s) => { s.put(g); }),
  putGames: (list) => tx('games', 'readwrite', (s) => { list.forEach((g) => s.put(g)); }),
  deleteGame: (id) => tx('games', 'readwrite', (s) => { s.delete(id); }),
  clearGames: () => tx('games', 'readwrite', (s) => { s.clear(); }),
  get: (k) => tx('meta', 'readonly', (s) => req(s.get(k))),
  set: (k, v) => tx('meta', 'readwrite', (s) => { s.put(v, k); }),
  async persist() { try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignore */ } return false; }
};
