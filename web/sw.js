/* Service worker: la app (HTML/JS/CSS) va "red primero" para ver siempre la última versión y cae a caché sin
 * conexión; los datos (network.json, ~4 MB) van "caché y actualizar" para abrir al instante y funcionar offline.
 * Además, si el usuario pulsa «Comprar en Avanza», intercepta esa navegación a online.pesa.net e inyecta en la
 * respuesta el relleno automático (web/pesa-autofill.js): la página sigue en el origen de Pesa, con su sesión real.
 */
importScripts("pesa-autofill.js");
const SHELL = "lb-shell-v6";
const DATA = "lb-data-v1";
const FILES = ["./", "index.html", "style.css", "app.js", "search.js", "realtime.js", "pesa.js", "pesa-autofill.js", "holidays.js", "fares.js", "theme.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png"];
let pendingPesa = null; // viaje del último «Comprar»
let specWaiters = [];

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "pesa-autofill" && e.data.spec) {
    pendingPesa = e.data.spec;
    specWaiters.splice(0).forEach((f) => f(pendingPesa)); // despierta la navegación que llegó antes que el mensaje
  }
});

// El postMessage y la navegación se lanzan juntos: si la navigate llega primero, la esperamos un momento.
function takeSpec() {
  if (pendingPesa) { const s = pendingPesa; pendingPesa = null; return Promise.resolve(s); }
  return new Promise((resolve) => {
    let done = false;
    const finish = (s) => { if (done) return; done = true; specWaiters = specWaiters.filter((f) => f !== finish); resolve(s); };
    specWaiters.push(finish);
    setTimeout(() => finish(null), 1500);
  });
}

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
  // Compra en Avanza: solo la navegación marcada con `lb` y solo si el botón acaba de pasar el viaje. Si falla
  // algo (HTML cambiado, navegación no interceptada), se sirve la página de Pesa tal cual y se compra a mano.
  if (req.mode === "navigate" && PESAAUTO.isPesa(url) && url.searchParams.has("lb")) {
    e.respondWith((async () => {
      const spec = await takeSpec();
      const r = await fetch(req);
      if (!spec) return r; // sin viaje, se abre la web de Pesa normalmente
      const html = PESAAUTO.inject(await r.text(), spec);
      const headers = new Headers(r.headers);
      headers.delete("content-length"); // el cuerpo cambia al inyectar el script
      headers.delete("content-encoding");
      return new Response(html, { status: r.status, statusText: r.statusText, headers });
    })().catch(() => fetch(req)));
    return;
  }
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
