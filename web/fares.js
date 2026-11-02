/* Tarifa orientativa de Lurraldebus entre dos municipios: zona de cada uno -> saltos -> precio (datos de data/fares.json,
 * generados por scripts/build_fares.py desde la web oficial). Funciona en navegador (window.FARES) y en Node.
 * No cubre trasbordos ni líneas con tarifa propia: es una referencia, el precio manda en la web oficial.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FARES = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function create(f) {
    const zoneOf = new Map(Object.entries(f.towns).map(([k, v]) => [norm(k.split("/")[0]), v]));
    const price = (re) => f.prices[Object.keys(f.prices).find((k) => re.test(k))];
    const occasional = price(/^Ocasional/), mugi = price(/Tramo 1/), night = price(/^Nocturno/);

    /** { jumps, zones:[a,b], ocasional, mugi, night } (euros) o null si no hay tarifa para ese par. */
    function fare(muniA, muniB) {
      const a = zoneOf.get(norm(muniA)), b = zoneOf.get(norm(muniB));
      if (a == null || b == null) return null;
      const jumps = f.jumps[a][b];
      if (jumps == null || jumps >= occasional.length) return null;
      return { jumps, zones: [f.zones[a], f.zones[b]], ocasional: occasional[jumps], mugi: mugi[jumps], night: night[jumps] };
    }
    return { fare, zoneOf: (m) => { const z = zoneOf.get(norm(m)); return z == null ? null : f.zones[z]; } };
  }

  const eur = (x) => x.toFixed(2).replace(".", ",") + " €";
  return { create, eur };
});
