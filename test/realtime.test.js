#!/usr/bin/env node
/* Tests del motor de tiempo real (web/realtime.js). Ejecutar: node test/realtime.test.js */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const RT = require("../web/realtime.js");

let n = 0;
function test(name, fn) {
  try { fn(); n++; console.log(`ok ${n} - ${name}`); }
  catch (e) { console.error(`not ok - ${name}`); throw e; }
}
async function testAsync(name, fn) {
  try { await fn(); n++; console.log(`ok ${n} - ${name}`); }
  catch (e) { console.error(`not ok - ${name}`); throw e; }
}

const fixture = fs.readFileSync(path.join(__dirname, "fixture", "billboard.html"), "utf8");

test("parsea el tablero oficial", () => {
  const rows = RT.parseBillboard(fixture);
  assert.strictEqual(rows.length, 4);
  assert.deepStrictEqual(rows[0], {
    line: "UK01", name: "IGNALAKO KANPATUA>Hondarribia>Donostia/San Sebastian",
    occ: 16, dir: "Donostia/San Sebastian", minutes: 2,
  });
  assert.strictEqual(rows[1].occ, null);
  assert.strictEqual(rows[2].minutes, null);
  assert.strictEqual(rows[3].occ, 47);
});

test("mod y diff cruzan la medianoche", () => {
  assert.strictEqual(RT.mod(-1), 1439);
  assert.strictEqual(RT.mod(1445), 5);
  assert.strictEqual(RT.diff(5, 1439), 6);
  assert.strictEqual(RT.diff(1439, 5), -6);
});

test("madridMin y clockAt usan la hora de Madrid", () => {
  const ts = Date.UTC(2026, 10, 5, 9, 0); // 10:00 en Madrid (CET)
  assert.strictEqual(RT.madridMin(ts), 600);
  assert.strictEqual(RT.clockAt(ts), "10:00");
  assert.strictEqual(RT.madridDate(ts), "2026-11-05");
});

test("casa la fila por línea y hora prevista", () => {
  const rows = RT.parseBillboard(fixture);
  const row = RT.matchRow(rows, "UK01", 600, 600, { refs: ["Donostia/San Sebastian"] });
  assert.ok(row);
  assert.strictEqual(row.minutes, 2);
  assert.strictEqual(row.delay, 2);
  assert.strictEqual(row.occ, 16);
});

test("no casa una línea distinta ni una previsión sin minutos", () => {
  const rows = RT.parseBillboard(fixture);
  assert.strictEqual(RT.matchRow(rows, "UK99", 600, 600), null);
  assert.strictEqual(RT.matchRow(rows, "UK10", 600, 600), null);
});

test("detecta retraso y adelanto", () => {
  const rows = RT.parseBillboard(fixture);
  const late = RT.matchRow(rows, "UK01", 590, 600); // prevista 10:02, programada 9:50
  assert.strictEqual(late.delay, 12);
  const early = RT.matchRow(rows, "UK01", 610, 600); // prevista 10:02, programada 10:10
  assert.strictEqual(early.delay, -8);
});

test("no confunde el siguiente bus de la misma línea", () => {
  const rows = RT.parseBillboard(fixture);
  const row = RT.matchRow(rows, "UK01", 630, 600); // el de 35 min, no el de 2
  assert.strictEqual(row.minutes, 35);
  assert.strictEqual(row.delay, 5);
});

test("cruza la medianoche al casar", () => {
  const rows = RT.parseBillboard(fixture);
  const row = RT.matchRow(rows, "UK01", 0, 1438); // 23:58 + 2 min = 00:00
  assert.strictEqual(row.minutes, 2);
  assert.strictEqual(row.delay, 0);
});

test("agoText resume la frescura del tablero", () => {
  const now = Date.UTC(2026, 10, 5, 10, 0);
  assert.strictEqual(RT.agoText(now - 3000, now), "ahora mismo");
  assert.strictEqual(RT.agoText(now - 25000, now), "hace 25 s");
  assert.strictEqual(RT.agoText(now - 125000, now), "hace 2 min");
  assert.strictEqual(RT.agoText(now - 3600000, now), "hace 1 h");
  assert.strictEqual(RT.agoText(null, now), "");
});

test("occInfo etiqueta la ocupación oficial", () => {
  assert.deepStrictEqual(RT.occInfo(12), { pct: 12, label: "libre", level: "low" });
  assert.deepStrictEqual(RT.occInfo(50), { pct: 50, label: "normal", level: "mid" });
  assert.deepStrictEqual(RT.occInfo(88), { pct: 88, label: "lleno", level: "high" });
  assert.strictEqual(RT.occInfo(null), null);
  assert.strictEqual(RT.occInfo("-"), null);
});

test("positionText no repite la parada ni el municipio", () => {
  const a = { index: 2, name: "Parada A", muni: "Irun" };
  const b = { index: 3, name: "Parada B", muni: "Irun" };
  assert.strictEqual(RT.positionText(a, a, true), "Ahora en Parada A · Irun");
  assert.strictEqual(RT.positionText(a, a, false), "Ahora en Parada A · Irun");
  assert.strictEqual(RT.positionText(a, b, false), "Entre Parada A y Parada B · Irun");
  assert.strictEqual(RT.positionText(a, { ...b, muni: "Hondarribia" }, false),
    "Entre Parada A (Irun) y Parada B (Hondarribia)");
  assert.strictEqual(RT.positionText(a, null, false), "");
});

// ---- instancia con fetch simulado -----------------------------------------
const NOW = Date.UTC(2026, 10, 5, 9, 1); // 10:01 en Madrid
const DATA = {
  munis: ["Origen", "Destino"],
  agencies: ["Operador"],
  routes: [["T1", "T1 - Origen>Destino", "00a0ae", 0, 0]],
  stops: [
    ["Parada Z", 0, 0, 0, "100", 20001],
    ["Parada A", 0, 0, 0, "101", 20001],
    ["Parada B", 0, 0, 0, "102", 20001],
    ["Parada C", 1, 0, 0, "103", 20002],
  ],
  trips: [[0, 0, "Destino", [1, 2, 3], [600, 603, 610], [600, 603, 610], "000"]],
};

function fakeBoard(rows, ts) {
  const html = `<table>${rows.map((r) => `<tr><td class="live-line-left"><p class="line-number">${r.line}</p></td>
    <td></td><td><p class="line-name">T1 - Origen>Destino</p></td>
    <td><p class="line-direction"><span>${r.occ == null ? "-" : r.occ}</span></p></td>
    <td class="line-direction">Destino</td>
    <td class="live-line-time"><p><span>${r.min == null ? "&mdash;" : `${String(r.min).padStart(2, "0")} min`}</span></p></td></tr>`).join("")}</table>`;
  return {
    ok: true,
    headers: { get: (k) => (k === "X-RT-Time" || k === "X-RT-Now" ? String(ts) : null) },
    text: async () => html,
  };
}

function fakeFetch(byStop, ts) {
  return async (url) => {
    const stop = new URL(url).searchParams.get("stop");
    return fakeBoard(byStop[stop] || [], ts);
  };
}

const base = "https://proxy.test";

(async () => {
  await testAsync("live: ETA, retraso y ocupación en la parada de subida", async () => {
    const fetch = fakeFetch({
      "101": [], // el bus ya salió de A
      "102": [{ line: "T1", occ: 16, min: 3 }],
      "103": [{ line: "T1", occ: 20, min: 9 }],
    }, NOW);
    const eng = RT.create(DATA, { fetch });
    const r = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.source, "vivo");
    assert.strictEqual(Math.round(r.eta), 3);
    assert.strictEqual(r.etaClock, "10:04");
    assert.strictEqual(Math.round(r.delay), 1);
    assert.strictEqual(r.occupancy, 16);
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.nextIndex, 1);
    assert.strictEqual(r.segFrom.name, "Parada A");
    assert.strictEqual(r.segTo.name, "Parada B");
    assert.strictEqual(r.progress, 0);
  });

  await testAsync("live: detecta que el bus ya pasó tu parada", async () => {
    const later = NOW + 4 * 60000; // 10:05
    const fetch = fakeFetch({
      "101": [],
      "102": [], // ya pasó B
      "103": [{ line: "T1", occ: 22, min: 5 }],
    }, later);
    const eng = RT.create(DATA, { fetch });
    const r = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: later });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.passed, true);
    assert.strictEqual(r.nextIndex, 2);
    assert.strictEqual(r.occupancy, 22);
  });

  await testAsync("live: sin datos del tablero cae al horario y lo marca", async () => {
    const fetch = fakeFetch({}, NOW);
    const eng = RT.create(DATA, { fetch });
    const r = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.source, "horario");
    assert.strictEqual(r.estimated, true);
    assert.strictEqual(Math.round(r.eta), 2);
    assert.strictEqual(r.delay, null);
    assert.strictEqual(r.occupancy, null);
  });

  await testAsync("live: solo hoy y sin proxy", async () => {
    const eng = RT.create(DATA, { fetch: fakeFetch({}, NOW) });
    const other = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-06", proxy: base, now: NOW });
    assert.deepStrictEqual([other.ok, other.reason], [false, "solo-hoy"]);
    const none = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: "", now: NOW });
    assert.deepStrictEqual([none.ok, none.reason], [false, "sin-proxy"]);
  });

  console.log(`\n${n} pruebas correctas`);
})().catch(() => process.exit(1));
