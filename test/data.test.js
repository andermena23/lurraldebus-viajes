const assert = require("node:assert");
const fs = require("node:fs");
const d = JSON.parse(fs.readFileSync(__dirname + "/../web/data/network.json", "utf8"));

// Forma de los datos que genera scripts/build_data.py y que la app da por supuesta
assert(d.trips.length > 5000 && d.stops.length > 1000 && d.munis.length > 80 && d.routes.length > 100);
assert.strictEqual(d.agencyInfo.length, d.agencies.length, "un agencyInfo por operador");
for (const a of d.agencyInfo) assert(a.validTo >= d.validFrom && a.validTo <= d.validTo, "vigencia por operador dentro del rango global");
assert(d.feedDate >= 20250101, "fecha de los feeds");
assert(d.stops.every((s) => s.length === 6 && typeof s[4] === "string" && Number.isInteger(s[5])), "stop = [nombre, muni, lat, lon, id oficial, municipio de tiempo real]");
assert(d.stops.filter((s) => s[5]).length > d.stops.length * 0.5, "la mayoría de paradas tienen tiempo real oficial");
assert(d.routes.every((r) => r.length === 5 && (r[4] === 0 || r[4] === 1)), "ruta = [código, nombre, color, operador, a demanda]");
assert(Array.isArray(d.notices) && d.notices.every((n) => n.title && n.text && Array.isArray(n.lines)), "avisos oficiales");

// Horas coherentes: en cada parada llegada <= salida, y nunca hacia atrás a lo largo del viaje
for (const t of d.trips) {
  for (let i = 0; i < t[3].length; i++) {
    assert(t[4][i] <= t[5][i], "llegada <= salida");
    if (i) assert(t[5][i - 1] <= t[4][i], "el viaje no retrocede en el tiempo");
  }
}
console.log("OK datos");
