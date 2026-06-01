// sw.js — makes the app installable and lets it open offline.
// It caches only the app's own shell. It deliberately stays out of the way
// of /api/ calls (Notion sync) and outside resources (Chart.js, fonts).
const CACHE = "spine-tracker-v1";
const SHELL = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {}))); // don't fail if one is missing
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;          // leave POST/DELETE (saving) alone
  if (url.pathname.startsWith("/api/")) return;    // Notion sync always hits the network
  if (url.origin !== location.origin) return;      // let Chart.js / Google Fonts load normally

  // The page itself: try network first (so updates show), fall back to cache when offline.
  if (e.request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request).then(m => m || caches.match("/index.html")))
    );
    return;
  }
  // Other own files (icons, manifest): cache first.
  e.respondWith(caches.match(e.request).then(m => m || fetch(e.request)));
});
