/* Tiempo real de Lurraldebus: tablero oficial de llegadas ("kartel hervea").
 * Funciona en navegador (window.RT) y en Node (module.exports) para poder probarlo.
 *
 * Los datos llegan del proxy CORS (worker/): la web oficial no acepta llamadas del
 * navegador. El proxy devuelve el HTML del tablero macizo, que se parsea aquí en
 * el cliente; todas las paradas con código de tiempo real van ya en network.json
 * (clave "rt", generada por scripts/build_data.py).
 *
 * El tablero da los minutos que quedan para la llegada de cada bus, junto al instante
 * (ts) en que se pidió; con eso se traduce a la hora prevista del bus en la parada y
 * se compara con la del horario programado para saber si va retrasado o puntual.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const UKEY = "lb-rt-url";
  const TTL = 30000; // ms entre consultas a la misma parada
  const TOL = 12; // desvío máximo (min) para casar un bus del tablero con uno del horario

  const STRIP = /[\u0300-\u036f]/g;
  const plain = (t) => String(t || "").normalize("NFD").replace(STRIP, "").toLowerCase().trim();

  const decode = (s) => s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  // El tablero oficial es una tabla HTML: parsea cada fila a
  // { line, name, occ, dir, minutes } (occ y dir pueden venir vacíos).
  function parseBillboard(html) {
    const rows = [];
    // cada bus va en un <tr> cuyo primer <td> tiene <p class="line-number">
    for (const tr of html.split(/<tr[\s>]/i)) {
      if (!/<p class="line-number">/i.test(tr)) continue;
      const line = (tr.match(/<p class="line-number">([\s\S]*?)<\/p>/i) || [])[1];
      if (!line) continue;
      const name = (tr.match(/<p class="line-name">([\s\S]*?)<\/p>/i) || [])[1];
      const occ = (tr.match(/class="line-direction"[^>]*>\s*(?:<img[^>]*>)?\s*<span[^>]*>([^<]*)<\/span>/i) || [])[1];
      const dir = (tr.match(/<td class="line-direction">\s*([^<]*)<\/td>/i) || [])[1];
      const t = (tr.match(/class="live-line-time"[\s\S]*?<span[^>]*>([^<]*)<\/span>/i) || [])[1];
      const m = t && t.match(/\d+/);
      rows.push({
        line: decode(line),
        name: name ? decode(name) : "",
        occ: occ ? decode(occ) : "",
        dir: dir ? decode(dir) : "",
        minutes: m ? Number(m[0]) : null, // null: sin previsión ("-", "—")
      });
    }
    return rows;
  }

  // minutos de 0 a 1439 (los viajes que cruzan medianoche pueden ser negativos)
  const mod = (m) => ((m % 1440) + 1440) % 1440;
  // desvío circular más corto entre dos minutos del día
  const diff = (a, b) => { const d = mod(a - b); return d > 720 ? d - 1440 : d; };

  // ¿A cuál bus del tablero corresponde una salida del horario? Casar por número de
  // línea y por la hora prevista (tsMin en el momento de pedir el tablero + minutos).
  function matchRow(rows, line, dep, tsMin, tol = TOL) {
    const L = plain(line);
    let best = null;
    for (const r of rows) {
      if (r.minutes == null || plain(r.line) !== L) continue;
      const d = diff(tsMin + r.minutes, dep);
      if (d > tol || d < -tol) continue;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { ...r, d };
    }
    return best;
  }

  function getBase() { try { return localStorage.getItem(UKEY) || ""; } catch (e) { return ""; } }

  // Crea una instancia con estado (caché de tableros y consultas en marcha).
  // data.rt: { "<stopIdx>": "<idMunicipio>:<idParada>" } de scripts/build_data.py.
  function create(data) {
    const ref = {};
    for (const k in (data.rt || {})) {
      const [m, s] = String(data.rt[k]).split(":");
      ref[Number(k)] = { muni: m, stop: s }; // índice de parada -> id oficial
    }
    let base = getBase();
    const boards = new Map(); // stopIdx -> {ts, rows[], err}
    let inflight = new Map(); // stopIdx -> Promise

    const setBase = (url) => {
      base = String(url || "").trim().replace(/\/+$/, "");
      try { localStorage.setItem(UKEY, base); } catch (e) {}
      boards.clear();
      inflight.clear();
    };
    const active = () => !!base;

    // El tablero da "minutos hasta la llegada": se guarda el instante (ts, ms) para
    // poder calcular la hora prevista incluso minutos después.
    const fetchOne = (si) => {
      const refst = ref[si];
      return fetch(`${base}/arrivals?stop=${encodeURIComponent(refst.stop)}&muni=${encodeURIComponent(refst.muni)}`)
        .then((r) => {
          if (!r.ok) throw new Error("proxy " + r.status);
          return r.text();
        })
        .then((html) => ({ ts: Date.now(), rows: parseBillboard(html), err: null }))
        .catch((e) => ({ ts: Date.now(), rows: null, err: e.message || "error" }));
    };

    // Refresca las paradas caducadas de la lista; devuelve cuántas consultas estaban
    // en marcha (0 si todo estaba al día), para que la web vuelva a pintar al terminar.
    function pass(sis) {
      if (!active()) return Promise.resolve(0);
      const now = Date.now();
      const jobs = [];
      for (const si of sis) {
        if (!ref[si]) continue;
        const hit = boards.get(si);
        if (hit && now - hit.ts < TTL) continue;
        const f = inflight.get(si);
        if (f) { jobs.push(f); continue; }
        const p = fetchOne(si).then((board) => {
          boards.set(si, board);
          inflight.delete(si);
          return 1;
        });
        inflight.set(si, p);
        jobs.push(p);
      }
      return Promise.all(jobs).then((r) => r.reduce((a, b) => a + b, 0));
    }

    // Anotación de un resultado de búsqueda: { d, occ } con el desfase del bus
    // respecto al horario programado (positivo = retrasado) o null si no se sabe.
    function ann(r) {
      const si = r.legs[0].from;
      const refst = ref[si];
      const board = boards.get(si);
      if (!refst || !board || !board.rows) return null;
      const li = data.routes[r.legs[0].route][0];
      const at = new Date(board.ts);
      const tsMin = at.getHours() * 60 + at.getMinutes();
      // casa la hora prevista (ts + minutos del tablero) con la salida programada, ±12 min
      const row = matchRow(board.rows, li, mod(r.legs[0].dep), tsMin);
      if (!row) return null;
      // El desfase del tablero es sobre la llegada a la parada; la salida programada es
      // ~0-1 min después, así que es la mejor aproximación que hay.
      return { d: row.d, occ: row.occ, minutes: row.minutes };
    }

    return { code: (si) => (ref[si] ? ref[si].stop : null), pass, ann, active, setBase };
  }

  return { parseBillboard, matchRow, create, getBase, diff, mod, TTL, TOL };
});
