const assert = require("node:assert");
const fs = require("node:fs");
const F = require("../web/fares.js");
const data = JSON.parse(fs.readFileSync(__dirname + "/../web/data/network.json", "utf8"));
const fares = F.create(JSON.parse(fs.readFileSync(__dirname + "/../web/data/fares.json", "utf8")));

// Donostia–Irun: Donostialdea -> Bidasoa = 1 salto (2,90 € ocasional, 0,88 € con MUGI)
const a = fares.fare("Donostia", "Irun");
assert.strictEqual(a.jumps, 1);
assert.strictEqual(a.ocasional, 2.9);
assert.strictEqual(a.mugi, 0.88);
assert.strictEqual(F.eur(a.mugi), "0,88 €");
assert.deepStrictEqual(fares.fare("Irun", "Donostia").jumps, 1); // simétrico
assert.strictEqual(fares.fare("Irun", "Hondarribia").jumps, 0); // misma zona
assert.strictEqual(fares.fare("Lasarte-Oria", "Donostia").jumps, 0); // alias oficial "Lasarte"
assert.strictEqual(fares.fare("Donostia", "Vitoria-Gasteiz").jumps, 5);
assert.strictEqual(fares.fare("Irun", "Vitoria-Gasteiz"), null); // sin salto definido (×)

// Cobertura: casi todos los municipios con servicio tienen zona (solo aviso; los datos cambian)
const sin = data.munis.filter((mu) => fares.zoneOf(mu) == null);
if (sin.length) console.log("AVISO: municipios sin zona de tarifa:", sin.join(", "));
assert(sin.length <= 12, "demasiados municipios sin zona");
console.log("OK tarifas");
