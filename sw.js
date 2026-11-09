// Offline cache for the app shell and the engine. Chess.com API calls always go to the network.
const VERSION = 'v10';
const ENGINE_CACHE = 'engine-full-19'; // kept across app updates: the full engine is ~100 MB
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/board.js', 'js/engine.js', 'js/store.js', 'js/chesscom.js', 'js/lichess.js', 'js/play.js', 'js/lab.js', 'js/core.js', 'js/chess.js',
  'data/openings.json', 'icons/icon-192.png', 'icons/icon.svg',
  'engine/stockfish-19-lite-single.js', 'engine/stockfish-19-lite-single.wasm',
  // the full engine (~100 MB, from the npm CDN) is not precached: it is kept the first time it is downloaded
  ...['w', 'b'].flatMap((c) => ['K', 'Q', 'R', 'B', 'N', 'P'].map((p) => 'img/pieces/' + c + p + '.svg'))
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== ENGINE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) {
    if (/stockfish-19-single\.wasm$/.test(url.pathname)) {
      e.respondWith(caches.open(ENGINE_CACHE).then((c) => c.match(e.request.url).then((r) => r || fetch(e.request.url, { mode: 'cors' }).then((res) => { if (res.ok) c.put(e.request.url, res.clone()); return res; }))));
      return;
    }
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
      e.respondWith(caches.open(VERSION + '-fonts').then((c) => c.match(e.request).then((r) => r || fetch(e.request).then((res) => { c.put(e.request, res.clone()); return res; }))));
    }
    return;
  }
  const isEngine = url.pathname.includes('/engine/');
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit && isEngine) return hit;
    // network first (so updates arrive at once), cache when offline
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch (err) { return hit || Response.error(); }
  }));
});
