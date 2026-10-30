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
  // Orígenes/destinos de Pesa tal cual los muestra su formulario. Unos son municipios y otros paradas concretas
  // (SAN PRUDENTZIO es una parada de Arrasate, ARLABAN un puerto), y el billete hay que sacarlo desde la parada que toca.
  const STOPS = ["ABADIÑO", "AEROPUERTO BILBAO", "ALEGIA", "ANDOAIN", "ANTZUOLA", "ARETXABALETA", "ARLABAN",
    "ARRASATE-MONDRAGON", "ARROIABE", "ATXONDO", "BEASAIN", "BERGARA", "BILBAO", "DONOSTIA-SAN SEBASTIAN", "DURANA",
    "DURANGO", "EIBAR", "ELGETA", "ELGOIBAR", "ELORRIO", "ERMUA", "ESKORIATZA", "EZKIO-ITXASO", "IKAZTEGIETA",
    "ITSASONDO", "LANDA", "LASARTE", "LEGORRETA", "MENDIBIL", "OÑATI", "ORDIZIA", "ORMAIZTEGI", "SAN PRUDENTZIO",
    "SORALUZE-PLACEN", "TOLOSA", "ULLIBARRI GAMBOA", "VILLABONA", "VITORIA-GASTEIZ", "ZARAUTZ", "ZUMARRAGA-URRETXU"]
    .map((name) => ({ name, k: key(name) }));
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

  return { URL, stopFor };
});
