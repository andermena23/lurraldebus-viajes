/* Tiempo real de Lurraldebus: tablero oficial de llegadas ("kartel hervea").
 *
 * La web oficial no manda cabeceras CORS, así que las peticiones pasan por el
 * proxy de worker/ (Cloudflare Worker) o por scripts/dev_proxy.py en local.
 *
 * El tablero da los minutos que quedan para que cada bus llegue a una parada,
 * junto al instante (cabecera X-RT-Time) en que se generó. Con eso se calcula la
 * hora prevista del bus y se compara con el horario GTFS para saber si va
 * retrasado. La posición no es GPS: Lurraldebus no publica coordenadas, así que
 * se deduce consultando unas cuantas paradas del recorrido y se marca como
 * aproximada.
 *
 * Funciona en navegador (window.RT) y en Node (module.exports) para poder probarlo.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // El workflow de Pages sustituye este marcador por la URL del Worker.
  const DEFAULT_PROXY = "__RT_PROXY__";
  const PLACEHOLDER = /^__[A-Z0-9_]+__$/;
  const STORE_KEY = "lb-rt-proxy";
  const STORE_OFF = "-"; // valor guardado cuando se desactiva el panel en vivo
  const TTL = 10000; // ms de caché por parada en el cliente (el Worker cachea 15 s)
  const TOL = 30; // desvío máximo (min) para casar un bus del tablero con el horario
  const DELAY_TOL = 12; // diferencia máxima de retraso entre dos paradas del mismo bus

  const STRIP = /[\u0300-\u036f]/g;
  const plain = (s) => String(s || "").normalize("NFD").replace(STRIP, "").toLowerCase().trim();
  const lineKey = (s) => plain(s).replace(/[^a-z0-9]/g, "");
  const clean = (s) => String(s || "").trim().replace(/\/+$/, "");
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  const decode = (s) => String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&mdash;|&ndash;/gi, "—")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  // Minutos de 0 a 1439. Los viajes que cruzan medianoche pueden venir en 1440+.
  const mod = (m) => ((m % 1440) + 1440) % 1440;
  // Desvío circular más corto entre dos minutos del día: a - b en [-720, 720].
  const diff = (a, b) => { const d = mod(a - b); return d > 720 ? d - 1440 : d; };

  let madridFmt = null;
  function madridParts(ts) {
    if (!madridFmt) madridFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    const out = {};
    for (const p of madridFmt.formatToParts(new Date(ts))) if (p.type !== "literal") out[p.type] = p.value;
    return out;
  }
  const madridMin = (ts) => { const p = madridParts(ts); return Number(p.hour) * 60 + Number(p.minute); };
  const madridDate = (ts) => { const p = madridParts(ts); return `${p.year}-${p.month}-${p.day}`; };
  const clockAt = (ts) => { const p = madridParts(ts); return `${p.hour}:${p.minute}`; };
  const today = (ts) => madridDate(ts == null ? Date.now() : ts);

  // ---- URL del proxy -------------------------------------------------------
  function builtinProxy() {
    if (!PLACEHOLDER.test(DEFAULT_PROXY)) return clean(DEFAULT_PROXY);
    try {
      if (typeof location !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))
        return "http://localhost:8931";
    } catch (e) {}
    return "";
  }

  function getProxy() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved === STORE_OFF) return "";
      if (clean(saved)) return clean(saved);
    } catch (e) {}
    return builtinProxy();
  }

  function setProxy(url) {
    const value = clean(url);
    try { localStorage.setItem(STORE_KEY, value || STORE_OFF); } catch (e) {}
    return getProxy();
  }

  const available = () => !!getProxy();

  // Comprueba que el proxy responde (botón «Probar» de Ajustes).
  async function check(proxy, opts = {}) {
    const base = clean(proxy || getProxy());
    if (!base) return { ok: false, error: "sin proxy" };
    const f = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    if (!f) return { ok: false, error: "sin fetch" };
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeout || 10000) : null;
    try {
      const r = await f(`${base}/health`, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      let data = null;
      try { data = await r.json(); } catch (e) {}
      return { ok: !!(data && data.ok !== false), now: data && data.now, base };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : "no responde" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---- Tablero oficial ------------------------------------------------------
  // Cada fila: línea, recorrido, ocupación (número o null), destino y minutos
  // hasta la llegada (null si el tablero no trae previsión: "—").
  function parseBillboard(html) {
    const rows = [];
    const trs = String(html || "").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      if (!/line-number/i.test(tr)) continue;
      const line = (tr.match(/<p class="line-number">([\s\S]*?)<\/p>/i) || [])[1];
      if (!line) continue;
      const name = (tr.match(/<p class="line-name">([\s\S]*?)<\/p>/i) || [])[1];
      const occTag = (tr.match(/<p class="line-direction">([\s\S]*?)<\/p>/i) || [])[1] || "";
      const occTxt = (occTag.match(/<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || decode(occTag);
      const occNum = String(occTxt).match(/\d+/);
      const dir = (tr.match(/<td class="line-direction">\s*([^<]*)<\/td>/i) || [])[1];
      const time = (tr.match(/class="live-line-time"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1];
      const mins = time && String(time).match(/\d+/);
      rows.push({
        line: decode(line),
        name: name ? decode(name) : "",
        occ: occNum ? Number(occNum[0]) : null,
        dir: dir ? decode(dir) : "",
        minutes: mins ? Number(mins[0]) : null,
      });
    }
    return rows;
  }

  // Cuánto se parece el destino del tablero al sentido del viaje (1 sí, 0 no
  // consta, -1 claramente no). El tablero a veces da solo la última parada o el
  // municipio, así que se compara con cabeza de línea y últimas paradas.
  function dirScore(row, refs) {
    const d = plain(row.dir);
    if (!d || d.length < 3) return 0;
    const hay = refs.map(plain).join(" | ");
    if (!hay) return 0;
    const words = d.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    if (!words.length) return hay.includes(d) ? 1 : 0;
    return words.some((w) => hay.includes(w)) ? 1 : -1;
  }

  // Busca en el tablero la fila que corresponde a un viaje del horario.
  // `sched` es la hora programada (minutos desde medianoche, puede ser 1440+),
  // `atMin` el minuto del día en que se generó el tablero y `opts.refs` textos
  // del sentido (headsign, últimas paradas...) para desempatar.
  function matchRow(rows, line, sched, atMin, opts = {}) {
    const L = lineKey(line);
    const refs = opts.refs || [];
    const tol = opts.tol == null ? TOL : opts.tol;
    let best = null;
    for (const r of rows || []) {
      if (r.minutes == null || lineKey(r.line) !== L) continue;
      const delay = diff(atMin + r.minutes, sched);
      if (Math.abs(delay) > tol) continue;
      const score = Math.abs(delay) - dirScore(r, refs) * 3;
      if (!best || score < best.score) best = { ...r, delay, score };
    }
    return best;
  }

  // Crea una instancia con caché por parada. `data` es network.json.
  function create(data, opts = {}) {
    const cache = new Map(); // "proxy|muni:stop" -> { at, value }
    const inflight = new Map();
    const f = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);

    async function getBoard(base, si, signal) {
      const st = data.stops[si];
      const muni = st && String(st[5] || "");
      const stop = st && String(st[4] || "");
      if (!muni || !stop) throw new Error("parada sin tiempo real");
      const key = `${base}|${muni}:${stop}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < TTL) return hit.value;
      if (inflight.has(key)) return inflight.get(key);
      if (!f) throw new Error("sin fetch");

      const p = (async () => {
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeout || 12000) : null;
        const onAbort = () => { if (ctrl) ctrl.abort(); };
        if (signal && ctrl) {
          if (signal.aborted) ctrl.abort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
        try {
          const r = await f(`${base}/board?muni=${encodeURIComponent(muni)}&stop=${encodeURIComponent(stop)}`, {
            headers: { Accept: "text/html" }, cache: "no-store", signal: ctrl ? ctrl.signal : undefined,
          });
          const nowTs = Date.now();
          if (!r.ok) throw new Error(`proxy ${r.status}`);
          const html = await r.text();
          const ts = Number(r.headers.get("X-RT-Time")) || nowTs;
          const srv = Number(r.headers.get("X-RT-Now")) || nowTs;
          return { rows: parseBillboard(html), ts, nowTs: srv, atMin: madridMin(ts) };
        } finally {
          if (timer) clearTimeout(timer);
          if (signal && ctrl) signal.removeEventListener("abort", onAbort);
        }
      })();

      inflight.set(key, p);
      try {
        const value = await p;
        cache.set(key, { at: Date.now(), value });
        return value;
      } finally {
        inflight.delete(key);
      }
    }

    // Datos en vivo de un tramo: `leg` = { trip, i, j, shift } (formato de search.js).
    async function live(leg, o = {}) {
      const nowFn = typeof o.now === "function" ? o.now : () => (o.now == null ? Date.now() : o.now);
      const date = o.date || madridDate(nowFn());
      if (date !== madridDate(nowFn())) return { ok: false, reason: "solo-hoy" };

      const t = data.trips[leg.trip];
      if (!t) return { ok: false, reason: "sin-datos" };
      const n = t[3].length, end = n - 1;
      const from = data.stops[t[3][leg.i]];
      if (!from || !from[5]) return { ok: false, reason: "sin-datos" };

      const base = clean(o.proxy == null ? getProxy() : o.proxy);
      if (!base) return { ok: false, reason: "sin-proxy" };

      const route = data.routes[t[0]][0];
      const headsign = t[2] || "";
      const refs = [headsign, data.routes[t[0]][1] || ""];
      for (let p = Math.max(0, end - 3); p <= end; p++) {
        refs.push(data.stops[t[3][p]][0]);
        refs.push(data.munis[data.stops[t[3][p]][1]]);
      }

      const at = (p) => t[4][p] + (leg.shift || 0); // llegada programada a la parada
      const start = at(0), finish = at(end), dur = finish - start;

      let bI;
      try {
        bI = await getBoard(base, t[3][leg.i], o.signal);
      } catch (e) {
        return { ok: false, reason: "error", message: e && e.message ? e.message : "no responde" };
      }

      const nowMin = bI.atMin;
      const relNow = diff(nowMin, start);
      if (relNow < -1) {
        return {
          ok: true, source: "horario", updatedAt: bI.ts, estimated: true, notStarted: true,
          eta: diff(at(leg.i), nowMin), etaClock: clockAt(bI.nowTs + diff(at(leg.i), nowMin) * 60000),
          delay: null, occupancy: null, progress: 0, busIndex: start, passed: false, atStop: false,
        };
      }
      if (relNow > dur + 90) {
        return {
          ok: true, source: "horario", updatedAt: bI.ts, estimated: true, finished: true,
          eta: null, etaClock: null, delay: null, occupancy: null, progress: 1, busIndex: end,
          passed: true, atStop: false,
        };
      }

      const rowI = matchRow(bI.rows, route, at(leg.i), nowMin, { headsign, refs });
      const delay = rowI ? rowI.delay : 0;

      // Posición esperada según el horario + el retraso medido en la parada de subida.
      const target = nowMin - delay;
      const relTarget = mod(target - start);
      let expect = 0;
      for (let p = 0; p < n; p++) if (at(p) - start <= relTarget) expect = p;

      // Consultamos una ventana alrededor de la posición esperada y la parada de subida.
      const want = new Set([leg.i]);
      for (let p = Math.max(0, expect - 1); p <= Math.min(end, expect + 1); p++) want.add(p);
      if (want.size < 4 && expect + 2 <= end) want.add(expect + 2);
      if (want.size < 4 && expect - 2 >= 0) want.add(expect - 2);

      const boards = new Map([[leg.i, bI]]);
      await Promise.all([...want].filter((p) => p !== leg.i).map(async (p) => {
        try { boards.set(p, await getBoard(base, t[3][p], o.signal)); } catch (e) {}
      }));

      const cands = [];
      for (const [p, b] of boards) {
        if (!b.rows || !b.rows.length) continue;
        const row = p === leg.i ? rowI : matchRow(b.rows, route, at(p), b.atMin, { headsign, refs });
        if (!row) continue;
        // Si el retraso no cuadra con el de la parada de subida, probablemente sea otro bus.
        if (rowI && p !== leg.i && Math.abs(row.delay - rowI.delay) > DELAY_TOL) continue;
        const eta = (b.ts + row.minutes * 60000 - b.nowTs) / 60000;
        cands.push({ p, b, row, eta, delay: row.delay });
      }

      const upcoming = cands.filter((c) => c.eta >= -0.6).sort((a, b) => a.eta - b.eta);
      let next = upcoming[0] || null;
      let prevIdx, nextIdx, frac, atStop = false, estimated = !next;

      if (next) {
        nextIdx = next.p;
        prevIdx = Math.max(0, nextIdx - 1);
        const segDur = Math.max(1, at(nextIdx) - at(prevIdx));
        frac = next.eta <= 0.6 ? 1 : clamp(1 - next.eta / segDur, 0, 1);
        atStop = next.eta <= 0.6;
      } else {
        // Sin confirmación en el tablero: posición teórica según horario + retraso.
        prevIdx = clamp(expect, 0, end);
        nextIdx = Math.min(end, prevIdx + 1);
        const segDur = Math.max(1, at(nextIdx) - at(prevIdx));
        frac = clamp((relTarget - (at(prevIdx) - start)) / segDur, 0, 1);
        next = null;
      }

      const busIndex = prevIdx + frac;
      const span = Math.max(1, leg.j - leg.i);
      const progress = clamp((busIndex - leg.i) / span, 0, 1);

      let etaI = null;
      if (rowI) etaI = (bI.ts + rowI.minutes * 60000 - bI.nowTs) / 60000;
      else etaI = delay + diff(at(leg.i), nowMin);

      const passed = etaI != null && etaI < -0.6;
      const atI = etaI != null && etaI <= 0.6 && etaI >= -0.6;
      const liveDelay = rowI ? rowI.delay : (cands.length ? cands[0].delay : null);
      const occ = rowI ? rowI.occ : (next ? next.row.occ : (cands[0] ? cands[0].row.occ : null));

      const stopRef = (p) => p == null ? null : {
        index: p,
        name: data.stops[t[3][p]][0],
        muni: data.munis[data.stops[t[3][p]][1]],
      };

      return {
        ok: true,
        source: rowI || cands.length ? "vivo" : "horario",
        estimated,
        updatedAt: bI.ts,
        eta: etaI,
        etaClock: etaI != null ? clockAt(bI.nowTs + etaI * 60000) : null,
        passed,
        atStop: atI,
        notStarted: false,
        finished: false,
        delay: liveDelay,
        occupancy: occ,
        line: route,
        direction: rowI ? rowI.dir : (next ? next.row.dir : ""),
        nextIndex: nextIdx,
        nextEta: next ? Math.max(0, next.eta) : Math.max(0, diff(at(nextIdx), nowMin)),
        next: stopRef(nextIdx),
        segFrom: stopRef(prevIdx),
        segTo: stopRef(nextIdx),
        busIndex,
        progress,
      };
    }

    return { live, parseBillboard, matchRow, getBoard, active: available };
  }

  return {
    create, parseBillboard, matchRow, diff, mod, madridMin, madridDate, clockAt, today,
    getProxy, setProxy, available, check,
    TTL, TOL,
  };
});
