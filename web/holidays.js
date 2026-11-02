/* Festivos habituales en Gipuzkoa. Los feeds de Lurraldebus no traen calendario de festivos (en festivo se aplica el
 * horario de domingo), así que se detectan aquí. Es una lista aproximada: nacionales, de Euskadi y Semana Santa; no incluye
 * festivos locales (San Sebastián, Aste Nagusia...) ni los que el Gobierno Vasco cambie cada año. Por eso la app solo
 * marca el festivo, sin impedir desmarcarlo.
 * Funciona en navegador (window.HOL) y en Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HOL = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const pad = (n) => String(n).padStart(2, "0");
  const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // m: 1-12

  // Domingo de Pascua (algoritmo anónimo gregoriano)
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, month - 1, day));
  }
  const shift = (d, n) => { const x = new Date(d.getTime() + n * 864e5); return key(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); };

  const cache = new Map();
  function year(y) {
    if (cache.has(y)) return cache.get(y);
    const e = easter(y);
    const h = new Map([
      [key(y, 1, 1), "Año Nuevo"], [key(y, 1, 6), "Reyes"], [key(y, 5, 1), "Día del Trabajo"],
      [key(y, 8, 15), "La Asunción"], [key(y, 10, 12), "Fiesta Nacional"], [key(y, 11, 1), "Todos los Santos"],
      [key(y, 12, 6), "Día de la Constitución"], [key(y, 12, 8), "La Inmaculada"], [key(y, 12, 25), "Navidad"],
      [shift(e, -3), "Jueves Santo"], [shift(e, -2), "Viernes Santo"], [shift(e, 1), "Lunes de Pascua"],
    ]);
    cache.set(y, h);
    return h;
  }

  /** Nombre del festivo para una fecha "YYYY-MM-DD", o null. */
  function holiday(dateStr) {
    const y = Number(dateStr.slice(0, 4));
    return year(y).get(dateStr) || null;
  }

  return { holiday, easter };
});
