const assert = require("node:assert");
const fs = require("node:fs");
const LB = require("../web/search.js");
const data = JSON.parse(fs.readFileSync(__dirname + "/../web/data/network.json", "utf8"));
const eng = LB.create(data);
const m = (n) => data.munis.indexOf(n);
const f = (x) => LB.fmt(x).text;
const show = (r) => r.legs.map((l) => `${eng.line(l.route).name} ${f(l.dep)}→${f(l.arr)}`).join(" + ");

// Donostia → Irun, viernes laborable: debe haber directos, ordenados, con duración coherente
let t0 = Date.now();
let r = eng.search({ origin: m("Donostia"), dest: m("Irun"), date: "2026-10-30" });
console.log("Donostia→Irun", r.direct.length, "directos", r.transfer.length, "trasbordos", Date.now() - t0, "ms");
assert(r.direct.length > 30);
for (let i = 1; i < r.direct.length; i++) assert(r.direct[i].dep >= r.direct[i - 1].dep);
assert(r.direct.every((x) => x.dur > 0 && x.dur < 120));
console.log(" primero:", show(r.direct[0]), "| último:", show(r.direct.at(-1)));

// Sentido inverso también
r = eng.search({ origin: m("Irun"), dest: m("Donostia"), date: "2026-10-30" });
assert(r.direct.length > 30);

// Eibar → Tolosa: sin directo, debe salir con trasbordo
t0 = Date.now();
r = eng.search({ origin: m("Eibar"), dest: m("Tolosa"), date: "2026-10-30" });
console.log("Eibar→Tolosa", r.direct.length, "directos", r.transfer.length, "trasbordos", Date.now() - t0, "ms");
r.transfer.slice(0, 3).forEach((x) => console.log("  ", show(x), "dur", x.dur));
for (const x of r.transfer) { assert(x.legs[1].dep >= x.legs[0].arr + 3); assert(x.dur > 0); }

// Domingo vs laborable: la oferta debe cambiar
const wk = eng.search({ origin: m("Donostia"), dest: m("Zarautz"), date: "2026-10-30", transfers: false }).direct.length;
const su = eng.search({ origin: m("Donostia"), dest: m("Zarautz"), date: "2026-11-01", transfers: false }).direct.length;
console.log("Donostia→Zarautz laborable", wk, "domingo", su);
assert(wk > 0 && su > 0 && wk !== su);
// festivo = horario de domingo
const ho = eng.search({ origin: m("Donostia"), dest: m("Zarautz"), date: "2026-10-30", holiday: true, transfers: false }).direct.length;
assert.strictEqual(ho, su);
// fuera de vigencia
assert.strictEqual(eng.search({ origin: m("Donostia"), dest: m("Irun"), date: "2025-01-01" }).direct.length, 0);
console.log("OK");
