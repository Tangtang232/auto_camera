// Keeps this session's photos on the phone (IndexedDB) until they are saved to Photos.
// Every call can fail (private mode, storage full); callers fall back to memory.

const DB_NAME = 'paihao';
const STORE = 'photos';
let dbPromise = null;

function open() {
  if (!('indexedDB' in self)) return Promise.reject(new Error('IndexedDB unavailable'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, work) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const plain = ({ id, blob, ts, w, h, saved, processed, look, keep }) => ({
  id, blob, ts, w, h, saved: !!saved, processed: processed || null, look: look || null, keep: keep || null,
});

export const putPhoto = (p) => run('readwrite', (s) => s.put(plain(p)));
export const allPhotos = () => run('readonly', (s) => s.getAll()).then((list) => (list || []).sort((a, b) => a.ts - b.ts));
export const removePhotos = (ids) => run('readwrite', (s) => { ids.forEach((id) => s.delete(id)); });
