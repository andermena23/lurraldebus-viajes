(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const plain = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
  const nowStr = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const toMin = (hhmm) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : 0);
  // Color estable por línea: hash FNV-1a sobre una paleta con buen contraste con texto blanco.
  const PALETTE = ["#2563b0", "#b4531a", "#8e3a9d", "#0f7a6b", "#c2375b", "#5b52c4",
    "#8a6d00", "#0b7a9e", "#a33b2a", "#3d5a80", "#9c2f7e", "#6b7a1f"];
  const color = (name) => {
    let h = 2166136261;
    for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return PALETTE[(h >>> 0) % PALETTE.length];
  };
  const clock = (min) => { const f = LB.fmt(min); return f.text + (f.day ? `<sup>${f.day > 0 ? "+1" : "−1"}</sup>` : ""); };
  const clockText = (min) => LB.fmt(min).text;
  const dmy = (n) => `${String(n).slice(6)}/${String(n).slice(4, 6)}/${String(n).slice(0, 4)}`;
  // "Uk01-azkoitia>azpeitia>zestoa" -> "Azkoitia › Azpeitia › Zestoa" (sin el código repetido y con espacios para poder partir línea)
  const longName = (li) => {
    const code = li.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return li.long.replace(new RegExp("^" + code + "\\s*-\\s*", "i"), "")
      .split(">").map((x) => x.trim()).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1)).join(" › ");
  };
  const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)} min` : `${m} min`);
  const dayFmt = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });
  const dayLabel = (s) => { const t = dayFmt.format(new Date(s + "T12:00:00")); return t[0].toUpperCase() + t.slice(1); };

  let eng, data, fares = null, last = null;
  const state = { tab: "trips", sort: "dep", line: null, mode: "trip", allTrans: false, lineKey: "", dir: 0 };
  const out = $("out");
  let oneOp = null; // operador común a todos los viajes (se muestra una vez, no en cada tarjeta)
  let live = false; // true mientras "Desde las" sigue a la hora actual
  const mobile = matchMedia("(max-width: 700px)");

  const RKEY = "lb-recent";
  const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RKEY)) || []; } catch (e) { return []; } };
  // Viajes guardados: rutas favoritas (municipios + paradas por nombre, que no cambian entre actualizaciones de datos).
  const SKEY = "lb-saved";
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SKEY)) || []; } catch (e) { return []; } };
  const storeSaved = (l) => { try { localStorage.setItem(SKEY, JSON.stringify(l)); } catch (e) {} };
  // Número de MUGI para comprar en Avanza: solo en este navegador.
  const MKEY = "lb-mugi";
  const loadMugi = () => { try { return localStorage.getItem(MKEY) || ""; } catch (e) { return ""; } };
  const storeMugi = (v) => { try { v ? localStorage.setItem(MKEY, v) : localStorage.removeItem(MKEY); } catch (e) {} };
  // Venta online: servicios de largo recorrido de Pesa (grupo Avanza). En un trasbordo, cada tramo de Pesa se compra por separado.
  const AVANZA_OPS = new Set(["Pesa (Debagoiena)"]);
  // Compra en Pesa: ver web/pesa.js. Se abre su web, se copia la tarjeta y se indica qué elegir allí (no se puede rellenar desde fuera).
  const PESA_URL = PESA.URL;
  const pesaStop = (si) => PESA.stopFor(eng.stopMuni(si), eng.stopName(si));
  const noMugi = `Guarda tu número de MUGI en <button type="button" class="link" data-settings>Ajustes</button> para que se copie al comprar.`;
  const buyable = (leg) => AVANZA_OPS.has(eng.line(leg.route).agency);
  const routeKey = (r) => [r.o, r.d, r.os || "", r.ds || ""].join("|");
  const shortDay = (s) => {
    const t = todayStr();
    if (s === t) return "Hoy";
    if (s === addDays(t, 1)) return "Mañana";
    return new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short" }).format(new Date(s + "T12:00:00"));
  };

  // Las tarifas son opcionales: sin ellas la app funciona igual, solo sin precio.
  Promise.all([
    fetch("data/network.json").then((r) => r.json()),
    fetch("data/fares.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ])
    .then(([d, f]) => { if (f) fares = FARES.create(f); init(d); })
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
      `${d.agencies.length} operadores · ${d.routes.length} líneas · horarios del ${dmy(d.validFrom)} al ${dmy(d.validTo)}` +
      (d.feedDate ? ` · datos del ${dmy(d.feedDate)}` : "");
    fillLines();
    renderInfo();

    const p = new URLSearchParams(location.hash.slice(1));
    const byName = (n, dflt) => { const i = d.munis.indexOf(n); return i >= 0 ? i : d.munis.indexOf(dflt); };
    const r0 = p.has("o") ? null : loadRecent()[0]; // sin enlace compartido: última ruta usada
    $("o").value = byName(p.get("o") || (r0 && r0.o), "Donostia");
    $("d").value = byName(p.get("d") || (r0 && r0.d), "Irun");
    refreshStops(p.get("os"), p.get("ds"));
    $("date").value = p.get("date") || todayStr();
    $("time").value = p.has("time") ? p.get("time") : $("date").value === todayStr() ? nowStr() : "";
    live = !p.has("time") && $("date").value === todayStr();
    // festivo: lo que diga el enlace; si no, el que corresponda a la fecha (se puede desmarcar)
    $("holiday").checked = p.has("h") ? p.get("h") === "1" : !!HOL.holiday($("date").value);
    $("transfers").checked = p.get("t") !== "0";
    $("demand").checked = p.get("e") !== "0";
    if (p.get("tab") === "compare") state.tab = "compare";
    if (p.get("view") === "line" && lineIdx.has(p.get("line"))) { state.mode = "line"; $("line").value = p.get("line"); }
    $("form").classList.toggle("linemode", state.mode === "line");

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
    for (const id of ["time", "holiday", "transfers", "demand", "line"]) $(id).addEventListener("change", () => run());
    $("line").addEventListener("change", () => { state.dir = 0; });
    document.querySelector(".modes").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (b) setMode(b.dataset.mode);
    });
    $("time").addEventListener("input", () => { live = false; });
    $("now").addEventListener("click", () => { $("date").value = todayStr(); $("time").value = nowStr(); live = true; run(); });
    $("allday").addEventListener("click", () => { $("time").value = ""; live = false; run(); });
    $("swap").addEventListener("click", () => {
      const [o, os, ds] = [$("o").value, $("os").value, $("ds").value];
      $("o").value = $("d").value;
      $("d").value = o;
      refreshStops(ds, os);
      run();
    });
    $("form").addEventListener("submit", (e) => { e.preventDefault(); run(); });
    // móvil: formulario plegable
    $("psum").addEventListener("click", () => setCollapsed(false));
    $("pdone").addEventListener("click", () => { setCollapsed(true); out.scrollIntoView({ block: "start" }); });
    $("form").addEventListener("combo-done", () => setCollapsed(true));
    // Ajustes (diálogo modal): de momento solo el número de MUGI
    const dlg = $("settings");
    $("mugi").value = loadMugi();
    $("mugi-clear").hidden = !$("mugi").value;
    $("gear").addEventListener("click", () => openSettings());
    $("settings-close").addEventListener("click", () => dlg.close());
    $("settings-done").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // clic fuera
    dlg.addEventListener("close", () => { if (last) render(); }); // refresca los avisos de compra
    $("mugi").addEventListener("input", () => {
      $("mugi").value = $("mugi").value.replace(/[^\d ]/g, "");
      storeMugi($("mugi").value.trim());
      $("mugi-clear").hidden = !$("mugi").value;
    });
    $("mugi-clear").addEventListener("click", () => { $("mugi").value = ""; storeMugi(""); $("mugi-clear").hidden = true; $("mugi").focus(); });
    $("recent").addEventListener("click", onRecent);
    $("saved").addEventListener("click", onSaved);
    out.addEventListener("click", onClick);
    // "Ahora" en vivo: refresca cada minuto y al volver a la pestaña
    setInterval(tick, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
    setCollapsed(true);
    run({ initial: true });
  }

  function stopName(selId) {
    const sel = $(selId);
    return sel.value ? sel.selectedOptions[0].dataset.name : "";
  }
  const currentRoute = () => ({ o: $("o").selectedOptions[0].text, d: $("d").selectedOptions[0].text, os: stopName("os"), ds: stopName("ds") });
  const isSaved = () => loadSaved().some((r) => routeKey(r) === routeKey(currentRoute()));

  function toggleSaved() {
    const cur = currentRoute();
    const list = loadSaved();
    const i = list.findIndex((r) => routeKey(r) === routeKey(cur));
    if (i >= 0) list.splice(i, 1);
    else list.unshift(cur);
    storeSaved(list.slice(0, 12));
    render();
  }

  function renderSaved() {
    const cur = routeKey(currentRoute());
    const items = loadSaved().filter((r) => data.munis.includes(r.o) && data.munis.includes(r.d));
    const box = $("saved");
    box.hidden = !items.length;
    box.innerHTML = items.map((r, i) => {
      const stops = [r.os, r.ds].filter(Boolean).join(" → ");
      return `<button type="button" class="schip" data-saved="${i}" aria-pressed="${routeKey(r) === cur}" title="${esc(r.o)} → ${esc(r.d)}${stops ? " (" + esc(stops) + ")" : ""}"><span class="st">★</span>${esc(r.o)} → ${esc(r.d)}${stops ? " <small>· paradas</small>" : ""}</button>`;
    }).join("");
  }

  function onSaved(e) {
    const b = e.target.closest("[data-saved]");
    if (!b) return;
    toTrip();
    const items = loadSaved().filter((r) => data.munis.includes(r.o) && data.munis.includes(r.d));
    const r = items[Number(b.dataset.saved)];
    if (!r) return;
    $("o").value = data.munis.indexOf(r.o);
    $("d").value = data.munis.indexOf(r.d);
    refreshStops(null, null);
    for (const [id, name] of [["os", r.os], ["ds", r.ds]]) {
      const opt = name && [...$(id).options].find((o) => o.dataset.name === name);
      if (opt) $(id).value = opt.value;
    }
    setCollapsed(true);
    run();
  }

  function setCollapsed(c) {
    $("form").classList.toggle("collapsed", c);
    $("psum").setAttribute("aria-expanded", String(!c));
  }

  // Si "Desde las" sigue a la hora actual y no hay ningún viaje desplegado, actualiza la lista.
  function tick() {
    if (!live || state.mode !== "trip" || document.hidden || !last || $("date").value !== todayStr()) return;
    const t = nowStr();
    if (t === $("time").value || out.querySelector("details[open]")) return;
    $("time").value = t;
    run({ refresh: true });
  }

  function pushRecent() {
    const e = { o: data.munis[last.q.origin], d: data.munis[last.q.dest] };
    const list = loadRecent().filter((x) => !(x.o === e.o && x.d === e.d));
    list.unshift(e);
    try { localStorage.setItem(RKEY, JSON.stringify(list.slice(0, 6))); } catch (err) {}
  }

  function renderRecent() {
    const cur = last ? { o: data.munis[last.q.origin], d: data.munis[last.q.dest] } : {};
    const items = loadRecent().filter((x) => data.munis.includes(x.o) && data.munis.includes(x.d) && !(x.o === cur.o && x.d === cur.d)).slice(0, 4);
    const box = $("recent");
    box.hidden = !items.length;
    box.innerHTML = items.length
      ? `<span>Recientes</span>` + items.map((x) => `<button type="button" class="rchip" data-o="${esc(x.o)}" data-d="${esc(x.d)}">${esc(x.o)} → ${esc(x.d)}</button>`).join("")
      : "";
  }

  function onRecent(e) {
    const b = e.target.closest(".rchip");
    if (!b) return;
    toTrip();
    $("o").value = data.munis.indexOf(b.dataset.o);
    $("d").value = data.munis.indexOf(b.dataset.d);
    refreshStops(null, null);
    setCollapsed(true);
    run();
  }

  // Selector con escritura: autocompleta sin tildes ni mayúsculas, flechas + Enter, Tab acepta la
  // primera coincidencia. El <select> original queda oculto como fuente de verdad (value = índice).
  const combos = [];

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
      else if (advance) sel.closest("form").dispatchEvent(new CustomEvent("combo-done"));
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
    live = s === todayStr();
    $("holiday").checked = !!HOL.holiday(s);
    run();
  }

  function toTrip() {
    state.mode = "trip";
    $("form").classList.remove("linemode");
  }

  function setMode(m) {
    if (state.mode === m) return;
    state.mode = m;
    $("form").classList.toggle("linemode", m === "line");
    setCollapsed(false);
    run();
  }

  // ---- líneas: selector y utilidades ----
  const lineIdx = new Map(); // "UK01@La Guipuzcoana" -> índice de ruta
  const lineKey = (ri) => `${data.routes[ri][0]}@${data.agencies[data.routes[ri][3]]}`;
  function fillLines() {
    const byAgency = new Map();
    data.routes.forEach((r, ri) => {
      lineIdx.set(lineKey(ri), ri);
      if (!byAgency.has(r[3])) byAgency.set(r[3], []);
      byAgency.get(r[3]).push(ri);
    });
    const collator = new Intl.Collator("es", { numeric: true });
    $("line").innerHTML = [...byAgency].sort((a, b) => data.agencies[a[0]].localeCompare(data.agencies[b[0]], "es"))
      .map(([ai, list]) => `<optgroup label="${esc(data.agencies[ai])}">` + list
        .sort((a, b) => collator.compare(data.routes[a][0], data.routes[b][0]))
        .map((ri) => `<option value="${esc(lineKey(ri))}">${esc(data.routes[ri][0])} · ${esc(longName(eng.line(ri)))}</option>`).join("") + "</optgroup>").join("");
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
    if ((el = t.closest("[data-dir]"))) { state.dir = Number(el.dataset.dir); return render(); }
    if (t.closest("[data-alltrans]")) { state.allTrans = !state.allTrans; return run({ refresh: true }); }
    if (t.closest("[data-holiday]")) { $("holiday").checked = true; return run({ refresh: true }); }
    if ((el = t.closest("[data-linefor]"))) return showLine(Number(el.dataset.linefor));
    if ((el = t.closest("[data-map]"))) return toggleMap(el);
    if (t.closest("[data-allday]")) return $("allday").click();
    if (t.closest("[data-star]")) return toggleSaved();
    if ((el = t.closest("[data-share]"))) share(el);
    if ((el = t.closest("[data-buy]"))) buy(el);
    if (t.closest("[data-settings]")) openSettings();
  }

  // Abre el horario completo de una línea (desde el detalle de un viaje)
  function showLine(ri) {
    $("line").value = lineKey(ri);
    state.dir = 0;
    state.mode = "line";
    $("form").classList.add("linemode");
    run();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSettings() {
    const dlg = $("settings");
    if (!dlg.open) dlg.showModal();
    $("mugi").focus();
  }

  // Copia el número de MUGI y abre Avanza (en el mismo gesto, para que el navegador no bloquee la ventana).
  function buy(btn) {
    const mugi = loadMugi().trim();
    const leg = [...last.res.direct, ...last.res.transfer].flatMap((x) => x.legs).find((l) => l.trip === Number(btn.dataset.buy));
    const note = btn.parentNode.querySelector(".buy-note");
    if (!mugi) { window.open(PESA_URL, "_blank", "noopener"); note.innerHTML = noMugi; return; }
    // Copiar ANTES de abrir la pestaña: con la pestaña nueva el documento pierde el foco y el navegador rechaza la copia.
    const done = (copied) => {
      window.open(PESA_URL, "_blank", "noopener");
      note.textContent = copied ? "Número de MUGI copiado: pégalo en el campo de tarjeta de Pesa." : `No se pudo copiar. Tu número: ${mugi}`;
    };
    if (navigator.clipboard) navigator.clipboard.writeText(mugi).then(() => done(true), () => done(false)); else done(false);
  }

  function share(btn) {
    const url = location.href;
    const t = btn.querySelector(".t");
    const flash = (txt) => {
      const old = t.textContent;
      t.textContent = txt;
      btn.classList.add("flash");
      setTimeout(() => { t.textContent = old; btn.classList.remove("flash"); }, 2000);
    };
    if (navigator.share) navigator.share({ title: document.title, url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => flash(mobile.matches ? "✓ Copiado" : "¡Enlace copiado!"), () => flash("No se pudo copiar"));
  }

  const isDemand = (r) => r.legs.some((l) => eng.line(l.route).demand);
  const prevHoliday = (date) => !!HOL.holiday(addDays(date, -1));

  function run(opts = {}) {
    if (state.mode === "line") return runLine(opts);
    const q = {
      origin: Number($("o").value), dest: Number($("d").value),
      originStop: $("os").value, destStop: $("ds").value,
      date: $("date").value, holiday: $("holiday").checked, transfers: $("transfers").checked,
      demand: $("demand").checked,
    };
    if (!q.date) return;
    q.holidayPrev = prevHoliday(q.date);
    if (!opts.refresh) { state.line = null; state.allTrans = false; }
    const res = eng.search(q);
    if (!q.demand) { // sin servicios a demanda
      res.direct = res.direct.filter((r) => !isDemand(r));
      res.transfer = res.transfer.filter((r) => !isDemand(r));
    }
    // Un trasbordo con más de 2 h de espera no sirve, salvo que sea lo único que hay (o se pidan todos).
    const wait = (r) => r.legs[1].dep - r.legs[0].arr;
    const sensible = res.transfer.filter((r) => wait(r) <= 120);
    res.hiddenWait = 0;
    if (sensible.length && !state.allTrans) { res.hiddenWait = res.transfer.length - sensible.length; res.transfer = sensible; }
    last = { q, time: $("time").value, res };
    if (!opts.refresh && !opts.initial) pushRecent();
    save();
    render(!opts.refresh);
  }

  // ---- horario de una línea (como la pestaña «Líneas» de la web oficial) ----
  let lastLine = null;
  function runLine(opts = {}) {
    const ri = lineIdx.get($("line").value);
    const date = $("date").value;
    if (ri == null || !date) return;
    const holiday = $("holiday").checked;
    const items = eng.lineDay(ri, date, holiday, prevHoliday(date));
    lastLine = { ri, date, holiday, tables: eng.lineTable(items), count: items.length };
    if (!opts.refresh) state.dir = Math.min(state.dir, Math.max(0, lastLine.tables.length - 1));
    save();
    render(!opts.refresh);
  }

  function save() {
    if (state.mode === "line") {
      if (lastLine) history.replaceState(null, "", "#" + new URLSearchParams({ view: "line", line: $("line").value, date: lastLine.date, h: lastLine.holiday ? "1" : "0" }));
      return;
    }
    if (!last) return;
    const { q } = last;
    const p = new URLSearchParams({
      o: data.munis[q.origin], d: data.munis[q.dest], date: q.date, time: last.time,
      h: q.holiday ? "1" : "0", t: q.transfers ? "1" : "0",
    });
    if (!q.demand) p.set("e", "0");
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
    if ($("os").value || $("ds").value || $("holiday").checked || !$("transfers").checked || !$("demand").checked) $("more").open = true;
    const hn = HOL.holiday(date);
    $("holname").textContent = hn ? `(${hn} · horario de domingo)` : "(horario de domingo)";
    for (const b of document.querySelectorAll("[data-mode]")) b.setAttribute("aria-selected", String(b.dataset.mode === state.mode));
    if (state.mode === "line") {
      $("psum-route").textContent = $("line").selectedOptions[0] ? $("line").selectedOptions[0].text.split(" · ")[0] + " · horario de la línea" : "Línea";
      $("psum-when").textContent = shortDay(date);
    } else {
      $("psum-route").textContent = `${$("o").selectedOptions[0].text} → ${$("d").selectedOptions[0].text}`;
      const stops = [stopName("os"), stopName("ds")].filter(Boolean).join(" → ");
      $("psum-when").textContent = [shortDay(date), $("time").value ? "desde " + $("time").value : "todo el día", stops].filter(Boolean).join(" · ");
    }
    renderRecent();
    renderSaved();
  }

  const lineNames = (r) => r.legs.map((l) => eng.line(l.route).name);
  const badge = (name) => `<span class="badge" style="background:${color(name)}">${esc(name)}</span>`;

  const comboKey = (r) => lineNames(r).join(" + ");

  // Resumen por línea (o por combinación de líneas, si son viajes con trasbordo)
  function stats(list) {
    const by = new Map();
    for (const r of list) {
      const key = comboKey(r);
      if (!by.has(key)) by.set(key, {
        name: key, names: lineNames(r), deps: [], durs: [],
        agency: [...new Set(r.legs.map((l) => eng.line(l.route).agency))].join(" / "),
        long: r.legs.map((l) => longName(eng.line(l.route))).join(" + "),
      });
      by.get(key).deps.push(r.dep); by.get(key).durs.push(r.dur);
    }
    return [...by.values()].map((s) => {
      const n = s.deps.length;
      const first = Math.min(...s.deps), lastDep = Math.max(...s.deps);
      return { ...s, n, first, last: lastDep, every: n > 2 ? Math.round((lastDep - first) / (n - 1)) : null,
        min: Math.min(...s.durs), max: Math.max(...s.durs), avg: Math.round(s.durs.reduce((a, b) => a + b, 0) / n) };
    });
  }

  function render(anim = false) {
    if (state.mode === "line") {
      if (!lastLine) return;
      out.classList.toggle("anim", anim);
      syncControls();
      out.innerHTML = lineHtml();
      return;
    }
    if (!last) return;
    out.classList.toggle("anim", anim);
    combos.forEach((c) => c.sync());
    syncControls();
    const { q, res } = last;
    if (q.origin === q.dest) { out.innerHTML = `<p class="empty">Elige dos municipios distintos.</p>`; return; }
    const minT = toMin(last.time);
    const isToday = q.date === todayStr();
    const nowMin = isToday ? toMin(nowStr()) : null;

    const keepLine = (r) => !state.line || lineNames(r).includes(state.line) || lineNames(r).join(" + ") === state.line;
    const sorter = {
      dep: (a, b) => a.dep - b.dep || a.arr - b.arr,
      arr: (a, b) => a.arr - b.arr || a.dur - b.dur,
      dur: (a, b) => a.dur - b.dur || a.dep - b.dep,
    }[state.sort];
    const ops = new Set([...res.direct, ...res.transfer].flatMap((r) => r.legs.map((l) => eng.line(l.route).agency)));
    oneOp = ops.size === 1 ? [...ops][0] : null;
    const direct = res.direct.filter((r) => r.dep >= minT && keepLine(r)).sort(sorter);
    const trans = (q.transfers ? res.transfer : []).filter((r) => r.dep >= minT && keepLine(r)).sort(sorter);

    out.innerHTML = summaryHtml(q, res, nowMin) + tabsHtml() +
      (state.tab === "compare" ? compareHtml(res.direct.length ? res.direct : res.transfer, !res.direct.length) : tripsHtml(q, res, direct, trans, nowMin, minT));
  }

  // ---- avisos oficiales, vigencia por operador ----
  const noticesHtml = (names) => (data.notices || []).filter((n) => n.lines.some((l) => names.has(l)))
    .map((n) => `<details class="notice official"><summary><b>Aviso oficial</b> · ${esc(n.title)} <small>${esc(n.date)}</small></summary><p>${esc(n.text)}</p></details>`).join("");

  let agMunis = null; // operador -> municipios en los que para
  function expiryHtml(q) {
    if (!data.agencyInfo) return "";
    if (!agMunis) {
      agMunis = data.agencies.map(() => new Set());
      for (const t of data.trips) for (const sid of t[3]) agMunis[data.routes[t[0]][3]].add(data.stops[sid][1]);
    }
    const di = Number(q.date.replaceAll("-", ""));
    const late = data.agencies.map((_, a) => a).filter((a) => {
      const end = data.agencyInfo[a].validTo;
      return end && di > end && di <= data.validTo && (agMunis[a].has(q.origin) || agMunis[a].has(q.dest));
    });
    return late.length ? `<p class="notice">Los horarios de ${late.map((a) => `${esc(data.agencies[a])} (hasta el ${dmy(data.agencyInfo[a].validTo)})`).join(", ")} aún no están publicados para ese día, así que sus servicios no aparecen aunque puedan existir.</p>` : "";
  }

  const demandNote = `<p class="notice demand"><b>Servicio a demanda.</b> Hay que pedirlo llamando al <a href="tel:900300340">900 300 340</a> (08:00–20:00) con al menos 60 minutos de antelación; si sale antes de las 08:00, antes de las 20:00 de la víspera.</p>`;

  function renderInfo() {
    const list = data.notices || [];
    $("notices").innerHTML = list.length
      ? `<h3>Avisos oficiales (${list.length})</h3>` + list.map((n) => `<p><b>${esc(n.title)}</b> <small>${esc(n.date)}</small><br>${esc(n.text)}</p>`).join("") +
        `<p class="muted">Copiados de lurraldebus.eus al actualizar los datos (una vez al día): pueden faltar los más recientes.</p>`
      : "";
    if (list.length) $("info").querySelector("summary").textContent = `Avisos (${list.length}), servicios a demanda y accesibilidad`;
  }

  // Destino/sentido del viaje (trip_headsign del GTFS); se omite si es solo un número de línea.
  const headsign = (ti) => { const h = (data.trips[ti][2] || "").trim(); return h && !/^l[ií]nea\s*\d+$/i.test(h) ? h : ""; };

  function summaryHtml(q, res, nowMin) {
    const stopTxt = (sel) => (sel.value ? ` <span class="muted">(${esc(sel.selectedOptions[0].dataset.name)})</span>` : "");
    const kpis = [], brief = [];
    if (res.direct.length) {
      const fast = Math.min(...res.direct.map((r) => r.dur));
      kpis.push(`<div class="kpi"><b>${res.direct.length}</b><span>servicios directos</span></div>`);
      kpis.push(`<div class="kpi good"><b>${fast} min</b><span>el más rápido</span></div>`);
      brief.push(`${res.direct.length} directos`, `el más rápido, ${fast} min`);
    } else if (res.transfer.length) {
      kpis.push(`<div class="kpi"><b>${res.transfer.length}</b><span>con trasbordo</span></div>`);
      brief.push(`${res.transfer.length} con trasbordo`);
    }
    if (nowMin != null) {
      // la próxima salida cuenta solo servicios regulares: uno a demanda hay que pedirlo antes
      const nxt = [...res.direct, ...(res.direct.length ? [] : res.transfer)].filter((r) => r.dep >= nowMin && !isDemand(r)).sort((a, b) => a.dep - b.dep)[0];
      if (nxt) {
        kpis.push(`<div class="kpi"><b>${nxt.dep - nowMin} min</b><span>próxima salida</span></div>`);
        brief.unshift(`<b class="soon">${nxt.dep === nowMin ? "Sale ahora" : `Próximo en ${nxt.dep - nowMin} min`}</b>`);
      }
    }
    const fare = fares && res.direct.length ? fares.fare(data.munis[q.origin], data.munis[q.dest]) : null;
    if (fare) {
      kpis.push(`<div class="kpi" title="Tarifa orientativa: ${fare.jumps} ${fare.jumps === 1 ? "salto" : "saltos"} entre ${esc(fare.zones[0])} y ${esc(fare.zones[1])}. Los trasbordos y algunas líneas pueden tener otra tarifa."><b>${FARES.eur(fare.mugi)}</b><span>con MUGI · ${FARES.eur(fare.ocasional)} billete</span></div>`);
    }
    const dateInt = Number(q.date.replaceAll("-", ""));
    const outside = dateInt < data.validFrom || dateInt > data.validTo
      ? `<p class="notice">Ese día queda fuera del periodo con horarios publicados (${dmy(data.validFrom)} – ${dmy(data.validTo)}).</p>` : "";
    const hn = HOL.holiday(q.date);
    const holiday = hn && !q.holiday
      ? `<p class="notice">Ese día es festivo (${esc(hn)}) y se muestra el horario de un día laborable. <button type="button" data-holiday>Ver horario de festivo</button></p>` : "";
    const names = new Set([...res.direct, ...res.transfer].flatMap(lineNames));
    const saved = isSaved();
    return `<div class="summary"><div class="title">
        <h2>${esc(data.munis[q.origin])}${stopTxt($("os"))}<span class="arr">→</span>${esc(data.munis[q.dest])}${stopTxt($("ds"))}</h2>
        <p class="muted when-line">${dayLabel(q.date)}${q.holiday ? ` · festivo${hn ? ` (${esc(hn)})` : ""}` : ""}${oneOp ? ` · ${esc(oneOp)}` : ""}</p></div>
        <div class="kpis">${kpis.join("")}</div>
        <div class="actions"><button type="button" class="star" data-star aria-pressed="${saved}" aria-label="${saved ? "Quitar de guardados" : "Guardar este viaje"}" title="${saved ? "Quitar de guardados" : "Guardar este viaje"}"><span class="ic" aria-hidden="true">${saved ? "★" : "☆"}</span><span class="t">${saved ? "Guardado" : "Guardar"}</span></button><button type="button" class="copy" data-share aria-label="Compartir enlace"><span class="ic" aria-hidden="true">↗</span><span class="t">Compartir</span></button></div>
        <p class="brief">${brief.join(" · ")}</p></div>${outside}${holiday}${expiryHtml(q)}${noticesHtml(names)}`;
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
      const cut = !state.allTrans && trans.length > 40;
      html += `<h3 class="section">Con un trasbordo <small>· ${trans.length} opciones${cut ? ", mostrando 40" : ""}</small></h3>` +
        cards(cut ? trans.slice(0, 40) : trans, nowMin, false);
    }
    if (q.transfers && (res.hiddenWait || trans.length > 40 || state.allTrans)) {
      const notes = [];
      if (!state.allTrans && trans.length > 40) notes.push(`Se muestran 40 de ${trans.length} combinaciones.`);
      if (!state.allTrans && res.hiddenWait) notes.push(`Hay ${res.hiddenWait} más con más de 2 h de espera, ocultas.`);
      html += `<p class="more-note">${notes.join(" ")} <button type="button" data-alltrans>${state.allTrans ? "Ver solo las razonables" : "Ver todas"}</button></p>`;
    }
    return html;
  }

  function cards(list, nowMin, markNext) {
    if (!list.length) return "";
    const maxDur = Math.max(...list.map((r) => r.dur));
    const fastest = list.length > 1 ? Math.min(...list.map((r) => r.dur)) : -1;
    const nextDep = markNext && nowMin != null ? Math.min(...list.filter((r) => r.dep >= nowMin && !isDemand(r)).map((r) => r.dep)) : Infinity;
    let html = "", hour = null, nextDone = false, idx = 0;
    for (const r of list) {
      if (state.sort === "dep") {
        const h = Math.floor(r.dep / 60);
        if (h !== hour) { hour = h; html += `<div class="hour">${pad(h % 24)}:00${h >= 24 ? " +1" : ""}</div>`; }
      }
      const isNext = !nextDone && r.dep === nextDep && !isDemand(r);
      if (isNext) nextDone = true;
      html += tripHtml(r, { maxDur, fastest: r.dur === fastest, next: isNext, nowMin, i: idx++ });
    }
    return html;
  }

  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "");

  function legHtml(r, l, k) {
    const t = data.trips[l.trip];
    const li = eng.line(l.route);
    const hs = headsign(l.trip);
    const rows = [];
    for (let p = l.i; p <= l.j; p++) {
      const end = p === l.i || p === l.j;
      const time = p === l.j ? t[4][p] : t[5][p];
      // solo informativo en paradas intermedias: en el origen y el destino de tu tramo siempre se puede subir/bajar
      const f = t[6].charCodeAt(p) - 48;
      const tag = !end && f ? `<em class="rtag" title="${["", "En esta parada solo se puede bajar", "En esta parada solo se puede subir", "En esta parada no suben ni bajan viajeros"][f]}">${["", "solo bajada", "solo subida", "sin viajeros"][f]}</em>` : "";
      rows.push(`<li class="${end ? "end-stop" : ""}"><time>${clockText(time + l.shift)}</time><span>${esc(eng.stopMuni(t[3][p]))} · ${esc(eng.stopName(t[3][p]))}${tag}</span></li>`);
    }
    // El buscador baja en la primera parada del municipio destino; el mismo bus puede seguir parando dentro de él.
    let more = "";
    if (k === r.legs.length - 1 && !last.q.destStop) {
      const dm = data.stops[t[3][l.j]][1], alts = [];
      for (let p = l.j + 1; p < t[3].length && data.stops[t[3][p]][1] === dm; p++)
        if (t[6].charCodeAt(p) - 48 < 2)
          alts.push(`<li><time>${clockText(t[4][p] + l.shift)}</time><span>${esc(eng.stopName(t[3][p]))}</span></li>`);
      if (alts.length) more = `<p class="alt-note">El mismo autobús sigue por ${esc(data.munis[dm])} y para también en:</p><ol class="alt-list">${alts.join("")}</ol>`;
    }
    const gap = k > 0 ? `<p class="transfer-note">Trasbordo en ${esc(eng.stopMuni(r.legs[0].to))}: ${r.legs[1].dep - r.legs[0].arr} min de espera${r.walk ? `, ~${r.walk} m a pie entre paradas` : ""}</p>` : "";
    const po = buyable(l) && pesaStop(l.from), pd = buyable(l) && pesaStop(l.to);
    const [yy, mm, dd] = last.q.date.split("-");
    const buy = buyable(l)
      ? `<div class="buy"><button type="button" data-buy="${l.trip}">${r.transfers ? `Comprar ${esc(li.name)} en Avanza` : "Comprar en Avanza"}</button>
        ${po && pd ? `<p class="buy-pick">En Pesa elige: <b>${esc(po.name)}</b> → <b>${esc(pd.name)}</b> · <b>${dd}/${mm}/${yy}</b></p>` : ""}
        <p class="muted buy-note">${loadMugi().trim() ? "Se abrirá la web de compra y se copiará tu número de MUGI." : noMugi} No todos los viajes tienen venta online.</p></div>` : "";
    // Tiempo real: formulario normal hacia lurraldebus.eus (sin proxy); solo en paradas que esa web conoce.
    const from = data.stops[l.from];
    const rt = from[5] ? `<form class="rt" method="post" action="https://lurraldebus.eus/real/result" target="_blank" rel="noopener"><input type="hidden" name="_method" value="POST"><input type="hidden" name="data[Real][municipioId]" value="${from[5]}"><input type="hidden" name="data[Real][paradaId]" value="${esc(from[4])}"><button type="submit" title="Abre lurraldebus.eus con los minutos de espera y la ocupación en ${esc(from[0])}">Tiempo real</button></form>` : "";
    const acts = `<div class="leg-actions">${rt}<button type="button" data-map="${l.trip}:${l.i}:${l.j}">Mapa</button><button type="button" data-linefor="${l.route}">Horario de la línea</button></div><div class="tmap" hidden></div>`;
    const ai = data.agencyInfo && data.agencyInfo[li.agencyIdx];
    const op = ai ? `<p class="muted opinfo">${esc(li.agency)}${ai.phone ? ` · Tel. <a href="tel:${esc(ai.phone.replace(/[^\d+]/g, ""))}">${esc(ai.phone)}</a>` : ""}${safeUrl(ai.url) ? ` · <a href="${esc(safeUrl(ai.url))}" target="_blank" rel="noopener">web</a>` : ""}</p>` : "";
    return `${gap}<div class="leg"><h3>${badge(li.name)} <span>${esc(longName(li))}</span>${hs ? `<small class="dir">→ ${esc(hs)}</small>` : ""}</h3>${li.demand ? demandNote : ""}<ol>${rows.join("")}</ol>${more}${acts}${op}${buy}</div>`;
  }

  function tripHtml(r, { maxDur, fastest, next, nowMin, i }) {
    const first = r.legs[0], lastLeg = r.legs[r.legs.length - 1];
    const lines = r.legs.map((l) => badge(eng.line(l.route).name)).join("");
    const ops = [...new Set(r.legs.map((l) => eng.line(l.route).agency))].join(" / ");
    const inMin = nowMin != null && r.dep >= nowMin && r.dep - nowMin <= 180 ? r.dep - nowMin : null;
    const wait = r.transfers ? r.legs[1].dep - r.legs[0].arr : 0;
    const demand = isDemand(r);
    const soon = !r.transfers && inMin != null && !demand;
    const note = r.transfers ? `1 cambio · ${wait} min`
      : demand ? "hay que pedirlo" : soon ? (inMin === 0 ? "sale ahora" : `sale en ${inMin} min`) : "";
    const hs = r.transfers ? "" : headsign(first.trip);
    const detail = r.legs.map((l, k) => legHtml(r, l, k)).join("") +
      `<p class="muted fine">Horario programado: las horas de las paradas intermedias son estimaciones del operador.</p>`;
    return `<details class="trip${fastest ? " fastest" : ""}${demand ? " demand" : ""}" style="--i:${Math.min(i || 0, 12)}"><summary>
      <div class="end"><div class="clkrow"><b class="clk">${clock(r.dep)}</b>${next ? `<span class="tag next d">Próximo</span>` : ""}</div><small>${esc(eng.stopName(first.from))}</small></div>
      <div class="mid"><span class="dur">${dur(r.dur)}</span>
        <span class="track" title="${fastest ? "El más rápido" : ""}"><i style="width:${Math.max(8, Math.round((r.dur / maxDur) * 100))}%"></i></span>
        <small${soon ? ' class="soon"' : ""}>${esc(note)}</small></div>
      <div class="end r"><b class="clk">${clock(r.arr)}</b><small>${esc(eng.stopName(lastLeg.to))}</small></div>
      <div class="who"><span class="lines">${lines}${next ? `<span class="tag next m">Próximo</span>` : ""}</span>${hs ? `<span class="dir">→ ${esc(hs)}</span>` : ""}${demand ? `<span class="tag demand" title="Hay que pedirlo por teléfono con antelación">A demanda</span>` : ""}${oneOp ? "" : `<span class="op">${esc(ops)}</span>`}</div>
      </summary><div class="detail">${detail}</div></details>`;
  }

  function compareHtml(list, viaTransfer) {
    if (!list.length)
      return `<p class="empty">La comparación de líneas necesita servicios entre los dos municipios.</p>`;
    const st = stats(list).sort((a, b) => a.first - b.first);
    const deps = list.map((r) => r.dep);
    const start = Math.floor(Math.min(...deps) / 60) * 60;
    const end = Math.ceil((Math.max(...deps) + 1) / 60) * 60;
    const span = (end - start) / 60;
    const step = span > 14 ? 3 : span > 8 ? 2 : 1;
    const pos = (m) => (((m - start) / (end - start)) * 100).toFixed(2);
    let scale = "";
    for (let m = start; m <= end; m += step * 60) scale += `<span style="left:${pos(m)}%">${pad(Math.floor(m / 60) % 24)}</span>`;
    const badges = (s) => s.names.map(badge).join(" + ");
    const rows = st.map((s) => {
      const ticks = list.filter((r) => comboKey(r) === s.name)
        .map((r) => `<i style="left:${pos(r.dep)}%;background:${color(s.names[0])}" title="${clockText(r.dep)} · ${r.dur} min"></i>`).join("");
      return `<div class="tl-row${state.line === s.name ? " on" : ""}" data-line="${esc(s.name)}" title="${esc(s.long)}">
        <div class="tl-name">${s.names.map(badge).join("")}<span>${s.n} servicios</span></div>
        <div class="tl-track" style="--steps:${span / step}">${ticks}</div></div>`;
    }).join("");

    const byAvg = [...st].sort((a, b) => a.avg - b.avg);
    const bestAvg = byAvg[0].avg, bestN = Math.max(...st.map((s) => s.n));
    const table = byAvg.map((s) => `<tr data-line="${esc(s.name)}" title="${esc(s.long)}">
        <td>${badges(s)}</td><td>${esc(s.agency)}</td>
        <td class="${s.n === bestN ? "best" : ""}">${s.n}</td><td>${clock(s.first)}</td><td>${clock(s.last)}</td>
        <td>${s.every ? s.every + " min" : "—"}</td><td>${s.min} min</td>
        <td class="${s.avg === bestAvg ? "best" : ""}">${s.avg} min</td><td>${s.max} min</td></tr>`).join("");

    return (viaTransfer ? `<p class="notice">No hay autobús directo ese día: se comparan las combinaciones con un trasbordo.</p>` : "") +
      `<div class="card"><h3>Salidas a lo largo del día <span class="muted">· cada barra es ${viaTransfer ? "una salida con trasbordo" : "un autobús"}</span></h3>
        <div class="tl-axis"><span></span><div class="tl-scale">${scale}</div></div>${rows}</div>
      <div class="card"><h3>Resumen por ${viaTransfer ? "combinación" : "línea"} <span class="muted">· ordenado por duración media</span></h3>
        <div class="table-wrap"><table class="compare"><thead><tr><th>${viaTransfer ? "Líneas" : "Línea"}</th><th>Operador</th><th>Servicios</th><th>Primero</th><th>Último</th><th>Cada</th><th>Mín</th><th>Media</th><th>Máx</th></tr></thead>
        <tbody>${table}</tbody></table></div>
        <p class="muted" style="margin:10px 0 0">Pulsa una fila para ver solo sus viajes. En verde: más servicios y más rápida de media.</p></div>`;
  }

  // ---- vista «Horario de una línea» ----
  function lineHtml() {
    const { ri, date, holiday, tables, count } = lastLine;
    const li = eng.line(ri);
    const hn = HOL.holiday(date);
    const dateInt = Number(date.replaceAll("-", ""));
    const end = data.agencyInfo && data.agencyInfo[li.agencyIdx].validTo;
    const info = [
      dateInt < data.validFrom || dateInt > data.validTo ? `<p class="notice">Ese día queda fuera del periodo con horarios publicados (${dmy(data.validFrom)} – ${dmy(data.validTo)}).</p>` : "",
      end && dateInt > end && dateInt <= data.validTo ? `<p class="notice">Los horarios de ${esc(li.agency)} solo están publicados hasta el ${dmy(end)}.</p>` : "",
      hn && !holiday ? `<p class="notice">Ese día es festivo (${esc(hn)}) y se muestra el horario de un día laborable. <button type="button" data-holiday>Ver horario de festivo</button></p>` : "",
      noticesHtml(new Set([li.name])), li.demand ? demandNote : "",
    ].join("");
    let html = `<div class="summary"><div class="title"><h2>${badge(li.name)} ${esc(longName(li))}</h2>
        <p class="muted when-line">${dayLabel(date)}${holiday ? ` · festivo${hn ? ` (${esc(hn)})` : ""}` : ""} · ${esc(li.agency)}</p></div>
        <div class="kpis"><div class="kpi"><b>${count}</b><span>viajes ese día</span></div></div></div>${info}`;
    if (!tables.length) return html + `<p class="empty">Esta línea no circula ese día.</p>`;
    const dir = Math.min(state.dir, tables.length - 1), tb = tables[dir];
    if (tables.length > 1)
      html += `<div class="tabs" role="tablist">${tables.map((x, k) => `<button type="button" role="tab" data-dir="${k}" aria-selected="${k === dir}">${esc(x.from)} → ${esc(x.to)} <small>${x.trips.length}</small></button>`).join("")}</div>`;
    const nowMin = date === todayStr() ? toMin(nowStr()) : null;
    const past = (c) => nowMin != null && c.dep < nowMin;
    const head = tb.trips.map((c) => `<th class="${past(c) ? "past" : ""}">${clock(c.dep)}</th>`).join("");
    // primera y última parada real de cada viaje: ahí «solo subida» / «solo bajada» es lo normal y no se marca
    const ends = tb.trips.map((c) => { const idx = c.cells.flatMap((x, k) => (x ? [k] : [])); return [idx[0], idx[idx.length - 1]]; });
    const body = tb.stops.map((sid, row) => `<tr><th scope="row"><span class="lt-muni">${esc(eng.stopMuni(sid))}</span>${esc(eng.stopName(sid))}</th>` +
      tb.trips.map((c, ci) => {
        const cell = c.cells[row];
        if (!cell) return `<td class="no${past(c) ? " past" : ""}">·</td>`;
        let f = Number(cell[1]);
        if ((row === ends[ci][0] && f === 2) || (row === ends[ci][1] && f === 1)) f = 0;
        const mark = f === 1 ? `<sup title="Solo se puede bajar">↓</sup>` : f === 2 ? `<sup title="Solo se puede subir">↑</sup>` : f === 3 ? `<sup title="No suben ni bajan viajeros">×</sup>` : "";
        return `<td class="${past(c) ? "past" : ""}">${clock(cell[0])}${mark}</td>`;
      }).join("") + "</tr>").join("");
    return html + `<div class="card"><div class="table-wrap lt-wrap"><table class="lt"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="muted" style="margin:10px 0 0">Cada columna es un viaje. <b>↓</b> solo bajada · <b>↑</b> solo subida · «·» el viaje no pasa por esa parada. Horario programado: las horas de las paradas intermedias son estimaciones del operador.</p></div>`;
  }

  // ---- mapa del tramo (Leaflet + OpenStreetMap, se carga solo al pedirlo) ----
  let leafletLoad = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (!leafletLoad) leafletLoad = new Promise((ok, ko) => {
      const css = document.createElement("link");
      Object.assign(css, { rel: "stylesheet", href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", crossOrigin: "", integrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" });
      const js = document.createElement("script");
      Object.assign(js, { src: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", crossOrigin: "", integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
        onload: ok, onerror: () => { leafletLoad = null; ko(new Error("leaflet")); } });
      document.head.append(css, js);
    });
    return leafletLoad;
  }

  function toggleMap(btn) {
    const box = btn.closest(".leg").querySelector(".tmap");
    if (!box.hidden) { box.hidden = true; btn.setAttribute("aria-pressed", "false"); return; }
    box.hidden = false;
    btn.setAttribute("aria-pressed", "true");
    if (box.dataset.ready) return;
    box.textContent = "Cargando mapa…";
    loadLeaflet().then(() => {
      const [ti, i, j] = btn.dataset.map.split(":").map(Number);
      const ids = data.trips[ti][3].slice(i, j + 1);
      const pts = ids.map((sid) => [data.stops[sid][2], data.stops[sid][3]]);
      box.textContent = "";
      const map = L.map(box, { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© colaboradores de OpenStreetMap" }).addTo(map);
      L.polyline(pts, { color: "#007882", weight: 4, opacity: 0.8 }).addTo(map);
      ids.forEach((sid, k) => {
        const end = k === 0 || k === ids.length - 1;
        L.circleMarker(pts[k], { radius: end ? 7 : 4, color: "#fff", weight: 2, fillColor: end ? "#007882" : "#8dc63f", fillOpacity: 1 })
          .bindTooltip(esc(eng.stopMuni(sid) + " · " + eng.stopName(sid))).addTo(map);
      });
      map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] });
      box.dataset.ready = "1";
      box.insertAdjacentHTML("afterend", `<p class="muted fine map-note">Recorrido aproximado: une las paradas en línea recta.</p>`);
    }).catch(() => { box.textContent = "No se pudo cargar el mapa (¿sin conexión?)."; });
  }

  // PWA: instalable y con los horarios disponibles sin conexión
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
