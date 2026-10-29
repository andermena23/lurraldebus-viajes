/* Motor de búsqueda sobre web/data/network.json (GTFS de Lurraldebus).
 * Funciona en navegador (window.LB) y en Node (module.exports) para poder probarlo.
 * Los tiempos son minutos desde las 00:00 del día de servicio; >=1440 es "día siguiente".
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LB = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const MIN_TRANSFER = 3; // minutos mínimos para cambiar de bus
  const MAX_WALK_M = 400; // distancia máxima a pie entre paradas de trasbordo
  const WALK_M_PER_MIN = 70;

  function dist(a, b) {
    const dLat = (a[2] - b[2]) * 111320;
    const dLon = (a[3] - b[3]) * 111320 * Math.cos((a[2] * Math.PI) / 180);
    return Math.hypot(dLat, dLon);
  }

  function create(data) {
    const { stops, trips, routes, services, munis, agencies } = data;
    const stopsByMuni = munis.map(() => []);
    stops.forEach((s, i) => stopsByMuni[s[1]].push(i));
    const neighborCache = new Map();
    const activeCache = new Map();

    // paradas a pie de x (incluida ella misma), en su mismo municipio
    function neighbors(x) {
      if (!neighborCache.has(x)) {
        const out = [];
        for (const y of stopsByMuni[stops[x][1]]) {
          const d = y === x ? 0 : dist(stops[x], stops[y]);
          if (d <= MAX_WALK_M) out.push([y, d]);
        }
        neighborCache.set(x, out);
      }
      return neighborCache.get(x);
    }

    function serviceRuns(svc, dateInt, weekday, holiday) {
      const [days, start, end, added, removed] = services[svc];
      if (added.includes(dateInt)) return true;
      if (removed.includes(dateInt)) return false;
      if (dateInt < start || dateInt > end) return false;
      return ((days >> (holiday ? 6 : weekday)) & 1) === 1;
    }

    // Viajes activos en una fecha. shift=-1440 son viajes del día anterior que cruzan la medianoche.
    function activeTrips(dateStr, holiday) {
      const key = dateStr + (holiday ? "H" : "");
      if (activeCache.has(key)) return activeCache.get(key);
      const d = new Date(dateStr + "T12:00:00");
      const wd = (d.getDay() + 6) % 7; // lunes=0
      const prev = new Date(d.getTime() - 864e5);
      const toInt = (x) => x.getFullYear() * 10000 + (x.getMonth() + 1) * 100 + x.getDate();
      const runsToday = services.map((_, i) => serviceRuns(i, toInt(d), wd, holiday));
      const runsYest = services.map((_, i) => serviceRuns(i, toInt(prev), (wd + 6) % 7, false));
      const out = [];
      trips.forEach((t, ti) => {
        if (runsToday[t[1]]) out.push({ ti, shift: 0 });
        if (runsYest[t[1]] && t[4][t[4].length - 1] >= 1440) out.push({ ti, shift: -1440 });
      });
      activeCache.set(key, out);
      return out;
    }

    function stopSet(muni, stop) {
      if (stop != null && stop !== "") return new Set(String(stop).split(",").map(Number));
      return new Set(stopsByMuni[muni]);
    }

    function firstBoard(t, set, from = 0) {
      const [, , , ids, , , fl] = t;
      for (let i = from; i < ids.length - 1; i++)
        if (set.has(ids[i]) && (fl.charCodeAt(i) - 48) % 2 === 0) return i;
      return -1;
    }
    function firstAlight(t, set, after) {
      const [, , , ids, , , fl] = t;
      for (let j = after + 1; j < ids.length; j++)
        if (set.has(ids[j]) && (fl.charCodeAt(j) - 48) < 2) return j;
      return -1;
    }

    function leg(ti, shift, i, j) {
      const t = trips[ti];
      return {
        trip: ti, route: t[0], from: t[3][i], to: t[3][j], i, j, shift,
        dep: t[5][i] + shift, arr: t[4][j] + shift,
        stops: t[3].slice(i, j + 1),
      };
    }

    // Paradas con sentido para un par de municipios: donde se puede subir en el origen con un
    // bus que luego para en el destino, y donde se puede bajar en el destino. null si no hay directos.
    const pairCache = new Map();
    function pairStops(origin, dest) {
      const key = origin + ":" + dest;
      if (pairCache.has(key)) return pairCache.get(key);
      const from = new Set(), to = new Set();
      for (const t of trips) {
        const ids = t[3], fl = t[6];
        let iMin = -1, jMax = -1;
        for (let k = 0; k < ids.length; k++) {
          const m = stops[ids[k]][1], f = fl.charCodeAt(k) - 48;
          if (m === origin && f % 2 === 0 && iMin < 0) iMin = k;
          if (m === dest && f < 2) jMax = k;
        }
        if (iMin < 0 || jMax <= iMin) continue;
        for (let k = 0; k < ids.length; k++) {
          const m = stops[ids[k]][1], f = fl.charCodeAt(k) - 48;
          if (m === origin && f % 2 === 0 && k < jMax) from.add(ids[k]);
          if (m === dest && f < 2 && k > iMin) to.add(ids[k]);
        }
      }
      const r = from.size && to.size ? { from, to } : null;
      pairCache.set(key, r);
      return r;
    }

    function search({ origin, dest, originStop, destStop, date, holiday = false, transfers = true }) {
      const O = stopSet(origin, originStop);
      const D = stopSet(dest, destStop);
      const active = activeTrips(date, holiday);
      const direct = [];
      for (const { ti, shift } of active) {
        const t = trips[ti];
        const i = firstBoard(t, O);
        if (i < 0) continue;
        const j = firstAlight(t, D, i);
        if (j < 0) continue;
        const l = leg(ti, shift, i, j);
        if (l.dep < 0) continue;
        direct.push({ legs: [l], dep: l.dep, arr: l.arr, dur: l.arr - l.dep, transfers: 0 });
      }

      let viaTransfer = [];
      if (transfers && origin !== dest) viaTransfer = searchTransfers(active, O, D, direct);
      const byDep = (a, b) => a.dep - b.dep || a.arr - b.arr;
      return { direct: direct.sort(byDep), transfer: viaTransfer.sort(byDep) };
    }

    function searchTransfers(active, O, D, direct) {
      // índice de salidas de leg2: parada -> [{ti, shift, pos, dep, arr}] ordenado por salida
      const index = new Map();
      for (const { ti, shift } of active) {
        const t = trips[ti];
        const jD = firstAlight(t, D, -1);
        if (jD < 1) continue;
        for (let p = 0; p < jD; p++) {
          if ((t[6].charCodeAt(p) - 48) % 2 !== 0) continue;
          const s = t[3][p];
          if (!index.has(s)) index.set(s, []);
          index.get(s).push({ ti, shift, pos: p, jD, dep: t[5][p] + shift, arr: t[4][jD] + shift });
        }
      }
      for (const arr of index.values()) arr.sort((a, b) => a.dep - b.dep);

      const firstAtOrAfter = (arr, time) => {
        let lo = 0, hi = arr.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].dep < time) lo = m + 1; else hi = m; }
        return lo;
      };

      const bestByLeg2 = new Map(); // leg2 -> mejor leg1 (sale lo más tarde posible)
      for (const { ti, shift } of active) {
        const t = trips[ti];
        const i = firstBoard(t, O);
        if (i < 0 || t[5][i] + shift < 0) continue;
        if (firstAlight(t, D, i) >= 0) continue; // ya es directo
        let best = null;
        for (let k = i + 1; k < t[3].length; k++) {
          if ((t[6].charCodeAt(k) - 48) >= 2) continue;
          const x = t[3][k];
          if (O.has(x)) continue;
          const arrX = t[4][k] + shift;
          for (const [y, d] of neighbors(x)) {
            const list = index.get(y);
            if (!list) continue;
            const ready = arrX + MIN_TRANSFER + Math.ceil(d / WALK_M_PER_MIN);
            for (let q = firstAtOrAfter(list, ready); q < list.length; q++) {
              const c = list[q];
              if (c.ti === ti && c.shift === shift) continue;
              if (!best || c.arr < best.c.arr || (c.arr === best.c.arr && c.dep > best.c.dep))
                best = { k, c, walk: d };
              break; // la primera salida válida de esa parada es la mejor
            }
          }
        }
        if (!best) continue;
        const l1 = leg(ti, shift, i, best.k);
        const l2 = leg(best.c.ti, best.c.shift, best.c.pos, best.c.jD);
        const item = { legs: [l1, l2], dep: l1.dep, arr: l2.arr, dur: l2.arr - l1.dep,
                       transfers: 1, walk: Math.round(best.walk) };
        const key = best.c.ti + ":" + best.c.shift + ":" + best.c.pos;
        const prev = bestByLeg2.get(key);
        if (!prev || item.dep > prev.dep) bestByLeg2.set(key, item);
      }
      // descarta los trasbordos peores que un directo (sale igual o antes y llega igual o después)
      return [...bestByLeg2.values()].filter(
        (r) => !direct.some((d) => d.dep >= r.dep && d.arr <= r.arr));
    }

    return {
      data, search, pairStops, neighbors,
      muniStops: (m) => stopsByMuni[m],
      stopTime: (ti, pos) => trips[ti][5][pos],
      line: (ri) => ({ name: routes[ri][0], long: routes[ri][1], color: routes[ri][2], agency: agencies[routes[ri][3]] }),
      stopName: (si) => stops[si][0],
      stopMuni: (si) => munis[stops[si][1]],
    };
  }

  function fmt(min) {
    const d = min >= 1440 ? 1 : min < 0 ? -1 : 0;
    const m = ((min % 1440) + 1440) % 1440;
    const s = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    return { text: s, day: d };
  }

  return { create, fmt };
});
