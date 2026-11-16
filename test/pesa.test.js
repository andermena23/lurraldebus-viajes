const assert = require("node:assert");
const fs = require("node:fs");
const P = require("../web/pesa.js");
const LB = require("../web/search.js");
const data = JSON.parse(fs.readFileSync(__dirname + "/../web/data/network.json", "utf8"));
const eng = LB.create(data);
const name = (muni, stop) => { const r = P.stopFor(muni, stop); return r && r.name; };

// Emparejamiento: por nombre de parada primero (San Prudentzio es de Arrasate pero Pesa la vende aparte), luego por municipio
assert.strictEqual(name("Arrasate", "San Prudentzio"), "SAN PRUDENTZIO");
assert.strictEqual(name("Arrasate", "Zalduspe Kalea 4, Zalduspe Geltokia"), "ARRASATE-MONDRAGON");
assert.strictEqual(name("Arrasate", "Eroski (san Prudentziorantz)"), "ARRASATE-MONDRAGON"); // solo la parada exacta es San Prudentzio
assert.strictEqual(name("Ezkio-Itsaso", "Ezkio Herrigunea 4"), "EZKIO-ITXASO"); // los datos escriben "Itsaso", Pesa "ITXASO"
assert.strictEqual(name("Ullibarri-Gamboa", "A-3002 Errepidea (gasteizerantz)"), "ULLIBARRI GAMBOA");
assert.strictEqual(name("Urretxu", "Herriko Plaza"), "ZUMARRAGA-URRETXU");
assert.strictEqual(name("Zumarraga", "Geltokia"), "ZUMARRAGA-URRETXU");
assert.strictEqual(name("Lasarte-Oria", "Geltokia"), "LASARTE");
assert.strictEqual(name("Donostia", "Donostiako Autobus Geltokia"), "DONOSTIA-SAN SEBASTIAN");
assert.strictEqual(name("Loiu", "Bilboko Aireportua"), "AEROPUERTO BILBAO");
assert.strictEqual(name("Idiazabal", "Landa Barreiatua 40"), null); // "landa" dentro del nombre no es la parada Landa
assert.strictEqual(name("Legazpi", "Geltokia"), null);

// Con los datos reales: buscar desde la parada San Prudentzio sube en esa parada, y es lo que se manda a Pesa
const m = (n) => data.munis.indexOf(n);
const sp = data.stops.findIndex((_, i) => eng.stopName(i) === "San Prudentzio");
const day = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const res = eng.search({ origin: m("Arrasate"), dest: m("Bilbao"), originStop: String(sp), date: day, transfers: false });
assert(res.direct.length > 0, "debería haber directos desde San Prudentzio");
for (const r of res.direct) {
  const l = r.legs[0];
  assert.strictEqual(P.stopFor(eng.stopMuni(l.from), eng.stopName(l.from)).name, "SAN PRUDENTZIO");
  assert.strictEqual(P.stopFor(eng.stopMuni(l.to), eng.stopName(l.to)).name, "BILBAO");
}

// Regla de compra: línea con venta online, no a demanda y con dos paradas distintas en Pesa
const buy = (line, a, b, demand) => P.canBuy({ line, demand: !!demand, from: { muni: a[0], stop: a[1] }, to: { muni: b[0], stop: b[1] } });
const ok = buy("DO01", ["Donostia", "Donostiako Autobus Geltokia"], ["Bilbao", "Termibus"]);
assert.deepStrictEqual([ok.from.name, ok.to.name], ["DONOSTIA-SAN SEBASTIAN", "BILBAO"]);
assert(buy(" do01 ", ["Donostia", "Geltokia"], ["Bilbao", "Termibus"]), "la línea se compara sin mayúsculas ni espacios");
assert.strictEqual(buy("DG10", ["Arrasate", "Geltokia"], ["Bergara", "Geltokia"]), null); // comarcal: sin venta online
assert.strictEqual(buy("DG20E", ["Bergara", "Geltokia"], ["Elgeta", "Plaza"], true), null); // a demanda
assert.strictEqual(buy("DO01", ["Donostia", "Geltokia"], ["Bilbao", "Termibus"], true), null); // a demanda aunque la línea esté en la lista
assert.strictEqual(buy("DG01", ["Arrasate", "Geltokia"], ["Legazpi", "Geltokia"]), null); // línea con venta, pero Legazpi no está en Pesa
assert.strictEqual(buy("DG01", ["Zumarraga", "Geltokia"], ["Urretxu", "Herriko Plaza"]), null); // las dos caen en ZUMARRAGA-URRETXU
assert.strictEqual(buy("DG01", ["Arrasate", "Geltokia"], ["Bilbao", "Termibus"]).from.name, "ARRASATE-MONDRAGON");

// Cobertura (solo aviso: los datos cambian cada día y no debe bloquear la publicación): tramos de líneas con venta online
// para los que Pesa no tiene alguna de las paradas, y por tanto no se ofrecería el botón de compra
const pesa = data.agencies.indexOf("Pesa (Debagoiena)");
const falta = P.LINES.filter((l) => !data.routes.some((r) => r[0] === l && r[3] === pesa));
if (falta.length) console.log("AVISO: líneas de la lista de venta online que ya no existen en los datos de Pesa:", falta.join(", "));
const sin = new Set();
for (const t of data.trips) {
  const r = data.routes[t[0]];
  if (r[3] !== pesa || r[4] === 1 || !P.LINES.includes(r[0])) continue;
  for (const s of t[3]) if (!P.stopFor(eng.stopMuni(s), eng.stopName(s))) sin.add(`${r[0]}:${eng.stopMuni(s)}`);
}
if (sin.size) console.log("AVISO: paradas de líneas con venta online sin equivalente en Pesa (no se ofrece comprar desde/hacia ellas):", [...sin].join(", "));
console.log("OK pesa");
