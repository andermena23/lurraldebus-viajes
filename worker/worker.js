/* Proxy de tiempo real para Lurraldebus.
 *
 * La web oficial no manda cabeceras CORS, así que el navegador no puede leer el
 * tablero de llegadas desde GitHub Pages. Este Worker (mismo protocolo HTTP, dos
 * GET, CORS abierto) reenvía las peticiones y devuelve solo el trozo de HTML que
 * interesa (la tabla de llegadas), no la página entera:
 *
 *   GET /health                       -> { ok: true }
 *   GET /board?muni=<id>&stop=<id>    -> HTML de la tabla de llegadas
 *
 * El tablero oficial se sirve en GET /real/result/<municipio>/<parada>. Lleva
 * caché en memoria (15 s) para no golpear al servidor oficial cuando varios
 * usuarios miran la misma parada a la vez. La cabecera X-RT-Time indica a qué
 * instante corresponden los minutos que trae la tabla.
 */
const UP = "https://lurraldebus.eus";
const UA = "lurraldebus-viajes/1.0 (tiempo real; https://github.com/andermena23/lurraldebus-viajes)";
const TTL = 15000; // ms
const TIMEOUT = 12000; // ms
// Antigüedad máxima de la última respuesta buena que se sirve cuando falla la petición fresca. Más allá, los minutos del
// tablero ya no valen (el cliente calcularía ETAs negativas) y es mejor un 502 que un dato viejo.
const STALE = 90000; // ms

const MUNI_RE = /^\d{4}[0-9A-Z]{0,3}$/i; // 20069, 20036N01, 01008...
const STOP_RE = /^\d{1,4}$/;

// caché por aislamiento de Cloudflare: Map<clave, {ts, value}>
const cache = new Map();
const inflight = new Map();

// ALLOW_ORIGIN: "*" o lista separada por comas. Con lista se responde con el Origin de la petición si está permitido (el
// navegador solo acepta un valor); si no, con el primero de la lista, de modo que el navegador lo bloquea. Vary: Origin va
// siempre, para que ninguna caché intermedia reutilice la respuesta de un origen con otro.
function cors(env, origin) {
  const allowed = ((env && env.ALLOW_ORIGIN) || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const value = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Access-Control-Expose-Headers": "X-RT-Time, X-RT-Now",
    "Vary": "Origin",
  };
}

const json = (data, status, extra) =>
  new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

const fail = (status, text, extra) => json({ error: text }, status, extra);

// El tablero es una página entera (~400 KB); nos quedamos solo con la tabla. Si no aparece (la web cambió o devolvió otra
// cosa), cadena vacía: el cliente lo trata como un tablero sin filas, en vez de recibir la página entera.
function extractTable(html) {
  const m = html.match(/<div class="live-lines-content">[\s\S]*?<\/table>/i);
  return m ? m[0] : "";
}

async function fetchBoard(muni, stop) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(`${UP}/real/result/${encodeURIComponent(muni)}/${encodeURIComponent(stop)}`, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es,eu;q=0.8,en;q=0.6",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error("upstream " + r.status);
    return { html: extractTable(await r.text()), ts: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

// Devuelve la última respuesta buena si una petición fresca falla, pero solo si tiene menos de STALE.
function cached(key, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);
  const p = fetcher()
    .then((value) => {
      cache.set(key, { ts: Date.now(), value });
      if (cache.size > 2000) cache.clear(); // límite generoso de memoria
      inflight.delete(key);
      return value;
    })
    .catch((e) => {
      inflight.delete(key);
      if (hit && Date.now() - hit.ts < STALE) return hit.value; // si falla una petición fresca, servimos la última buena (no muy vieja)
      throw e;
    });
  inflight.set(key, p);
  return p;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const head = cors(env, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (request.method !== "GET") return fail(405, "Solo GET", head);

    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        return json({ ok: true, now: Date.now() }, 200, head);
      }

      if (url.pathname === "/board") {
        const muni = url.searchParams.get("muni") || "";
        const stop = url.searchParams.get("stop") || "";
        if (!MUNI_RE.test(muni) || !STOP_RE.test(stop)) {
          return fail(400, "Faltan los parámetros muni y/o stop válidos", head);
        }
        const value = await cached(`${muni}:${stop}`, () => fetchBoard(muni, stop));
        return new Response(value.html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-RT-Time": String(value.ts),
            "X-RT-Now": String(Date.now()),
            ...head,
          },
        });
      }

      return fail(404, "Rutas: /health y /board?muni=…&stop=…", head);
    } catch (e) {
      return fail(502, "La web oficial no responde: " + (e.message || e), head);
    }
  },
};
