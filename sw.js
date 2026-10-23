// Offline cache for the app shell and the engine. Chess.com API calls always go to the network.
const VERSION = 'v4';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/board.js', 'js/engine.js', 'js/store.js', 'js/chesscom.js', 'js/lichess.js', 'js/play.js', 'js/core.js', 'js/chess.js',
  'data/openings.json', 'icons/icon-192.png', 'icons/icon.svg',
  'engine/stockfish-17.1-lite-single-03e3232.js', 'engine/stockfish-17.1-lite-single-03e3232.wasm',
  ...['w', 'b'].flatMap((c) => ['K', 'Q', 'R', 'B', 'N', 'P'].map((p) => 'img/pieces/' + c + p + '.svg'))
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) {
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
