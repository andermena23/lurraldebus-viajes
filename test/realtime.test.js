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

  await testAsync("live: sin ninguna fila a mitad de viaje no afirma nada (noData)", async () => {
    const fetch = fakeFetch({}, NOW);
    const eng = RT.create(DATA, { fetch });
    const r = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.source, "horario");
    assert.strictEqual(r.etaSource, "horario");
    assert.strictEqual(r.noData, true);
    assert.strictEqual(r.estimated, true);
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.atStop, false);
    assert.strictEqual(r.busIndex, null);
    assert.strictEqual(r.segFrom, null);
    assert.strictEqual(r.segTo, null);
    assert.strictEqual(r.progress, null);
    assert.strictEqual(Math.round(r.eta), 2); // hora programada en tu parada, solo informativa
    assert.strictEqual(r.delay, null);
    assert.strictEqual(r.occupancy, null);
  });

  await testAsync("live: sin fila en tu parada usa el retraso de las vecinas", async () => {
    const fetch = fakeFetch({
      "101": [{ line: "T1", occ: 11, min: 7 }], // A: prevista 10:08, programada 10:00 -> +8
      "102": [],
      "103": [{ line: "T1", occ: 12, min: 17 }], // C: prevista 10:18, programada 10:10 -> +8
    }, NOW);
    const eng = RT.create(DATA, { fetch });
    const r = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: NOW });
    assert.strictEqual(r.source, "vivo");
    assert.strictEqual(r.etaSource, "vecinas");
    assert.strictEqual(r.noData, undefined);
    assert.strictEqual(Math.round(r.delay), 8);
    assert.strictEqual(Math.round(r.eta), 10); // 10:03 programada + 8 min, con la hora actual 10:01
    assert.strictEqual(r.etaClock, "10:11");
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.nextIndex, 0);
  });

  await testAsync("live: con fila en tu parada la fuente es «parada»", async () => {
    const eng = RT.create(DATA, { fetch: fakeFetch({ "102": [{ line: "T1", occ: 5, min: 3 }] }, NOW) });
    const r = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: NOW });
    assert.strictEqual(r.etaSource, "parada");
  });

  // Mismo recorrido A-B-C con otros horarios (minutos desde medianoche, shift incluido por el test).
  const withTimes = (times) => ({ ...DATA, trips: [[0, 0, "Destino", [1, 2, 3], times, times, "000"]] });
  const ts = (h, m, day = 5) => Date.UTC(2026, 10, day, h - 1, m); // hora de Madrid (CET) de ese día de noviembre
  const run = (d, byStop, now, leg = { trip: 0, i: 1, j: 2, shift: 0 }) =>
    RT.create(d, { fetch: fakeFetch(byStop, now) }).live(leg, { date: "2026-11-05", proxy: base, now });

  await testAsync("live: vecinas incoherentes entre sí (otro bus) -> noData, sin ETA ni posición", async () => {
    // Subes en B (programada 10:20), son las 10:22: P1 trae el bus siguiente (+20) y P3 el tuyo (+1). No se sabe cuál es
    // el tuyo, así que no se afirma «llega en 18 min».
    const d = withTimes([615, 620, 625]);
    const r = await run(d, {
      "101": [{ line: "T1", occ: 77, min: 13 }], // prevista 10:35, programada 10:15 -> +20
      "103": [{ line: "T1", occ: 11, min: 4 }], // prevista 10:26, programada 10:25 -> +1
    }, ts(10, 22));
    assert.strictEqual(r.source, "horario");
    assert.strictEqual(r.noData, true);
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.busIndex, null);
    assert.strictEqual(r.segTo, null);
    assert.strictEqual(r.delay, null);
    assert.strictEqual(r.occupancy, null);
    // coherentes (+8 y +9): sí se usan
    const ok = await run(d, {
      "101": [{ line: "T1", occ: 11, min: 1 }], // 10:23 vs 10:15 -> +8
      "103": [{ line: "T1", occ: 12, min: 12 }], // 10:34 vs 10:25 -> +9
    }, ts(10, 22));
    assert.strictEqual(ok.source, "vivo");
    assert.strictEqual(ok.etaSource, "vecinas");
    assert.strictEqual(Math.round(ok.delay), 8);
    assert.strictEqual(Math.round(ok.eta), 6); // 10:20 + 8 min, desde las 10:22
  });

  await testAsync("live: viaje sin empezar con fila adelantada (> 2 min) es otro bus -> notStarted", async () => {
    const early = NOW - 11 * 60000; // 09:50
    // B programada 10:03, fila prevista 09:58 -> -5: el bus anterior de la línea
    const r = await run(DATA, { "102": [{ line: "T1", occ: 9, min: 8 }] }, early);
    assert.strictEqual(r.notStarted, true);
    assert.strictEqual(r.source, "horario");
    assert.strictEqual(r.busIndex, null);
    assert.strictEqual(r.segFrom, null);
    assert.strictEqual(r.progress, null);
    // -2 sí vale
    const ok = await run(DATA, { "102": [{ line: "T1", occ: 9, min: 11 }] }, early); // 10:01 vs 10:03
    assert.strictEqual(ok.source, "vivo");
    assert.strictEqual(Math.round(ok.delay), -2);
  });

  await testAsync("live: antes de la salida con fila en tu parada da ETA pero ninguna posición", async () => {
    const early = NOW - 11 * 60000;
    const r = await run(DATA, { "102": [{ line: "T1", occ: 9, min: 14 }] }, early);
    assert.strictEqual(r.source, "vivo");
    assert.strictEqual(r.beforeStart, true);
    assert.strictEqual(r.notStarted, false);
    assert.strictEqual(Math.round(r.eta), 14);
    assert.strictEqual(r.busIndex, null);
    assert.strictEqual(r.segFrom, null);
    assert.strictEqual(r.segTo, null);
    assert.strictEqual(r.progress, null);
    assert.strictEqual(r.passed, false);
  });

  await testAsync("live: tiempos lineales (viaje de las 21:00 a las 07:40 sin empezar; el de las 07:00 a las 20:30 terminado)", async () => {
    const eve = await run(withTimes([1260, 1263, 1270]), {}, ts(7, 40));
    assert.strictEqual(eve.notStarted, true);
    assert.ok(!eve.finished);
    assert.strictEqual(Math.round(eve.eta), 803); // 21:03 - 07:40
    assert.strictEqual(eve.busIndex, null);
    const morn = await run(withTimes([420, 423, 430]), {}, ts(20, 30));
    assert.strictEqual(morn.finished, true);
    assert.strictEqual(morn.notStarted, undefined);
  });

  await testAsync("live: cruzando la medianoche (shift -1440 y tiempos >= 1440 vistos antes de las 24:00)", async () => {
    // Viaje de ayer 23:58 / 00:01 / 00:10 visto hoy a las 00:05: shift -1440 -> -2, 1, 10
    const y = await run(withTimes([1438, 1441, 1450]), { "102": [{ line: "T1", occ: 4, min: 2 }] }, ts(0, 5), { trip: 0, i: 1, j: 2, shift: -1440 });
    assert.strictEqual(y.source, "vivo");
    assert.strictEqual(y.etaSource, "parada");
    assert.strictEqual(y.notStarted, false);
    assert.strictEqual(y.beforeStart, false);
    assert.strictEqual(Math.round(y.delay), 6); // prevista 00:07, programada 00:01
    assert.strictEqual(y.etaClock, "00:07");
    assert.strictEqual(y.passed, false);
    assert.ok(y.busIndex != null && y.busIndex <= 1);
    // sin filas: noData, no «terminado» ni «ya pasó»
    const none = await run(withTimes([1438, 1441, 1450]), {}, ts(0, 5), { trip: 0, i: 1, j: 2, shift: -1440 });
    assert.strictEqual(none.noData, true);
    assert.strictEqual(Math.round(none.eta), -4); // programada 00:01, son las 00:05 (solo informativo)
    // Viaje de hoy 23:50 / 00:05 / 00:20 (1430, 1445, 1460) visto a las 23:50
    const t = await run(withTimes([1430, 1445, 1460]), { "102": [{ line: "T1", occ: 4, min: 20 }] }, ts(23, 50));
    assert.strictEqual(t.source, "vivo");
    assert.strictEqual(Math.round(t.delay), 5); // prevista 00:10, programada 00:05
    assert.strictEqual(Math.round(t.eta), 20);
    assert.strictEqual(t.etaClock, "00:10");
    // y pasada la medianoche ya no es «hoy»
    const next = await RT.create(withTimes([1430, 1445, 1460]), { fetch: fakeFetch({}, ts(0, 10, 6)) })
      .live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: ts(0, 10, 6) });
    assert.deepStrictEqual([next.ok, next.reason], [false, "solo-hoy"]);
  });

  await testAsync("live: viaje sin empezar: con fila en tu parada es dato en vivo; sin ella, solo horario", async () => {
    const early = NOW - 11 * 60000; // 09:50 en Madrid, la salida es a las 10:00
    const withRow = RT.create(DATA, { fetch: fakeFetch({ "102": [{ line: "T1", occ: 9, min: 14 }] }, early) });
    const r = await withRow.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: early });
    assert.strictEqual(r.source, "vivo");
    assert.strictEqual(r.etaSource, "parada");
    assert.strictEqual(r.notStarted, false);
    assert.strictEqual(Math.round(r.delay), 1);
    assert.strictEqual(Math.round(r.eta), 14);
    assert.strictEqual(r.occupancy, 9);

    const noRow = RT.create(DATA, { fetch: fakeFetch({}, early) });
    const q = await noRow.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: early });
    assert.strictEqual(q.source, "horario");
    assert.strictEqual(q.notStarted, true);
    assert.strictEqual(q.noData, undefined);
    assert.strictEqual(Math.round(q.eta), 13); // 10:03 programada, desde las 09:50
  });

  await testAsync("live y getBoard: desfase entre el reloj del servidor y el del dispositivo", async () => {
    const eng = RT.create(DATA, { fetch: fakeFetch({}, NOW) });
    const r = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: base, now: NOW });
    assert.ok(Math.abs(r.skew - (NOW - Date.now())) < 5000);
    // sin cabeceras X-RT-*: el reloj del servidor se toma del local y el desfase es 0
    const bare = RT.create(DATA, { fetch: async () => ({ ok: true, headers: { get: () => null }, text: async () => "" }) });
    const b = await bare.getBoard(base, 1);
    assert.ok(Math.abs(b.skew) < 1000);
  });

  await testAsync("lineHasLive: solo líneas con tablero en casi todas sus paradas y no a demanda", async () => {
    const stop = (id, board) => [`P${id}`, 0, 0, 0, String(id), board ? 20001 : ""];
    const D = {
      munis: ["M"], agencies: ["Op"],
      routes: [["A", "A", "000", 0, 0], ["B", "B", "000", 0, 0], ["C", "C", "000", 0, 1], ["D", "D", "000", 0, 0], ["E", "E", "000", 0, 0]],
      stops: [stop(1, 1), stop(2, 1), stop(3, 1), stop(4, 0), stop(5, 0)],
      trips: [
        [0, 0, "", [0, 1, 2], [1, 2, 3], [1, 2, 3], "000"], // 3/3
        [1, 0, "", [0, 3, 4], [1, 2, 3], [1, 2, 3], "000"], // 1/3 (urbana: comparte alguna parada)
        [2, 0, "", [0, 1, 2], [1, 2, 3], [1, 2, 3], "000"], // 3/3 pero a demanda
        [3, 0, "", [0, 1, 2, 3, 4], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], "00000"], // 3/5 = 0,6 justo
        [4, 0, "", [0, 1, 3, 4, 4], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], "00000"], // 2/5
      ],
    };
    const eng = RT.create(D, { fetch: fakeFetch({}, NOW) });
    assert.deepStrictEqual([0, 1, 2, 3, 4].map((i) => eng.lineHasLive(i)), [true, false, false, true, false]);
    assert.strictEqual(eng.lineHasLive(99), false);
  });

  await testAsync("live: solo hoy y sin proxy", async () => {
    const eng = RT.create(DATA, { fetch: fakeFetch({}, NOW) });
    const other = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-06", proxy: base, now: NOW });
    assert.deepStrictEqual([other.ok, other.reason], [false, "solo-hoy"]);
    const none = await eng.live({ trip: 0, i: 1, j: 2, shift: 0 }, { date: "2026-11-05", proxy: "", now: NOW });
    assert.deepStrictEqual([none.ok, none.reason], [false, "sin-proxy"]);
  });

  console.log(`\n${n} pruebas correctas`);
})().catch((e) => { console.error(e); process.exit(1); });
