/* Service worker: la app (HTML/JS/CSS) va "red primero" para ver siempre la última versión y cae a caché sin
 * conexión; los datos (network.json, ~4 MB) van "caché y actualizar" para abrir al instante y funcionar offline. */
const SHELL = "lb-shell-v2";
const DATA = "lb-data-v1";
const FILES = ["./", "index.html", "style.css", "app.js", "search.js", "pesa.js", "theme.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.endsWith("/data/network.json")) {
    e.respondWith(caches.open(DATA).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || fresh;
    }));
    return;
  }

  e.respondWith(
    fetch(req)
      .then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))));
});
