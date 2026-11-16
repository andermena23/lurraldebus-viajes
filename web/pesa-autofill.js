/* Relleno automático de la compra en Pesa/Avanza (online.pesa.net).
 * Se ejecuta DENTRO de la página de Pesa: el service worker de la PWA intercepta la navegación que abre el botón
 * «Comprar en Avanza» e inyecta este código en la primera respuesta. Así el navegador sigue en el origen de Pesa,
 * con su sesión y sus cookies reales, y el pago no pasa por nuestra infraestructura.
 * Funciona en navegador (window.PESAAUTO, lo usa sw.js con importScripts) y en Node (module.exports) para tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PESAAUTO = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const PESA_HOST = "online.pesa.net";
  const isPesa = (url) => url.hostname === PESA_HOST;

  // Índice del servicio (radio `elegido{n}`) cuya hora de salida (`horaI{n}`) y fecha/origen coinciden con el viaje.
  // Puro y sin DOM para poder probarlo en Node con una respuesta real de Pesa guardada como fixture.
  function pickTrip(html, spec) {
    const values = {}, hours = {};
    let m;
    const radios = /id=['"]elegido(\d+)['"][^>]*value=['"]([^'"]+)['"]/gi;
    while ((m = radios.exec(html))) values[m[1]] = m[2];
    const times = /id=['"]horaI(\d+)['"][^>]*title=['"](\d{1,2}:\d{2})['"]/gi;
    while ((m = times.exec(html))) hours[m[1]] = String(m[2]).replace(/^(\d):/, "0$1:");
    const want = String(spec.h || "").replace(/^(\d):/, "0$1:");
    if (!want) return null;
    for (const n of Object.keys(hours)) {
      if (hours[n] !== want) continue;
      const parts = (values[n] || "").split("-");
      if (spec.f && parts[1] !== spec.f) continue; // fecha DD/MM/YYYY
      if (spec.o && !String(parts[2] || "").startsWith(spec.o.split("/")[0] + "/")) continue; // código de origen
      return Number(n);
    }
    return null;
  }

  // Se ejecuta en la página de Pesa. Lleva su propio código serializado para poder volver a inyectarse en la página
  // de resultados (que se pinta con document.write) y seguir desde allí.
  function run(payload) {
    var spec = payload.spec || {};
    var $ = function (id) { return document.getElementById(id); };
    var pickTrip = eval("(" + payload.pickSrc + ")");
    function label(v) { return String(v || "").split("/").pop() || "la parada indicada"; }
    function note(msg) {
      try {
        var d = document.createElement("div");
        d.setAttribute("role", "status");
        d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#fff7d6;color:#222;padding:12px 16px;font:14px/1.4 Arial,sans-serif;text-align:center;border-bottom:2px solid #d2a500";
        d.textContent = msg;
        document.body.appendChild(d);
      } catch (e) {}
    }
    function opts(sel) { return [].map.call(sel.options || [], function (o) { return o.value; }); }
    function wait(test, ok, fail, ms) {
      var start = Date.now();
      (function tick() {
        if (test()) { ok(); return; }
        if (Date.now() - start > (ms || 8000)) { note(fail); return; }
        setTimeout(tick, 100);
      })();
    }
    // Vuelve a inyectar este mismo runner en el HTML de resultados que acabamos de pedir por fetch.
    function embed(html, phase) {
      var p = { spec: spec, phase: phase, pickSrc: payload.pickSrc, selfSrc: payload.selfSrc };
      var code = "(function(){" + payload.selfSrc + "})(" + JSON.stringify(p) + ");";
      var tag = "<script>" + code.replace(/<\/script>/gi, "<\\/script>") + "</" + "script>";
      return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, tag + "</body>") : html + tag;
    }

    if (payload.phase === "results") { choose(); return; }

    var fi = $("fechaI"), so = $("selectOri");
    if (!fi || !so) return; // no es el formulario de búsqueda: no tocamos nada

    fi.value = spec.f;
    if (spec.t && $("tarjeta")) $("tarjeta").value = spec.t;
    so.value = spec.o;
    if (so.value !== spec.o) { note("No se pudo rellenar el origen. Elige " + label(spec.o) + " a mano."); return; }
    so.dispatchEvent(new Event("change"));

    wait(
      function () { var sd = $("selectDes"); return sd && !sd.disabled && opts(sd).indexOf(spec.d) >= 0; },
      function () {
        var sd = $("selectDes");
        sd.value = spec.d;
        if (sd.value !== spec.d) { note("No se pudo rellenar el destino. Elige " + label(spec.d) + " a mano."); return; }
        search();
      },
      "No se pudo rellenar el destino a tiempo. Elige " + label(spec.d) + " a mano."
    );

    function search() {
      var form = document.miform;
      if (!form) { note("La web de Pesa ha cambiado. Compra a mano."); return; }
      var body;
      try { body = new URLSearchParams(new FormData(form)).toString(); }
      catch (e) { note("No se pudo preparar la búsqueda. Compra a mano."); return; }
      fetch("index.asp", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body
      })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          if (!/elegido1/.test(html)) { note("Pesa no devolvió servicios. Compra a mano."); return; }
          document.open(); document.write(embed(html, "results")); document.close();
        })
        .catch(function () { note("No se pudo consultar Pesa. Compra a mano."); });
    }

    function choose() {
      var n = null;
      try { n = pickTrip(document.documentElement.outerHTML, spec); } catch (e) {}
      var radio = n && $("elegido" + n);
      if (!radio) {
        note("No encontramos el servicio de las " + (spec.h || "?") + ". Elígelo a mano.");
        return;
      }
      radio.checked = true;
      if (typeof window.marcarElegido === "function") window.marcarElegido(n);
      else { var v = $("valorI"); if (v) v.value = radio.value; }
      note("Viaje de las " + spec.h + " seleccionado. Revisa la tarifa y continúa con el pago en Pesa.");
    }
  }

  // Inyecta el runner en una página HTML de Pesa (antes del </body>) con el viaje ya serializado.
  function inject(html, spec) {
    var payload = { spec: spec, phase: "start", pickSrc: pickTrip.toString(), selfSrc: run.toString() };
    var code = "(function(){" + run.toString() + "})(" + JSON.stringify(payload) + ");";
    var tag = "<script>" + code.replace(/<\/script>/gi, "<\\/script>") + "</" + "script>";
    return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, tag + "</body>") : html + tag;
  }

  return { PESA_HOST, isPesa, pickTrip, inject };
});
