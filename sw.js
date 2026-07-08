/* Service worker: makes the deployed app installable and usable offline.

   Strategy:
   - Code & documents (HTML, JS, CSS, manifest) → NETWORK-FIRST, so a fresh
     deploy always wins and the app can never get stuck on stale scripts.
     Falls back to cache only when offline.
   - Everything else (images, fonts) → CACHE-FIRST for speed; these are
     stable and change rarely (bump CACHE when they do).

   Bump CACHE on any release that changes precached assets. */

const CACHE = "sws-v2";
const PRECACHE = [
  ".",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/gl.js",
  "js/scenes.js",
  "assets/sky.jpg",
  "assets/night.jpg",
  "assets/page.jpg",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/og.jpg",
  "manifest.webmanifest",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isCodeAsset = url =>
  url.origin === location.origin &&
  /\.(?:html|js|css|webmanifest)$/.test(url.pathname);

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  // network-first for navigations and code assets
  if(req.mode === "navigate" || isCodeAsset(url)){
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("index.html")))
    );
    return;
  }

  // cache-first for static assets (images, cross-origin fonts)
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if(res.ok || res.type === "opaque"){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
