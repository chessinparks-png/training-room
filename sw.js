// Service worker: precaches the whole app (listed in precache.json) so it opens and trains offline,
// including when installed to the iPhone home screen. Requests are network-first (fresh code when
// online), falling back to the cache when offline or when the network stalls.
// A completed install replaces every older cache, so old and new files are never mixed.
const PREFIX = 'training-room-';
const STALL_MS = 4000; // give up on a slow network after this long when a cached copy exists
let current = null; // name of the cache this worker installed (lost on restart; then the only cache)

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
      const name = PREFIX + list.version; const c = await caches.open(name);
      await c.addAll(list.files.map(f => new Request(f, { cache: 'reload' })));
      // complete: drop every other version (names are not ordered, so never sort them)
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== name) await caches.delete(k);
      current = name;
    } catch (err) { /* offline or partial install: keep the previous cache */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

async function cacheName() {
  if (current) return current;
  const keys = (await caches.keys()).filter(k => k.startsWith(PREFIX)); return keys[keys.length - 1] || null;
}
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (u.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith((async () => {
    // revalidate with the server: the browser HTTP cache could otherwise hand back stale modules
    const net = (e.request.mode === 'navigate' ? fetch(e.request) : fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then(async r => { if (r.ok && r.type === 'basic') { const n = await cacheName(); if (n) { const copy = r.clone(); caches.open(n).then(c => c.put(e.request.url, copy)).catch(() => {}); } } return r; });
    net.catch(() => {}); // a late failure after the cache answered is not an error
    const cached = () => caches.match(e.request.url, { ignoreSearch: true }).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('index.html').then(x => x || caches.match('./')) : null));
    const timer = new Promise(res => setTimeout(res, STALL_MS, 'stall'));
    try {
      const first = await Promise.race([net, timer]);
      if (first !== 'stall') return first;
      const hit = await cached(); if (hit) return hit; // network stalled: use the cached copy
      return await net;
    } catch (err) {
      const hit = await cached(); if (hit) return hit;
      throw err;
    }
  })());
});
