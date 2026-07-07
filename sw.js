/* Service worker: makes the deployed app installable and usable offline.
   Strategy: network-first for navigations (so deploys show up immediately),
   cache-first for everything else (images, JS, CSS, fonts). */

const CACHE = "sws-v1";
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

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;

  if(req.mode === "navigate"){
    // network-first so a fresh deploy is picked up on next load
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

  // cache-first for static assets (incl. cross-origin fonts)
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
