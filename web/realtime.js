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

  // Texto de frescura del tablero: «ahora mismo», «hace 20 s», «hace 2 min».
  function agoText(updatedAt, now) {
    if (!updatedAt) return "";
    const s = Math.max(0, Math.round(((now == null ? Date.now() : now) - updatedAt) / 1000));
    if (s < 10) return "ahora mismo";
    if (s < 60) return `hace ${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `hace ${m} min`;
    return `hace ${Math.round(m / 60)} h`;
  }

  // Ocupación oficial (porcentaje) con una etiqueta cualitativa.
  function occInfo(n) {
    if (n == null || !isFinite(n)) return null;
    const pct = clamp(Math.round(n), 0, 100);
    const label = pct < 30 ? "libre" : pct < 70 ? "normal" : "lleno";
    return { pct, label, level: pct < 30 ? "low" : pct < 70 ? "mid" : "high" };
  }

  // Dónde va el bus, sin repetir el municipio ni la parada cuando coinciden.
  function positionText(from, to, atStop) {
    if (!to) return "";
    if (atStop || !from || (from.index != null && from.index === to.index))
      return `Ahora en ${to.name}${to.muni ? ` · ${to.muni}` : ""}`;
    if (from.muni === to.muni) return `Entre ${from.name} y ${to.name} · ${to.muni}`;
    return `Entre ${from.name} (${from.muni}) y ${to.name} (${to.muni})`;
  }

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
      if (opts.minDelay != null && delay < opts.minDelay) continue;
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

    // Fracción de paradas-visita con tablero oficial, por ruta. Una línea solo merece panel en vivo si casi todas sus paradas lo
    // tienen: las urbanas (Irunbus, Lasarte-Oria urbano, Oñati Herribusa) comparten algunas paradas con tablero, pero sus autobuses
    // no aparecen en él, y el panel acabaría sin datos. Las de Pesa al aeropuerto (DO04, DG05D) rondan 0,67-0,69.
    const MIN_BOARD_SHARE = 0.6;
    const share = data.routes.map(() => [0, 0]); // [con tablero, total]
    for (const t of data.trips) {
      const c = share[t[0]];
      for (const si of t[3]) { c[1]++; if (data.stops[si][5]) c[0]++; }
    }
    const lineHasLive = (ri) => {
      const c = share[ri], r = data.routes[ri];
      return !!c && !!r && r[4] !== 1 && c[1] > 0 && c[0] / c[1] >= MIN_BOARD_SHARE;
    };

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
          // skew: desfase reloj del servidor - reloj del dispositivo al recibir la respuesta (0 si falta la cabecera, porque entonces
          // srv cae al reloj local). Sirve para comparar `ts` (hora del servidor) con Date.now() sin fiarse del reloj del móvil.
          return { rows: parseBillboard(html), ts, nowTs: srv, atMin: madridMin(ts), skew: srv - nowTs };
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
      // Todo el cálculo de tiempos es lineal sobre minutos del día de hoy en Madrid (nowMin de 0 a 1439) y los horarios del
      // viaje (at() ya incluye shift: ayer cruzando medianoche da valores negativos o de 0 a pocas decenas, hoy puede pasar de 1440).
      // Límite asumido: un viaje de hoy con tiempos >= 1440 consultado pasada la medianoche ya no es «hoy», y se queda en
      // «solo-hoy». El mismo viaje aparecería entonces como viaje de ayer (shift -1440) al buscar la nueva fecha.

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
      const relNow = nowMin - start; // lineal, no circular: un viaje de las 21:00 visto a las 07:40 está sin empezar, no «terminado»
      const skew = bI.skew || 0;
      const stopRef = (p) => p == null ? null : {
        index: p,
        name: data.stops[t[3][p]][0],
        muni: data.munis[data.stops[t[3][p]][1]],
      };

      if (relNow > dur + 90) {
        return {
          ok: true, source: "horario", etaSource: "horario", updatedAt: bI.ts, skew, estimated: true, finished: true,
          eta: null, etaClock: null, delay: null, occupancy: null, progress: 1, busIndex: end,
          passed: true, atStop: false,
        };
      }

      // La fila del tablero en la parada de subida decide si hay dato en vivo, también antes de la salida. Un bus que aún no ha
      // salido no puede ir adelantado: con más de 2 min de adelanto la fila es de otro servicio (el anterior de la línea) y se ignora.
      const beforeStart = relNow < -1;
      // minDelay descarta esas filas antes de elegir, para que otra fila válida (el bus correcto) pueda ganar.
      const rowI = matchRow(bI.rows, route, at(leg.i), nowMin, { headsign, refs, minDelay: beforeStart ? -2 : null });

      if (beforeStart && !rowI) {
        // Sin fila: lo único que hay es el horario (cuenta atrás programada, no es dato en vivo ni hay posición).
        const sched = at(leg.i) - nowMin;
        return {
          ok: true, source: "horario", etaSource: "horario", updatedAt: bI.ts, skew, estimated: true, notStarted: true,
          eta: sched, etaClock: clockAt(bI.nowTs + sched * 60000),
          delay: null, occupancy: null, progress: null, busIndex: null, segFrom: null, segTo: null, passed: false, atStop: false,
        };
      }

      // Posición esperada según el horario + el retraso medido (antes de la salida, relTarget < 0 y expect = 0).
      const timeline = (d) => {
        const relTarget = nowMin - d - start;
        let expect = 0;
        for (let p = 0; p < n; p++) if (at(p) - start <= relTarget) expect = p;
        return { relTarget, expect };
      };
      let delay = rowI ? rowI.delay : 0;
      let { relTarget, expect } = timeline(delay);

      // Consultamos una ventana alrededor de la posición esperada y la parada de subida.
      const want = new Set([leg.i]);
      for (let p = Math.max(0, expect - 1); p <= Math.min(end, expect + 1); p++) want.add(p);
      if (want.size < 4 && expect + 2 <= end) want.add(expect + 2);
      if (want.size < 4 && expect - 2 >= 0) want.add(expect - 2);

      const boards = new Map([[leg.i, bI]]);
      await Promise.all([...want].filter((p) => p !== leg.i).map(async (p) => {
        try { boards.set(p, await getBoard(base, t[3][p], o.signal)); } catch (e) {}
      }));

      // Filas casadas en las paradas vecinas.
      let near = [];
      for (const [p, b] of boards) {
        if (p === leg.i || !b.rows || !b.rows.length) continue;
        const row = matchRow(b.rows, route, at(p), b.atMin, { headsign, refs });
        if (row) near.push({ p, b, row });
      }
      let etaSource = rowI ? "parada" : "horario";
      if (rowI) {
        // Si el retraso no cuadra con el de la parada de subida, probablemente sea otro bus.
        near = near.filter((c) => Math.abs(c.row.delay - rowI.delay) <= DELAY_TOL);
      } else if (near.length) {
        // Sin fila en tu parada no hay retraso de referencia: nos quedamos con el de la parada más cercana a la de subida
        // (a igual distancia, la anterior).
        const ref = near.reduce((a, c) => {
          const da = Math.abs(a.p - leg.i), dc = Math.abs(c.p - leg.i);
          return dc < da || (dc === da && c.p < a.p) ? c : a;
        });
        // Si las vecinas no cuadran entre sí (retrasos que difieren más de DELAY_TOL) son autobuses distintos y no sabemos
        // cuál es el tuyo: no se afirma ETA ni posición (queda noData).
        const delays = near.map((c) => c.row.delay);
        if (Math.max(...delays) - Math.min(...delays) > DELAY_TOL) {
          near = [];
        } else {
          delay = ref.row.delay;
          etaSource = "vecinas";
          ({ relTarget, expect } = timeline(delay));
        }
      }

      const cands = [];
      if (rowI) cands.push({ p: leg.i, row: rowI, eta: (bI.ts + rowI.minutes * 60000 - bI.nowTs) / 60000, delay: rowI.delay });
      for (const { p, b, row } of near) cands.push({ p, row, eta: (b.ts + row.minutes * 60000 - b.nowTs) / 60000, delay: row.delay });

      // Ni fila en tu parada ni en las vecinas: no sabemos nada del bus. No se afirma que haya pasado ni dónde está;
      // el horario solo se enseña como horario.
      if (!cands.length) {
        const sched = at(leg.i) - nowMin;
        return {
          ok: true, source: "horario", etaSource: "horario", noData: true, estimated: true, updatedAt: bI.ts, skew,
          eta: sched, etaClock: clockAt(bI.nowTs + sched * 60000),
          passed: false, atStop: false, notStarted: false, finished: false,
          delay: null, occupancy: null, line: route, direction: "",
          nextIndex: null, nextEta: null, next: null, segFrom: null, segTo: null, busIndex: null, progress: null,
        };
      }

      const upcoming = cands.filter((c) => c.eta >= -0.6).sort((a, b) => a.eta - b.eta);
      let next = upcoming[0] || null;
      let prevIdx, nextIdx, frac, estimated = !next;

      if (next) {
        nextIdx = next.p;
        prevIdx = Math.max(0, nextIdx - 1);
        const segDur = Math.max(1, at(nextIdx) - at(prevIdx));
        frac = next.eta <= 0.6 ? 1 : clamp(1 - next.eta / segDur, 0, 1);
      } else {
        // Hay filas pero todas ya pasadas: posición teórica según horario + retraso.
        prevIdx = clamp(expect, 0, end);
        nextIdx = Math.min(end, prevIdx + 1);
        const segDur = Math.max(1, at(nextIdx) - at(prevIdx));
        frac = clamp((relTarget - (at(prevIdx) - start)) / segDur, 0, 1);
      }

      const busIndex = prevIdx + frac;
      const span = Math.max(1, leg.j - leg.i);
      const progress = clamp((busIndex - leg.i) / span, 0, 1);

      // Con fila en tu parada, su ETA; si no, horario + retraso de las vecinas (etaSource "vecinas").
      const etaI = rowI ? cands[0].eta : delay + (at(leg.i) - nowMin);

      const passed = etaI < -0.6;
      const atI = etaI <= 0.6 && etaI >= -0.6;
      const liveDelay = delay;
      const occ = rowI ? rowI.occ : (next ? next.row.occ : cands[0].row.occ);

      return {
        ok: true,
        source: "vivo",
        etaSource,
        estimated,
        updatedAt: bI.ts,
        skew,
        eta: etaI,
        etaClock: clockAt(bI.nowTs + etaI * 60000),
        passed,
        atStop: atI,
        notStarted: false,
        finished: false,
        delay: liveDelay,
        occupancy: occ,
        line: route,
        direction: rowI ? rowI.dir : (next ? next.row.dir : ""),
        nextIndex: nextIdx,
        nextEta: next ? Math.max(0, next.eta) : Math.max(0, at(nextIdx) - nowMin),
        next: stopRef(nextIdx),
        // Antes de la salida (con fila en tu parada) el dato es la ETA, pero no hay posición que dar.
        beforeStart,
        segFrom: beforeStart ? null : stopRef(prevIdx),
        segTo: beforeStart ? null : stopRef(nextIdx),
        busIndex: beforeStart ? null : busIndex,
        progress: beforeStart ? null : progress,
      };
    }

    return { live, parseBillboard, matchRow, getBoard, lineHasLive, active: available };
  }

  return {
    create, parseBillboard, matchRow, diff, mod, madridMin, madridDate, clockAt, today,
    getProxy, setProxy, available, check, agoText, occInfo, positionText,
    TTL, TOL,
  };
});
