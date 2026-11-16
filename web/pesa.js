/* Compra en la web de venta de Pesa (online.pesa.net, grupo Avanza): emparejar nuestras paradas con las suyas.
 * Pesa no se puede rellenar desde fuera (rechaza con 403 los POST de otras webs y no admite el viaje en la URL), así que solo
 * se indica qué elegir allí, con sus nombres. Funciona en navegador (window.PESA) y en Node (module.exports) para poder probarlo.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PESA = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const URL = "https://online.pesa.net/index.asp?id=es";
  // Sin tildes ni mayúsculas, guiones como espacios y "itsaso"="itxaso" (los datos escriben Ezkio-Itsaso, Pesa EZKIO-ITXASO).
  const key = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-\s]+/g, " ").trim().replace("itsaso", "itxaso");
  // Orígenes/destinos de Pesa tal cual los envía su formulario ("código/NOMBRE"). Unos son municipios y otros paradas
  // concretas (SAN PRUDENTZIO es de Arrasate, ARLABAN un puerto), y el billete hay que sacarlo desde la parada que toca.
  // El código hace falta para rellenar el formulario desde el comparador (web/pesa-autofill.js).
  const STOPS = ["3/ABADIÑO", "130/AEROPUERTO BILBAO", "12/ALEGIA", "15/ANDOAIN", "7/ANTZUOLA", "24/ARETXABALETA",
    "26/ARLABAN", "23/ARRASATE-MONDRAGON", "43/ARROIABE", "84/ATXONDO", "10/BEASAIN", "6/BERGARA", "1/BILBAO",
    "20/DONOSTIA-SAN SEBASTIAN", "45/DURANA", "2/DURANGO", "19/EIBAR", "5/ELGETA", "21/ELGOIBAR", "4/ELORRIO",
    "18/ERMUA", "25/ESKORIATZA", "173/EZKIO-ITXASO", "174/IKAZTEGIETA", "176/ITSASONDO", "39/LANDA", "16/LASARTE",
    "175/LEGORRETA", "44/MENDIBIL", "32/OÑATI", "11/ORDIZIA", "9/ORMAIZTEGI", "33/SAN PRUDENTZIO",
    "22/SORALUZE-PLACEN", "13/TOLOSA", "42/ULLIBARRI GAMBOA", "14/VILLABONA", "30/VITORIA-GASTEIZ", "220/ZARAUTZ",
    "8/ZUMARRAGA-URRETXU"]
    .map((v) => ({ code: v, name: v.slice(v.indexOf("/") + 1), k: key(v.slice(v.indexOf("/") + 1)) }));
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

  // Líneas con venta online en Pesa. Es la lista deducida de las paradas del formulario de Pesa (largo recorrido: Donostia-Bilbao,
  // Donostia-Vitoria, aeropuerto...), no una lista oficial: hay que confirmarla en online.pesa.net. Las comarcales (DG10...),
  // las a demanda (acabadas en E) y las nocturnas no se venden ahí.
  const LINES = ["DO01", "DO02", "DO03", "DO04", "DG01", "DG02", "DG05", "DG05A", "DG05D", "DG07", "DG12"];
  const lineKey = (t) => String(t || "").toLowerCase().replace(/\s+/g, "");
  const LINE_KEYS = new Set(LINES.map(lineKey));

  // ¿Se puede comprar este tramo en Pesa? Devuelve las paradas de Pesa de origen y destino, o null. Hace falta que la línea tenga
  // venta online, que no sea a demanda y que las dos paradas existan en Pesa y sean distintas (Zumarraga→Urretxu cae en la misma).
  function canBuy({ line, demand, from, to }) {
    if (demand || !LINE_KEYS.has(lineKey(line))) return null;
    const a = from && stopFor(from.muni, from.stop), b = to && stopFor(to.muni, to.stop);
    return a && b && a !== b ? { from: a, to: b } : null;
  }

  return { URL, LINES, stopFor, canBuy };
});
