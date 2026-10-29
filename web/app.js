(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
  const nowStr = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const toMin = (hhmm) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : 0);
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const color = (name) => `hsl(${hue(name)} 55% 38%)`;
  const clock = (min) => { const f = LB.fmt(min); return f.text + (f.day ? `<sup>${f.day > 0 ? "+1" : "−1"}</sup>` : ""); };
  const clockText = (min) => LB.fmt(min).text;
  const dmy = (n) => `${String(n).slice(6)}/${String(n).slice(4, 6)}/${String(n).slice(0, 4)}`;
  const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)} min` : `${m} min`);
  const dayFmt = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });
  const dayLabel = (s) => { const t = dayFmt.format(new Date(s + "T12:00:00")); return t[0].toUpperCase() + t.slice(1); };

  let eng, data, last = null;
  const state = { tab: "trips", sort: "dep", line: null };
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
    combo($("o"), "d");
    combo($("d"));
    $("validity").textContent =
      `${d.agencies.length} operadores · ${d.trips.length.toLocaleString("es")} servicios · horarios vigentes del ${dmy(d.validFrom)} al ${dmy(d.validTo)}`;

    const p = new URLSearchParams(location.hash.slice(1));
    const byName = (n, dflt) => { const i = d.munis.indexOf(n); return i >= 0 ? i : d.munis.indexOf(dflt); };
    $("o").value = byName(p.get("o"), "Donostia");
    $("d").value = byName(p.get("d"), "Irun");
    refreshStops(p.get("os"), p.get("ds"));
    $("date").value = p.get("date") || todayStr();
    $("time").value = p.has("time") ? p.get("time") : $("date").value === todayStr() ? nowStr() : "";
    $("holiday").checked = p.get("h") === "1";
    $("transfers").checked = p.get("t") !== "0";
    if (p.get("tab") === "compare") state.tab = "compare";

    $("o").addEventListener("change", () => { refreshStops(null, $("ds").value); run(); });
    $("d").addEventListener("change", () => { refreshStops($("os").value, null); run(); });
    $("os").addEventListener("change", run);
    $("ds").addEventListener("change", run);
    $("date").addEventListener("change", () => setDate($("date").value));
    $("prev").addEventListener("click", () => setDate(addDays($("date").value || todayStr(), -1)));
    $("next").addEventListener("click", () => setDate(addDays($("date").value || todayStr(), 1)));
    $("dayq").addEventListener("click", (e) => {
      const b = e.target.closest("[data-day]");
      if (b) setDate(addDays(todayStr(), Number(b.dataset.day)));
    });
    for (const id of ["time", "holiday", "transfers"]) $(id).addEventListener("change", run);
    $("now").addEventListener("click", () => { $("date").value = todayStr(); $("time").value = nowStr(); run(); });
    $("allday").addEventListener("click", () => { $("time").value = ""; run(); });
    $("swap").addEventListener("click", () => {
      const [o, os, ds] = [$("o").value, $("os").value, $("ds").value];
      $("o").value = $("d").value;
      $("d").value = o;
      refreshStops(ds, os);
      run();
    });
    $("form").addEventListener("submit", (e) => { e.preventDefault(); run(); });
    out.addEventListener("click", onClick);
    run();
  }

  // Selector con escritura: autocompleta sin tildes ni mayúsculas, flechas + Enter, Tab acepta la
  // primera coincidencia. El <select> original queda oculto como fuente de verdad (value = índice).
  const combos = [];
  const plain = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  function combo(sel, nextId) {
    const wrap = document.createElement("div");
    wrap.className = "combo";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "combo-in";
    input.placeholder = "Escribe un municipio…";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.autocomplete = "off";
    input.spellcheck = false;
    const list = document.createElement("ul");
    list.className = "combo-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    sel.parentNode.insertBefore(wrap, sel);
    wrap.append(input, list, sel);
    sel.tabIndex = -1;
    sel.setAttribute("aria-hidden", "true");

    const items = [...sel.options].map((o) => ({ value: o.value, text: o.text, key: plain(o.text) }));
    let shown = [], active = 0;

    const label = () => sel.selectedOptions[0]?.text || "";
    const sync = () => { if (document.activeElement !== input) input.value = label(); };
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); };

    function open() {
      const q = plain(input.value === label() ? "" : input.value);
      shown = items.filter((i) => i.key.startsWith(q)).concat(items.filter((i) => !i.key.startsWith(q) && i.key.includes(q)));
      active = 0;
      list.innerHTML = shown.length
        ? shown.map((i, k) => `<li role="option" data-k="${k}"${i.value === sel.value ? ' aria-selected="true"' : ""}>${esc(i.text)}</li>`).join("")
        : `<li class="none">Sin resultados</li>`;
      mark();
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }
    function mark() {
      [...list.children].forEach((li, k) => li.classList.toggle("active", k === active));
      list.children[active]?.scrollIntoView({ block: "nearest" });
    }
    function pick(item, advance) {
      close();
      if (item.value !== sel.value) { sel.value = item.value; sel.dispatchEvent(new Event("change")); }
      input.value = label();
      if (advance && nextId) $(nextId).parentNode.querySelector(".combo-in").focus();
    }

    input.addEventListener("focus", () => { input.select(); open(); });
    input.addEventListener("input", open);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.hidden) return open();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % (shown.length || 1);
        mark();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!list.hidden && shown[active]) pick(shown[active], true);
      } else if (e.key === "Escape") {
        close(); input.value = label(); input.select();
      }
    });
    // al salir: aceptar la coincidencia resaltada si se escribió algo; si no, restaurar
    input.addEventListener("blur", () => {
      const typed = input.value !== label() && input.value.trim() !== "";
      if (typed && !list.hidden && shown[active]) pick(shown[active], false);
      else { close(); input.value = label(); }
    });
    list.addEventListener("mousedown", (e) => {
      e.preventDefault(); // no perder el foco del input antes del click
      const li = e.target.closest("[data-k]");
      if (li) pick(shown[Number(li.dataset.k)], true);
    });
    combos.push({ sync });
    sync();
  }

  // Al cambiar de día: hoy -> desde ahora; otro día -> todo el día.
  function setDate(s) {
    if (!s) return;
    $("date").value = s;
    $("time").value = s === todayStr() ? nowStr() : "";
    run();
  }

  function refreshStops(osKeep, dsKeep) {
    const o = Number($("o").value), d = Number($("d").value);
    const ps = o === d ? null : eng.pairStops(o, d);
    fillStops("os", o, osKeep, ps && ps.from);
    fillStops("ds", d, dsKeep, ps && ps.to);
  }

  // Paradas del municipio (solo las de `allowed` si se indica) agrupadas por nombre, porque varias
  // paradas físicas pueden compartir nombre. keepIds: paradas a conservar seleccionadas, si siguen.
  function fillStops(selId, muni, keepIds, allowed) {
    const groups = new Map();
    for (const si of eng.muniStops(Number(muni))) {
      if (allowed && !allowed.has(si)) continue;
      const n = eng.stopName(si);
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(si);
    }
    const names = [...groups.keys()].sort((a, b) => a.localeCompare(b, "es"));
    const sel = $(selId);
    sel.innerHTML = `<option value="">Cualquier parada (${names.length})</option>` +
      names.map((n) => `<option value="${groups.get(n).join(",")}" data-name="${esc(n)}">${esc(n)}</option>`).join("");
    if (keepIds) {
      const keepName = eng.stopName(Number(String(keepIds).split(",")[0]));
      const opt = [...sel.options].find((o) => o.dataset.name === keepName);
      if (opt) sel.value = opt.value;
    }
  }

  function onClick(e) {
    const t = e.target;
    let el;
    if ((el = t.closest("[data-tab]"))) { state.tab = el.dataset.tab; save(); return render(); }
    if ((el = t.closest("[data-sort]"))) { state.sort = el.dataset.sort; return render(); }
    if ((el = t.closest("[data-chip]"))) {
      state.line = el.dataset.chip === "" || state.line === el.dataset.chip ? null : el.dataset.chip;
      return render();
    }
    if ((el = t.closest("[data-line]"))) { state.line = el.dataset.line; state.tab = "trips"; save(); return render(); }
    if (t.closest("[data-allday]")) return $("allday").click();
    if ((el = t.closest("[data-copy]"))) {
      navigator.clipboard?.writeText(location.href).then(() => { el.textContent = "¡Enlace copiado!"; });
    }
  }

  function run() {
    const q = {
      origin: Number($("o").value), dest: Number($("d").value),
      originStop: $("os").value, destStop: $("ds").value,
      date: $("date").value, holiday: $("holiday").checked, transfers: $("transfers").checked,
    };
    if (!q.date) return;
    state.line = null;
    const res = eng.search(q);
    // un trasbordo con más de 2 h de espera no sirve, salvo que sea lo único que hay
    const wait = (r) => r.legs[1].dep - r.legs[0].arr;
    const sensible = res.transfer.filter((r) => wait(r) <= 120);
    if (sensible.length) res.transfer = sensible;
    last = { q, time: $("time").value, res };
    save();
    render();
  }

  function save() {
    if (!last) return;
    const { q } = last;
    const p = new URLSearchParams({
      o: data.munis[q.origin], d: data.munis[q.dest], date: q.date, time: last.time,
      h: q.holiday ? "1" : "0", t: q.transfers ? "1" : "0",
    });
    if (q.originStop) p.set("os", q.originStop);
    if (q.destStop) p.set("ds", q.destStop);
    if (state.tab !== "trips") p.set("tab", state.tab);
    history.replaceState(null, "", "#" + p);
  }

  function syncControls() {
    const today = todayStr(), date = $("date").value;
    $("allday").setAttribute("aria-pressed", String($("time").value === ""));
    for (const b of $("dayq").querySelectorAll("[data-day]"))
      b.setAttribute("aria-pressed", String(date === addDays(today, Number(b.dataset.day))));
  }

  const lineNames = (r) => r.legs.map((l) => eng.line(l.route).name);
  const badge = (name) => `<span class="badge" style="background:${color(name)}">${esc(name)}</span>`;

  function stats(direct) {
    const by = new Map();
    for (const r of direct) {
      const l = eng.line(r.legs[0].route);
      if (!by.has(l.name)) by.set(l.name, { name: l.name, agency: l.agency, long: l.long, deps: [], durs: [] });
      by.get(l.name).deps.push(r.dep); by.get(l.name).durs.push(r.dur);
    }
    return [...by.values()].map((s) => {
      const n = s.deps.length;
      const first = Math.min(...s.deps), lastDep = Math.max(...s.deps);
      return { ...s, n, first, last: lastDep, every: n > 2 ? Math.round((lastDep - first) / (n - 1)) : null,
        min: Math.min(...s.durs), max: Math.max(...s.durs), avg: Math.round(s.durs.reduce((a, b) => a + b, 0) / n) };
    });
  }

  function render() {
    if (!last) return;
    combos.forEach((c) => c.sync());
    syncControls();
    const { q, res } = last;
    if (q.origin === q.dest) { out.innerHTML = `<p class="empty">Elige dos municipios distintos.</p>`; return; }
    const minT = toMin(last.time);
    const isToday = q.date === todayStr();
    const nowMin = isToday ? toMin(nowStr()) : null;

    const keepLine = (r) => !state.line || lineNames(r).includes(state.line);
    const sorter = {
      dep: (a, b) => a.dep - b.dep || a.arr - b.arr,
      arr: (a, b) => a.arr - b.arr || a.dur - b.dur,
      dur: (a, b) => a.dur - b.dur || a.dep - b.dep,
    }[state.sort];
    const direct = res.direct.filter((r) => r.dep >= minT && keepLine(r)).sort(sorter);
    const trans = (q.transfers ? res.transfer : []).filter((r) => r.dep >= minT && keepLine(r)).sort(sorter);

    out.innerHTML = summaryHtml(q, res, nowMin) + tabsHtml() +
      (state.tab === "compare" ? compareHtml(res.direct) : tripsHtml(q, res, direct, trans, nowMin, minT));
  }

  function summaryHtml(q, res, nowMin) {
    const stopTxt = (sel) => (sel.value ? ` <span class="muted">(${esc(sel.selectedOptions[0].dataset.name)})</span>` : "");
    const kpis = [];
    if (res.direct.length) {
      kpis.push(`<div class="kpi"><b>${res.direct.length}</b><span>servicios directos</span></div>`);
      kpis.push(`<div class="kpi good"><b>${Math.min(...res.direct.map((r) => r.dur))} min</b><span>el más rápido</span></div>`);
    } else if (res.transfer.length) {
      kpis.push(`<div class="kpi"><b>${res.transfer.length}</b><span>con trasbordo</span></div>`);
    }
    if (nowMin != null) {
      const nxt = [...res.direct, ...(res.direct.length ? [] : res.transfer)].filter((r) => r.dep >= nowMin).sort((a, b) => a.dep - b.dep)[0];
      if (nxt) kpis.push(`<div class="kpi"><b>${nxt.dep - nowMin} min</b><span>próxima salida</span></div>`);
    }
    const dateInt = Number(q.date.replaceAll("-", ""));
    const outside = dateInt < data.validFrom || dateInt > data.validTo
      ? `<p class="notice">Ese día queda fuera del periodo con horarios publicados (${dmy(data.validFrom)} – ${dmy(data.validTo)}).</p>` : "";
    return `<div class="summary"><div class="title">
        <h2>${esc(data.munis[q.origin])}${stopTxt($("os"))}<span class="arr">→</span>${esc(data.munis[q.dest])}${stopTxt($("ds"))}</h2>
        <p class="muted" style="margin:2px 0 0">${dayLabel(q.date)}${q.holiday ? " · festivo" : ""}</p></div>
        <div class="kpis">${kpis.join("")}</div>
        <button type="button" class="copy" data-copy>Copiar enlace</button></div>${outside}`;
  }

  function tabsHtml() {
    const tab = (k, t) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${t}</button>`;
    return `<div class="tabs" role="tablist">${tab("trips", "Viajes")}${tab("compare", "Comparar líneas")}</div>`;
  }

  function tripsHtml(q, res, direct, trans, nowMin, minT) {
    // chips de línea con nº de servicios del día
    const counts = new Map();
    for (const r of [...res.direct, ...(q.transfers ? res.transfer : [])])
      for (const n of new Set(lineNames(r))) counts.set(n, (counts.get(n) || 0) + 1);
    const lines = [...counts].sort((a, b) => b[1] - a[1]);
    const chips = lines.length > 1
      ? `<div class="chips"><button type="button" class="lchip" data-chip="" aria-pressed="${!state.line}">Todas</button>` +
        lines.map(([n, c]) => `<button type="button" class="lchip" data-chip="${esc(n)}" aria-pressed="${state.line === n}"><i style="background:${color(n)}"></i>${esc(n)} <small>${c}</small></button>`).join("") + "</div>"
      : "<div></div>";
    const seg = (k, t) => `<button type="button" data-sort="${k}" aria-pressed="${state.sort === k}">${t}</button>`;
    let html = `<div class="toolbar">${chips}<div class="sort"><span class="muted">Ordenar</span><span class="seg">${seg("dep", "Salida")}${seg("arr", "Llegada")}${seg("dur", "Duración")}</span></div></div>`;

    if (!res.direct.length && !res.transfer.length) {
      return html + `<p class="empty">No hay servicios entre estos municipios ese día${q.transfers ? "" : ". Prueba a incluir trasbordos"}.</p>`;
    }
    if (!res.direct.length) html += `<p class="notice">No hay autobús directo ese día. Estas son las mejores combinaciones con un trasbordo.</p>`;
    if (!direct.length && !trans.length)
      html += `<p class="empty">No quedan salidas desde las ${esc(last.time)}. <button type="button" data-allday>Ver todo el día</button></p>`;

    html += cards(direct, nowMin, true);
    if (trans.length) {
      html += `<h3 class="section">Con un trasbordo <small>· ${trans.length} opciones${trans.length > 40 ? ", mostrando 40" : ""}</small></h3>` +
        cards(trans.slice(0, 40), nowMin, false);
    }
    return html;
  }

  function cards(list, nowMin, markNext) {
    if (!list.length) return "";
    const maxDur = Math.max(...list.map((r) => r.dur));
    const fastest = list.length > 1 ? Math.min(...list.map((r) => r.dur)) : -1;
    const nextDep = markNext && nowMin != null ? Math.min(...list.filter((r) => r.dep >= nowMin).map((r) => r.dep)) : Infinity;
    let html = "", hour = null, nextDone = false;
    for (const r of list) {
      if (state.sort === "dep") {
        const h = Math.floor(r.dep / 60);
        if (h !== hour) { hour = h; html += `<div class="hour">${pad(h % 24)}:00${h >= 24 ? " +1" : ""}</div>`; }
      }
      const isNext = !nextDone && r.dep === nextDep;
      if (isNext) nextDone = true;
      html += tripHtml(r, { maxDur, fastest: r.dur === fastest, next: isNext, nowMin });
    }
    return html;
  }

  function tripHtml(r, { maxDur, fastest, next, nowMin }) {
    const first = r.legs[0], lastLeg = r.legs[r.legs.length - 1];
    const lines = r.legs.map((l) => badge(eng.line(l.route).name)).join("");
    const ops = [...new Set(r.legs.map((l) => eng.line(l.route).agency))].join(" / ");
    const inMin = nowMin != null && r.dep >= nowMin && r.dep - nowMin <= 180 ? r.dep - nowMin : null;
    const wait = r.transfers ? r.legs[1].dep - r.legs[0].arr : 0;
    const soon = !r.transfers && inMin != null;
    const note = r.transfers ? `cambio en ${eng.stopMuni(first.to)} · ${wait} min`
      : soon ? (inMin === 0 ? "sale ahora" : `sale en ${inMin} min`) : "";
    const detail = r.legs.map((l, k) => {
      const t = data.trips[l.trip];
      const li = eng.line(l.route);
      const rows = [];
      for (let p = l.i; p <= l.j; p++) {
        const end = p === l.i || p === l.j;
        const time = p === l.j ? t[4][p] : t[5][p];
        rows.push(`<li class="${end ? "end-stop" : ""}"><time>${clockText(time + l.shift)}</time><span>${esc(eng.stopMuni(t[3][p]))} · ${esc(eng.stopName(t[3][p]))}</span></li>`);
      }
      const gap = k > 0 ? `<p class="transfer-note">Trasbordo en ${esc(eng.stopMuni(r.legs[0].to))}: ${wait} min de espera${r.walk ? `, ~${r.walk} m a pie entre paradas` : ""}</p>` : "";
      return `${gap}<h3>${badge(li.name)} <span>${esc(li.long)}</span></h3><ol>${rows.join("")}</ol>`;
    }).join("");
    return `<details class="trip${fastest ? " fastest" : ""}"><summary>
      <div class="end"><b class="clk">${clock(r.dep)}</b><small>${esc(eng.stopName(first.from))}</small></div>
      <div class="mid"><span class="dur">${dur(r.dur)}</span>
        <span class="track" title="${fastest ? "El más rápido" : ""}"><i style="width:${Math.max(8, Math.round((r.dur / maxDur) * 100))}%"></i></span>
        <small${soon ? ' class="soon"' : ""}>${esc(note)}</small></div>
      <div class="end r"><b class="clk">${clock(r.arr)}</b><small>${esc(eng.stopName(lastLeg.to))}</small></div>
      <div class="who"><span class="lines">${lines}</span>${next ? `<span class="tag next">Próximo</span>` : ""}<span>${esc(ops)}</span></div>
      </summary><div class="detail">${detail}</div></details>`;
  }

  function compareHtml(direct) {
    if (!direct.length)
      return `<p class="empty">La comparación de líneas necesita servicios directos entre los dos municipios.</p>`;
    const st = stats(direct).sort((a, b) => a.first - b.first);
    const deps = direct.map((r) => r.dep);
    const start = Math.floor(Math.min(...deps) / 60) * 60;
    const end = Math.ceil((Math.max(...deps) + 1) / 60) * 60;
    const span = (end - start) / 60;
    const step = span > 14 ? 3 : span > 8 ? 2 : 1;
    const pos = (m) => (((m - start) / (end - start)) * 100).toFixed(2);
    let scale = "";
    for (let m = start; m <= end; m += step * 60) scale += `<span style="left:${pos(m)}%">${pad(Math.floor(m / 60) % 24)}</span>`;
    const rows = st.map((s) => {
      const ticks = direct.filter((r) => r.legs[0] && eng.line(r.legs[0].route).name === s.name)
        .map((r) => `<i style="left:${pos(r.dep)}%;background:${color(s.name)}" title="${clockText(r.dep)} · ${r.dur} min"></i>`).join("");
      return `<div class="tl-row${state.line === s.name ? " on" : ""}" data-line="${esc(s.name)}" title="${esc(s.long)}">
        <div class="tl-name">${badge(s.name)}<span>${s.n} servicios</span></div>
        <div class="tl-track" style="--steps:${span / step}">${ticks}</div></div>`;
    }).join("");

    const byAvg = [...st].sort((a, b) => a.avg - b.avg);
    const bestAvg = byAvg[0].avg, bestN = Math.max(...st.map((s) => s.n));
    const table = byAvg.map((s) => `<tr data-line="${esc(s.name)}" title="${esc(s.long)}">
        <td>${badge(s.name)}</td><td>${esc(s.agency)}</td>
        <td class="${s.n === bestN ? "best" : ""}">${s.n}</td><td>${clock(s.first)}</td><td>${clock(s.last)}</td>
        <td>${s.every ? s.every + " min" : "—"}</td><td>${s.min} min</td>
        <td class="${s.avg === bestAvg ? "best" : ""}">${s.avg} min</td><td>${s.max} min</td></tr>`).join("");

    return `<div class="card"><h3>Salidas a lo largo del día <span class="muted">· cada barra es un autobús</span></h3>
        <div class="tl-axis"><span></span><div class="tl-scale">${scale}</div></div>${rows}</div>
      <div class="card"><h3>Resumen por línea <span class="muted">· ordenado por duración media</span></h3>
        <div class="table-wrap"><table class="compare"><thead><tr><th>Línea</th><th>Operador</th><th>Servicios</th><th>Primero</th><th>Último</th><th>Cada</th><th>Mín</th><th>Media</th><th>Máx</th></tr></thead>
        <tbody>${table}</tbody></table></div>
        <p class="muted" style="margin:10px 0 0">Pulsa una línea para ver solo sus viajes. En verde: más servicios y más rápida de media.</p></div>`;
  }
})();
