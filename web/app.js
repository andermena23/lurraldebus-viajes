(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const nowStr = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const toMin = (hhmm) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : 0);
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const clock = (min) => { const f = LB.fmt(min); return f.text + (f.day ? `<sup>${f.day > 0 ? "+1" : "−1"}</sup>` : ""); };
  const clockText = (min) => LB.fmt(min).text;
  const dmy = (n) => `${String(n).slice(6)}/${String(n).slice(4, 6)}/${String(n).slice(0, 4)}`;

  let eng, data;
  const state = { sort: "dep", line: null };
  const out = $("out");

  fetch("data/network.json")
    .then((r) => r.json())
    .then(init)
    .catch((e) => { out.innerHTML = `<p class="notice">No se pudieron cargar los datos (${esc(e.message)}). Si abres el archivo directamente, sírvelo con un servidor: <code>python3 -m http.server -d web</code>.</p>`; });

  function init(d) {
    data = d;
    eng = LB.create(d);
    const order = d.munis.map((_, i) => i).sort((a, b) => d.munis[a].localeCompare(d.munis[b], "es"));
    const opts = order.map((i) => `<option value="${i}">${esc(d.munis[i])}</option>`).join("");
    $("o").innerHTML = opts;
    $("d").innerHTML = opts;
    $("validity").textContent =
      `${d.agencies.length} operadores · ${d.trips.length.toLocaleString("es")} servicios · horarios vigentes ${dmy(d.validFrom)} – ${dmy(d.validTo)}`;

    const p = new URLSearchParams(location.hash.slice(1));
    const byName = (n, dflt) => { const i = d.munis.indexOf(n); return i >= 0 ? i : d.munis.indexOf(dflt); };
    $("o").value = byName(p.get("o"), "Donostia");
    $("d").value = byName(p.get("d"), "Irun");
    fillStops("os", $("o").value, p.get("os"));
    fillStops("ds", $("d").value, p.get("ds"));
    $("date").value = p.get("date") || todayStr();
    $("time").value = p.has("time") ? p.get("time") : $("date").value === todayStr() ? nowStr() : "";
    $("holiday").checked = p.get("h") === "1";
    $("transfers").checked = p.get("t") !== "0";

    $("o").addEventListener("change", () => { fillStops("os", $("o").value); run(); });
    $("d").addEventListener("change", () => { fillStops("ds", $("d").value); run(); });
    $("os").addEventListener("change", run);
    $("ds").addEventListener("change", run);
    $("date").addEventListener("change", () => { $("time").value = $("date").value === todayStr() ? nowStr() : ""; run(); });
    for (const id of ["time", "holiday", "transfers"]) $(id).addEventListener("change", run);
    $("now").addEventListener("click", () => { $("date").value = todayStr(); $("time").value = nowStr(); run(); });
    $("allday").addEventListener("click", () => { $("time").value = ""; run(); });
    $("swap").addEventListener("click", () => {
      const [o, os] = [$("o").value, $("os").value];
      $("o").value = $("d").value; fillStops("os", $("o").value, $("ds").value);
      $("d").value = o; fillStops("ds", $("d").value, os);
      run();
    });
    $("form").addEventListener("submit", (e) => { e.preventDefault(); run(); });
    out.addEventListener("click", onClick);
    run();
  }

  // Paradas del municipio agrupadas por nombre (varias paradas físicas pueden compartir nombre).
  function fillStops(selId, muni, keep) {
    const groups = new Map();
    for (const si of eng.muniStops(Number(muni))) {
      const n = eng.stopName(si);
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(si);
    }
    const names = [...groups.keys()].sort((a, b) => a.localeCompare(b, "es"));
    const sel = $(selId);
    sel.innerHTML = `<option value="">Cualquier parada (${names.length})</option>` +
      names.map((n) => `<option value="${groups.get(n).join(",")}">${esc(n)}</option>`).join("");
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }

  function onClick(e) {
    const sortBtn = e.target.closest("[data-sort]");
    if (sortBtn) { state.sort = sortBtn.dataset.sort; return render(); }
    const row = e.target.closest("tr[data-line]");
    if (row) { state.line = state.line === row.dataset.line ? null : row.dataset.line; return render(); }
    if (e.target.closest("[data-clear]")) { state.line = null; render(); }
    if (e.target.closest("[data-allday]")) $("allday").click();
  }

  let last = null;
  function run() {
    const q = {
      origin: Number($("o").value), dest: Number($("d").value),
      originStop: $("os").value, destStop: $("ds").value,
      date: $("date").value, holiday: $("holiday").checked, transfers: $("transfers").checked,
    };
    if (!q.date) return;
    state.line = null;
    last = { q, time: $("time").value, res: eng.search(q) };
    const p = new URLSearchParams({
      o: data.munis[q.origin], d: data.munis[q.dest], date: q.date, time: last.time,
      h: q.holiday ? "1" : "0", t: q.transfers ? "1" : "0",
    });
    if (q.originStop) p.set("os", q.originStop);
    if (q.destStop) p.set("ds", q.destStop);
    history.replaceState(null, "", "#" + p);
    render();
  }

  const lineNames = (r) => r.legs.map((l) => eng.line(l.route).name);
  const badge = (name) => `<span class="badge" style="background:hsl(${hue(name)} 55% 38%)">${esc(name)}</span>`;

  function stats(direct) {
    const by = new Map();
    for (const r of direct) {
      const l = eng.line(r.legs[0].route);
      const key = l.name;
      if (!by.has(key)) by.set(key, { name: key, agency: l.agency, long: l.long, deps: [], durs: [] });
      by.get(key).deps.push(r.dep); by.get(key).durs.push(r.dur);
    }
    return [...by.values()].map((s) => {
      const n = s.deps.length;
      const first = Math.min(...s.deps), lastDep = Math.max(...s.deps);
      return { ...s, n, first, last: lastDep, every: n > 2 ? Math.round((lastDep - first) / (n - 1)) : null,
        min: Math.min(...s.durs), max: Math.max(...s.durs), avg: Math.round(s.durs.reduce((a, b) => a + b, 0) / n) };
    }).sort((a, b) => a.avg - b.avg);
  }

  function render() {
    if (!last) return;
    const { q, res } = last;
    const minT = toMin(last.time);
    const isToday = q.date === todayStr();
    if (q.origin === q.dest) { out.innerHTML = `<p class="empty">Elige dos municipios distintos.</p>`; return; }

    const keepLine = (r) => !state.line || lineNames(r).includes(state.line);
    const sorter = { dep: (a, b) => a.dep - b.dep || a.arr - b.arr, arr: (a, b) => a.arr - b.arr || a.dur - b.dur, dur: (a, b) => a.dur - b.dur || a.dep - b.dep }[state.sort];
    const direct = res.direct.filter((r) => r.dep >= minT && keepLine(r)).sort(sorter);
    const trans = res.transfer.filter((r) => r.dep >= minT && keepLine(r)).sort(sorter);

    let html = "";
    const st = stats(res.direct);
    if (st.length) {
      const bestAvg = Math.min(...st.map((s) => s.avg)), bestN = Math.max(...st.map((s) => s.n));
      html += `<h2>Comparar líneas <span class="muted">· todo el día, ${res.direct.length} servicios directos</span></h2>
        <div class="table-wrap"><table class="compare"><thead><tr>
        <th>Línea</th><th>Operador</th><th>Servicios</th><th>Primero</th><th>Último</th><th>Cada</th><th>Mín</th><th>Media</th><th>Máx</th>
        </tr></thead><tbody>` +
        st.map((s) => `<tr data-line="${esc(s.name)}" class="${state.line === s.name ? "on" : ""}" title="${esc(s.long)}">
          <td>${badge(s.name)}</td><td>${esc(s.agency)}</td>
          <td class="${s.n === bestN ? "best" : ""}">${s.n}</td><td>${clock(s.first)}</td><td>${clock(s.last)}</td>
          <td>${s.every ? s.every + " min" : "—"}</td><td>${s.min} min</td>
          <td class="${s.avg === bestAvg ? "best" : ""}">${s.avg} min</td><td>${s.max} min</td></tr>`).join("") +
        `</tbody></table></div><p class="muted">Pulsa una línea para filtrar los viajes. En verde: más servicios / más rápida de media.</p>`;
    }

    const seg = (k, t) => `<button type="button" data-sort="${k}" aria-pressed="${state.sort === k}">${t}</button>`;
    html += `<div class="bar"><h2 class="grow" style="margin:0">Viajes${state.line ? ` · línea ${esc(state.line)}` : ""}
      ${state.line ? `<button type="button" data-clear style="min-height:30px;padding:2px 10px;margin-left:8px">Quitar filtro</button>` : ""}</h2>
      <span class="muted">Ordenar:</span><span class="seg">${seg("dep", "Salida")}${seg("arr", "Llegada")}${seg("dur", "Duración")}</span></div>`;

    if (!res.direct.length && !res.transfer.length)
      html += `<p class="empty">No hay servicios entre estos municipios ese día${q.transfers ? "" : " (prueba a incluir trasbordos)"}.</p>`;
    else if (!res.direct.length)
      html += `<p class="notice">No hay autobús directo ese día; estas son las mejores combinaciones con un trasbordo.</p>`;
    else if (!direct.length && !trans.length)
      html += `<p class="empty">No quedan salidas desde esa hora. <button type="button" data-allday>Ver todo el día</button></p>`;

    const fastest = direct.length > 1 ? Math.min(...direct.map((r) => r.dur)) : -1;
    html += direct.map((r, i) => tripHtml(r, { fastest: r.dur === fastest, next: isToday && state.sort === "dep" && i === 0 })).join("");

    if (trans.length && (q.transfers)) {
      html += `<h2>Con un trasbordo <span class="muted">· ${trans.length} opciones</span></h2>` +
        trans.slice(0, 40).map((r) => tripHtml(r, {})).join("");
    }
    out.innerHTML = html;
  }

  function tripHtml(r, { fastest, next }) {
    const tags = (next ? `<span class="tag next">Próximo</span>` : "") + (fastest ? `<span class="tag fast">Más rápido</span>` : "") +
      (r.transfers ? `<span class="tag">1 trasbordo</span>` : "");
    const first = r.legs[0], lastLeg = r.legs[r.legs.length - 1];
    const lines = r.legs.map((l) => badge(eng.line(l.route).name)).join(" + ");
    const ops = [...new Set(r.legs.map((l) => eng.line(l.route).agency))].join(" / ");
    const durTxt = r.dur >= 60 ? `${Math.floor(r.dur / 60)} h ${pad(r.dur % 60)} min` : `${r.dur} min`;
    const detail = r.legs.map((l, k) => {
      const t = data.trips[l.trip];
      const li = eng.line(l.route);
      const rows = [];
      for (let p = l.i; p <= l.j; p++) {
        const isEnd = p === l.i || p === l.j;
        const time = p === l.j ? t[4][p] : t[5][p];
        rows.push(`<li class="${isEnd ? "end" : ""}"><time>${clockText(time + l.shift)}</time><span>${esc(eng.stopMuni(t[3][p]))} · ${esc(eng.stopName(t[3][p]))}</span></li>`);
      }
      const gap = k > 0 ? `<p class="transfer-note">Trasbordo en ${esc(eng.stopMuni(r.legs[0].to))}: ${l.dep - r.legs[0].arr} min de espera${r.walk ? `, ~${r.walk} m a pie entre paradas` : ""}</p>` : "";
      return `${gap}<h3>${badge(li.name)} ${esc(li.long)}</h3><ol>${rows.join("")}</ol>`;
    }).join("");
    return `<details class="trip${fastest ? " fastest" : ""}"><summary>
      <div class="times">${clock(r.dep)}<span class="arrow">→</span>${clock(r.arr)}</div>
      <div>${tags}</div><div class="dur">${durTxt}</div>
      <div class="meta">${lines}<span>${esc(ops)}</span>
        <span>${esc(eng.stopName(first.from))} → ${esc(eng.stopName(lastLeg.to))}</span></div>
      </summary><div class="detail">${detail}</div></details>`;
  }
})();
