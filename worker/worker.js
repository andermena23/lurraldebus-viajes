/* Proxy de tiempo real para Lurraldebus (exige npm i -g wrangler + wrangler deploy).
 *
 * La web oficial de Lurraldebus sirve el tiempo real ("kartel hervea") de dos formas:
 * de las paradas por municipio en JSON y de las llegadas en una tabla HTML. Ninguna
 * de las dos lleva cabeceras CORS, de ahí que no se pueda llamar directamente desde
 * la web del comparador (GitHub Pages, el dominio es otro), así que este Worker
 * (mismo protocolo HTTP, dos GET, CORS abierto) reenvía las peticiones:
 *
 *   GET /stops?muni=<idMunicipio>      -> JSON de paradas del municipio
 *   GET /arrivals?stop=<idParada>&muni=<idMunicipio>  -> HTML del tablero de llegadas
 *
 * Caché en memoria (20 s para llegadas, 10 min para paradas) para no golpear al
 * servidor oficial cuando varios usuarios miran la misma parada a la vez.
 */
const UP = "https://lurraldebus.eus";
const AUTH = "lurraldebus-viajes (proxy de tiempo real; https://github.com/ander/lurraldebus-viajes)";
const TTL_ARRIVALS = 20000; // ms
const TTL_STOPS = 600000; // ms

const MUNI_RE = /^\d{4}[0-9A-Z]{0,3}$/i; // 20069, 20036N01, 01008…
const STOP_RE = /^\d{1,4}$/;

// caché por aislamiento de Cloudflare: Map<url, {ts, prom, x?}>
const cache = new Map();

function cors(env, origin) {
  const allowed = (env && env.ALLOW_ORIGIN) || "*";
  const value = allowed.split(",").map((s) => s.trim()).find((o) => o === "*" || o === origin);
  return {
    "Access-Control-Allow-Origin": value || allowed.split(",")[0].trim(),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Origin, Accept",
    "Vary": "Origin",
  };
}

const fail = (status, text, extra) =>
  new Response(JSON.stringify({ error: text }), { status, headers: extra });

function cached(key, ttl, fetcher) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.ts < ttl) return hit.prom;
  const prom = fetcher().catch((e) => {
    if (hit && hit.prom) return hit.prom; // si falla una petición fresca, servimos la última buena
    cache.delete(key);
    throw e;
  });
  cache.set(key, { ts: now, prom });
  if (cache.size > 2000) cache.clear(); // límite generoso de memoria
  return prom;
}

const upstream = (path, body, headers = {}) =>
  fetch(UP + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": AUTH, ...headers },
    body: new URLSearchParams(body).toString(),
  });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, "") });
    if (request.method !== "GET") return fail(405, "Solo GET");
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const head = cors(env, origin);

    try {
      // /stops?muni=<id> -> JSON del servidor oficial, sin tocar
      if (url.pathname === "/stops") {
        const muni = url.searchParams.get("muni") || "";
        if (!MUNI_RE.test(muni)) return fail(400, "Falta el parámetro muni válido", head);
        const prom = cached("s:" + muni, TTL_STOPS, async () => {
          const r = await upstream("/real/ajax_get_paradas_municipio_info.json", { municipioId: muni });
          if (!r.ok) throw new Error("upstream " + r.status);
          return r.text();
        });
        return new Response(await prom, { headers: { "Content-Type": "application/json; charset=utf-8", ...head } });
      }

      // /arrivals?stop=<id>&muni=<id> -> HTML del tablero oficial de llegadas, sin tocar
      if (url.pathname === "/arrivals") {
        const stop = url.searchParams.get("stop") || "";
        const muni = url.searchParams.get("muni") || "0000";
        if (!STOP_RE.test(stop) || !MUNI_RE.test(muni)) return fail(400, "Falta el parámetro stop y/o muni válidos", head);
        const prom = cached("a:" + stop + ":" + muni, TTL_ARRIVALS, async () => {
          const r = await upstream("/real/result", {
            _method: "POST", "data[Real][municipioId]": muni, "data[Real][paradaId]": stop,
          });
          if (!r.ok || r.status >= 500) throw new Error("upstream " + r.status);
          return r.text();
        });
        return new Response(await prom, { headers: { "Content-Type": "text/html; charset=utf-8", ...head } });
      }

      return fail(404, "Rutas: /stops?muni=… y /arrivals?stop=…&muni=…", head);
    } catch (e) {
      return fail(502, "La web oficial no responde: " + e.message, head);
    }
  },
};
