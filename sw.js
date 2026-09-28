// Service worker: precaches the whole app (listed in precache.json) so it opens and trains offline,
// including when installed to the iPhone home screen. Requests are network-first (fresh code when
// online), falling back to the cache when offline. A new precache version replaces the old cache.
const PREFIX = 'training-room-';
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
      const c = await caches.open(PREFIX + list.version);
      await c.addAll(list.files.map(f => new Request(f, { cache: 'reload' })));
    } catch (err) { /* offline install: keep the previous cache */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys(); const mine = keys.filter(k => k.startsWith(PREFIX)).sort();
    // keep only the newest complete cache (plus any legacy one until a newer one exists)
    for (const k of mine.slice(0, -1)) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (u.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
      if (r.ok && r.type === 'basic') { const copy = r.clone(); const keys = (await caches.keys()).filter(k => k.startsWith(PREFIX)).sort(); if (keys.length) caches.open(keys[keys.length - 1]).then(c => c.put(e.request, copy)); }
      return r;
    } catch (err) {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === 'navigate') return (await caches.match('index.html')) || (await caches.match('./'));
      throw err;
    }
  })());
});
