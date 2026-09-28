// Local persistence. IndexedDB for everything the user generates; falls back to an in-memory
// store mirrored to localStorage when IndexedDB is unavailable. Nothing ever leaves the device.
const DB = 'training-room'; const VER = 1;
export const STORES = ['kv', 'repair', 'attempts', 'blitz', 'engine', 'games'];
let db = null; let mem = null;

function open() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, VER);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('repair')) d.createObjectStore('repair', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('attempts')) { const s = d.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true }); s.createIndex('mode', 'mode'); s.createIndex('t', 't'); }
      if (!d.objectStoreNames.contains('blitz')) d.createObjectStore('blitz', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('engine')) d.createObjectStore('engine');
      if (!d.objectStoreNames.contains('games')) d.createObjectStore('games', { keyPath: 'id' });
    };
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
export async function initStore() {
  try { if (!('indexedDB' in globalThis)) throw 0; db = await open(); }
  catch (e) { mem = {}; for (const s of STORES) mem[s] = new Map(); try { const raw = localStorage.getItem('training-room.fallback'); if (raw) { const o = JSON.parse(raw); for (const s of STORES) mem[s] = new Map(o[s] || []); } } catch (x) {} }
  return !!db;
}
const persistMem = () => { try { const o = {}; for (const s of STORES) o[s] = s === 'engine' ? [] : [...mem[s]]; localStorage.setItem('training-room.fallback', JSON.stringify(o)); } catch (e) {} };
const tx = (store, mode, fn) => new Promise((res, rej) => { const t = db.transaction(store, mode); const s = t.objectStore(store); const r = fn(s); t.oncomplete = () => res(r && 'result' in r ? r.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export async function get(store, key) { if (mem) return mem[store].get(key); return tx(store, 'readonly', s => s.get(key)); }
export async function put(store, value, key) {
  if (mem) { const k = key ?? value.id ?? (mem[store].size + 1); if (value && typeof value === 'object' && store === 'attempts' && value.id == null) value.id = k; mem[store].set(k, value); persistMem(); return k; }
  return tx(store, 'readwrite', s => (key !== undefined ? s.put(value, key) : s.put(value)));
}
export async function putMany(store, values) { if (mem) { for (const v of values) mem[store].set(v.id, v); persistMem(); return; } return tx(store, 'readwrite', s => { for (const v of values) s.put(v); }); }
export async function all(store) { if (mem) return [...mem[store].values()]; return tx(store, 'readonly', s => s.getAll()); }
export async function allKeys(store) { if (mem) return [...mem[store].keys()]; return tx(store, 'readonly', s => s.getAllKeys()); }
export async function clear(store) { if (mem) { mem[store].clear(); persistMem(); return; } return tx(store, 'readwrite', s => s.clear()); }

// Settings (kv) with small in-memory cache
const kvCache = new Map();
export async function setting(key, fallback) { if (kvCache.has(key)) return kvCache.get(key); const v = await get('kv', key); const out = v === undefined ? fallback : v; kvCache.set(key, out); return out; }
export async function setSetting(key, value) { kvCache.set(key, value); return put('kv', value, key); }

// Training attempts: one row per answered item across every mode.
export async function logAttempt(a) { const row = Object.assign({ t: Date.now() }, a); await put('attempts', row); return row; }
export async function attempts(mode) { const rows = await all('attempts'); return mode ? rows.filter(r => r.mode === mode) : rows; }

// ---- Backup ----
export async function exportAll() {
  const out = { format: 'training-room-backup', version: 1, exported: new Date().toISOString(), stores: {} };
  for (const s of STORES) {
    if (s === 'engine') continue; // cache can be rebuilt
    if (s === 'kv') { const keys = await allKeys('kv'); const vals = await all('kv'); out.stores.kv = keys.map((k, i) => [k, vals[i]]); }
    else out.stores[s] = await all(s);
  }
  return out;
}
export async function importAll(data, { merge = false } = {}) {
  if (!data || data.format !== 'training-room-backup') throw new Error('Not a Training Room backup');
  for (const s of STORES) {
    if (!(s in data.stores)) continue;
    if (!merge) await clear(s);
    if (s === 'kv') { for (const [k, v] of data.stores.kv) await put('kv', v, k); kvCache.clear(); }
    else await putMany(s, data.stores[s]);
  }
}
export async function resetAll() { for (const s of STORES) await clear(s); kvCache.clear(); }
