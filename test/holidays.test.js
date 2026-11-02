const assert = require("node:assert");
const { holiday, easter } = require("../web/holidays.js");

assert.strictEqual(holiday("2026-12-08"), "La Inmaculada");
assert.strictEqual(holiday("2026-12-25"), "Navidad");
assert.strictEqual(holiday("2027-01-01"), "Año Nuevo");
assert.strictEqual(holiday("2026-11-02"), null); // lunes normal
// Semana Santa 2026: Pascua el 5 de abril
assert.strictEqual(easter(2026).toISOString().slice(0, 10), "2026-04-05");
assert.strictEqual(holiday("2026-04-02"), "Jueves Santo");
assert.strictEqual(holiday("2026-04-03"), "Viernes Santo");
assert.strictEqual(holiday("2026-04-06"), "Lunes de Pascua");
// Pascua 2027: 28 de marzo; 2025: 20 de abril
assert.strictEqual(easter(2027).toISOString().slice(0, 10), "2027-03-28");
assert.strictEqual(easter(2025).toISOString().slice(0, 10), "2025-04-20");
console.log("OK festivos");
