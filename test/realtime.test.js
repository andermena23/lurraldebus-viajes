const assert = require("node:assert");
const fs = require("node:fs");
const RT = require("../web/realtime.js");

// Tablero de llegadas de lurraldebus.eus recortado a tres buses (fixture real)
const html = fs.readFileSync(__dirname + "/fixture/billboard.html", "utf8");
const rows = RT.parseBillboard(html);

assert.deepStrictEqual(rows, [
  { line: "UK01", name: "IGNALAKO KANPATUA>Hondarribia>Donostia/San Sebastian", occ: "16", dir: "Donostia/San Sebastian", minutes: 2 },
  { line: "UK09", name: "Galtzaria>Donostia/San Sebastian", occ: "-", dir: "Donostia/San Sebastian", minutes: 18 },
  { line: "UK10", name: "Donostia (Antigua)>Galtzaria", occ: "-", dir: "Donosia (Antigua)", minutes: null },
]);
const show = (rows) => rows.map((x) => `${x.line} en ${x.minutes ?? "-"} min (${x.dir})`).join(", ");
console.log("tablero:", show(rows));

// matchRow: casar con el bus previsto; tsMin = 600 (10:00)
let L = RT.matchRow(rows, "Uk01", 602, 600); // mayúsculas da igual
assert(L && L.d === 0 && L.occ === "16");
console.log("matchRow a tiempo OK:", L.d, L.dir);

// desfase positivo = retrasado: previsto 10:18, programado a las 10:13
L = RT.matchRow(rows, "UK09", 613, 600);
assert(L && L.d === 5);
console.log("matchRow desfase +5 min OK");

// adelantado: previsto 10:18, programado a las 10:23
L = RT.matchRow(rows, "UK09", 623, 600);
assert(L && L.d === -5);
console.log("matchRow desfase -5 min OK");

// medianoche: ahora son las 00:05, el bus llega en 2 min (00:07) y el
// horario programado sali?a a las 23:55 son 12 minutos de retraso
L = RT.matchRow([{ line: "N1", minutes: 2 }], "N1", 1435, 5);
assert(L && L.d === 12);
console.log("matchRow cruce de medianoche OK");

// línea distinta o sin previsión: sin casar
assert(!RT.matchRow(rows, "E21", 602, 600));
assert(!RT.matchRow(rows.filter((r) => r.minutes == null), "UK10", 600, 600));
console.log("matchRow sin resultado OK");

// diff: desvío circular; 1439 vs 0 es -1 (el 00:00 va un minuto después del 23:59)
assert.strictEqual(RT.diff(601, 600), 1);
assert.strictEqual(RT.diff(600, 601), -1);
assert.strictEqual(RT.diff(1439, 0), -1);
console.log("diff OK");

// integración: network.json lleva los códigos de la última build de datos
const data = JSON.parse(fs.readFileSync(__dirname + "/../web/data/network.json", "utf8"));
if (data.rt) {
  const inst = RT.create(data);
  const n = Object.keys(data.rt).length;
  let ok = 0;
  for (const k in data.rt) if (inst.code(Number(k))) ok++;
  console.log(`network.json: ${n} paradas con código de tiempo real (${ok} legibles)`);
  assert.strictEqual(ok, n);
  assert(!inst.active(), "sin URL base debe estar inactivo");
}
console.log("OK");
