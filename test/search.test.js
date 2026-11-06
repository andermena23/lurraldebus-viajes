const assert = require("node:assert");
const fs = require("node:fs");
const LB = require("../web/search.js");
const data = JSON.parse(fs.readFileSync(__dirname + "/../web/data/network.json", "utf8"));
const eng = LB.create(data);
const m = (n) => data.munis.indexOf(n);
const f = (x) => LB.fmt(x).text;

// Fechas de prueba relativas a la vigencia de los datos (viernes y domingo laborables/festivos),
// para que el test no caduque cuando se actualicen los feeds.
const toDate = (n) => new Date(`${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6)}T12:00:00Z`);
const base = new Date(Math.min(Math.max(Date.now(), toDate(data.validFrom)), toDate(data.validTo) - 14 * 864e5));
const nextDay = (wd) => { const d = new Date(base); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const FRI = nextDay(5), SUN = nextDay(0);
const show = (r) => r.legs.map((l) => `${eng.line(l.route).name} ${f(l.dep)}→${f(l.arr)}`).join(" + ");

// Donostia → Irun, viernes laborable: debe haber directos, ordenados, con duración coherente
let t0 = Date.now();
let r = eng.search({ origin: m("Donostia"), dest: m("Irun"), date: FRI });
console.log("Donostia→Irun", r.direct.length, "directos", r.transfer.length, "trasbordos", Date.now() - t0, "ms");
assert(r.direct.length > 30);
for (let i = 1; i < r.direct.length; i++) assert(r.direct[i].dep >= r.direct[i - 1].dep);
assert(r.direct.every((x) => x.dur > 0 && x.dur < 120));
console.log(" primero:", show(r.direct[0]), "| último:", show(r.direct.at(-1)));

// Sentido inverso también
r = eng.search({ origin: m("Irun"), dest: m("Donostia"), date: FRI });
assert(r.direct.length > 30);

// Eibar → Tolosa: sin directo, debe salir con trasbordo
t0 = Date.now();
r = eng.search({ origin: m("Eibar"), dest: m("Tolosa"), date: FRI });
console.log("Eibar→Tolosa", r.direct.length, "directos", r.transfer.length, "trasbordos", Date.now() - t0, "ms");
r.transfer.slice(0, 3).forEach((x) => console.log("  ", show(x), "dur", x.dur));
for (const x of r.transfer) { assert(x.legs[1].dep >= x.legs[0].arr + 3); assert(x.dur > 0); }

// Domingo vs laborable: la oferta debe cambiar
const wk = eng.search({ origin: m("Donostia"), dest: m("Zarautz"), date: FRI, transfers: false }).direct.length;
const su = eng.search({ origin: m("Donostia"), dest: m("Zarautz"), date: SUN, transfers: false }).direct.length;
console.log("Donostia→Zarautz laborable", wk, "domingo", su);
assert(wk > 0 && su > 0 && wk !== su);
// festivo = horario de domingo
const ho = eng.search({ origin: m("Donostia"), dest: m("Zarautz"), date: FRI, holiday: true, transfers: false }).direct.length;
assert.strictEqual(ho, su);
// fuera de vigencia
assert.strictEqual(eng.search({ origin: m("Donostia"), dest: m("Irun"), date: "2025-01-01" }).direct.length, 0);
console.log("OK");

// Líneas a demanda: 16 líneas cuyo código acaba en E, marcadas en los datos
const demand = data.routes.map((_, i) => eng.line(i)).filter((l) => l.demand);
assert(demand.length >= 10 && demand.every((l) => /\dE$/i.test(l.name)), "líneas a demanda");
assert(data.routes.every((rt, i) => eng.line(i).demand === /\dE$/i.test(rt[0])));

// Horario de una línea: cuadro por sentido, paradas fusionadas y horas crecientes en cada viaje
const uk01 = data.routes.findIndex((rt) => rt[0] === "UK01");
const day = eng.lineDay(uk01, FRI);
assert(day.length > 4, "UK01 tiene viajes un viernes");
for (let i = 1; i < day.length; i++) assert(day[i].dep >= day[i - 1].dep);
const tables = eng.lineTable(day);
assert(tables.length >= 2, "al menos dos sentidos");
for (const tb of tables) {
  assert(tb.trips.length > 0 && tb.stops.length >= 2);
  for (const c of tb.trips) {
    const ts = c.cells.filter(Boolean).map((x) => x[0]);
    assert(ts.length >= 2);
    for (let i = 1; i < ts.length; i++) assert(ts[i] >= ts[i - 1], "horas crecientes dentro de un viaje");
  }
}
console.log("líneas: UK01", day.length, "viajes en", tables.map((t) => `${t.from}→${t.to} (${t.trips.length})`).join(", "));

// Viajes que cruzan la medianoche: el festivo de la víspera cuenta
const anyHoliday = eng.search({ origin: m("Donostia"), dest: m("Irun"), date: FRI, holidayPrev: true });
assert(anyHoliday.direct.length > 0);
console.log("OK 2");

// Hora mínima sin parada elegida: un bus que ya pasó por su primera parada del municipio de origen
// sigue valiendo si todavía para en otra del mismo municipio (sube en la siguiente, con su hora).
{
  const O = m("Donostia"), Dm = m("Tolosa");
  const all = eng.search({ origin: O, dest: Dm, date: FRI, transfers: false });
  let found = null;
  for (const r of all.direct) {
    const l = r.legs[0], t = data.trips[l.trip];
    for (let k = l.i + 1; k < l.j; k++) {
      if (data.stops[t[3][k]][1] === O && (t[6].charCodeAt(k) - 48) % 2 === 0 && t[5][k] + l.shift > r.dep) { found = { r, l, t, k, dep: t[5][k] + l.shift }; break; }
    }
    if (found) break;
  }
  assert(found, "debe haber algún viaje con varias paradas en Donostia");
  const same = (a, b) => a.legs[0].trip === b.legs[0].trip && a.legs[0].shift === b.legs[0].shift;

  // pedimos una hora posterior a su primera parada y anterior (o igual) a la siguiente: sube en la siguiente
  const mid = eng.search({ origin: O, dest: Dm, date: FRI, transfers: false, from: found.dep });
  const moved = mid.direct.find((x) => same(x, found.r));
  assert(moved, "el viaje no debe desaparecer");
  assert.strictEqual(moved.legs[0].i, found.k);
  assert.strictEqual(moved.dep, found.dep);
  assert(moved.dep >= found.dep && moved.dur === moved.arr - moved.dep && moved.dur < found.r.dur);
  console.log("sube en la siguiente parada:", f(found.r.dep), "→", f(moved.dep), data.stops[found.t[3][found.k]][0]);

  // el conjunto de viajes del día no cambia (el resumen y «Comparar» usan el día completo)
  assert.strictEqual(mid.direct.length, all.direct.length);
  // sin hora mínima, todo igual que antes
  assert.deepStrictEqual(eng.search({ origin: O, dest: Dm, date: FRI, transfers: false, from: null }).direct.map((x) => x.dep), all.direct.map((x) => x.dep));
  // con una parada concreta no hay «siguiente parada»: si el bus ya pasó por ella, no vale
  const first = String(found.l.from);
  const pinned = eng.search({ origin: O, dest: Dm, originStop: first, date: FRI, transfers: false, from: found.dep });
  const p = pinned.direct.find((x) => same(x, found.r));
  assert(!p || p.dep < found.dep, "con parada elegida no se re-embarca en otra");
}
