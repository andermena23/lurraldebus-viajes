/* Compra en la web de venta de Pesa (online.pesa.net, grupo Avanza).
 * Pesa rechaza (403) los POST de otras webs y no admite el viaje en la URL, así que el viaje viaja en el "#" (no llega al servidor)
 * y un marcador (bookmarklet) del usuario, ejecutado en la propia página de Pesa, rellena su formulario.
 * Funciona en navegador (window.PESA) y en Node (module.exports) para poder probarlo.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PESA = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const URL = "https://online.pesa.net/index.asp?id=es";
  // Sin tildes ni mayúsculas, guiones como espacios y "itsaso"="itxaso" (los datos escriben Ezkio-Itsaso, Pesa EZKIO-ITXASO).
  const key = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-\s]+/g, " ").trim().replace("itsaso", "itxaso");
  // Orígenes/destinos de Pesa tal cual los envía su formulario ("código/NOMBRE"). Unos son municipios y otros paradas concretas
  // (SAN PRUDENTZIO es una parada de Arrasate, ARLABAN un puerto), y el billete hay que sacarlo desde la parada que toca.
  const STOPS = ["3/ABADIÑO", "130/AEROPUERTO BILBAO", "12/ALEGIA", "15/ANDOAIN", "7/ANTZUOLA", "24/ARETXABALETA", "26/ARLABAN",
    "23/ARRASATE-MONDRAGON", "43/ARROIABE", "84/ATXONDO", "10/BEASAIN", "6/BERGARA", "1/BILBAO", "20/DONOSTIA-SAN SEBASTIAN", "45/DURANA",
    "2/DURANGO", "19/EIBAR", "5/ELGETA", "21/ELGOIBAR", "4/ELORRIO", "18/ERMUA", "25/ESKORIATZA", "173/EZKIO-ITXASO", "174/IKAZTEGIETA",
    "176/ITSASONDO", "39/LANDA", "16/LASARTE", "175/LEGORRETA", "44/MENDIBIL", "32/OÑATI", "11/ORDIZIA", "9/ORMAIZTEGI", "33/SAN PRUDENTZIO",
    "22/SORALUZE-PLACEN", "13/TOLOSA", "42/ULLIBARRI GAMBOA", "14/VILLABONA", "30/VITORIA-GASTEIZ", "220/ZARAUTZ", "8/ZUMARRAGA-URRETXU"]
    .map((v) => ({ v, name: v.slice(v.indexOf("/") + 1), k: key(v.slice(v.indexOf("/") + 1)) }));
  const AIRPORT = STOPS.find((x) => x.k === "aeropuerto bilbao");

  // Parada de Pesa para una parada nuestra, o null si no hay equivalente. Primero por el nombre exacto de la parada (San Prudentzio
  // está en Arrasate pero Pesa la vende aparte), luego por municipio (nombre completo o una de sus palabras: "Arrasate" = ARRASATE-MONDRAGON, "Urretxu" = ZUMARRAGA-URRETXU).
  function stopFor(muni, stop) {
    const s = key(stop);
    if (/bilboko aireportua|aeropuerto bilbao/.test(s)) return AIRPORT;
    const byStop = STOPS.find((x) => x.k === s);
    if (byStop) return byStop;
    const m = key(muni);
    return STOPS.find((x) => x !== AIRPORT && (x.k === m || x.k.split(" ").includes(m) || m.startsWith(x.k + " "))) || null;
  }

  // Se ejecuta EN la página de Pesa (como marcador): lee el viaje del "#" y rellena origen, fecha, tarjeta y destino.
  // Debe ser autónoma: se serializa con toString().
  function fill() {
    var p = new URLSearchParams(location.hash.slice(1));
    var o = p.get("lbo"), d = p.get("lbd"), f = p.get("lbf"), t = p.get("lbt") || "";
    var $ = function (id) { return document.getElementById(id); };
    if (!o || !d || !f || !$("selectOri")) { alert("Abre esta página desde el botón «Comprar» del comparador para que haya un viaje que rellenar."); return; }
    $("fechaI").value = f;
    if (t) $("tarjeta").value = t;
    var so = $("selectOri");
    so.value = o;
    if (so.value !== o) { alert("Pesa no ofrece el origen «" + o.split("/")[1] + "»."); return; }
    so.dispatchEvent(new Event("change")); // carga los destinos posibles (por XHR) y muestra la tarjeta
    var n = 0, w = setInterval(function () {
      var sd = $("selectDes");
      if (sd && !sd.disabled && [].some.call(sd.options, function (x) { return x.value === d; })) { sd.value = d; clearInterval(w); }
      else if (++n > 40) { clearInterval(w); alert("Pesa no ofrece ese destino en esa fecha."); }
    }, 150);
  }
  const bookmarklet = "javascript:" + encodeURIComponent("(" + fill.toString() + ")()");

  // URL de Pesa con el viaje en el "#". from/to: resultados de stopFor; date: "YYYY-MM-DD"; mugi: número de tarjeta o "".
  function url(from, to, date, mugi) {
    const [yy, mm, dd] = date.split("-");
    return URL + "#" + new URLSearchParams({ lbo: from.v, lbd: to.v, lbf: `${dd}/${mm}/${yy}`, lbt: mugi.replace(/\s/g, "") });
  }

  return { URL, stopFor, bookmarklet, url };
});
