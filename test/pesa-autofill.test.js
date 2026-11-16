const assert = require("node:assert");
const fs = require("node:fs");
const A = require("../web/pesa-autofill.js");
const html = fs.readFileSync(__dirname + "/fixture/pesa-results.html", "utf8");
// Respuesta real de online.pesa.net para Donostia → Bilbao el 17/11/2026 (solo se recortaron los servicios).
const spec = { o: "20/DONOSTIA-SAN SEBASTIAN", d: "1/BILBAO", f: "17/11/2026", h: "07:30", t: "1234567890" };

// El casado usa la hora de salida (horaI{n}) y valida fecha y código de origen del radio elegido{n}.
assert.strictEqual(A.pickTrip(html, spec), 4);
assert.strictEqual(A.pickTrip(html, { ...spec, h: "8:00" }), 5); // acepta 8:00 y 08:00
assert.strictEqual(A.pickTrip(html, { ...spec, h: "08:30" }), 6);
assert.strictEqual(A.pickTrip(html, { ...spec, h: "12:45" }), null); // hora inexistente
assert.strictEqual(A.pickTrip(html, { ...spec, f: "18/11/2026" }), null); // otra fecha
assert.strictEqual(A.pickTrip(html, { ...spec, o: "1/BILBAO" }), null); // otro origen
assert.strictEqual(A.pickTrip(html, { ...spec, h: "" }), null);

// La inyección deja la página de Pesa tal cual y añade el runner justo antes del </body>, con el viaje serializado.
const page = "<html><body><form name='miform'></form></body></html>";
const injected = A.inject(page, spec);
assert(injected.startsWith("<html><body>"));
assert(injected.includes("<form name='miform'></form>"));
assert(injected.includes(JSON.stringify(spec)));
assert(injected.includes("elegido")); // el runner sabe marcar el radio de resultados
assert(injected.indexOf("<script>") < injected.toLowerCase().indexOf("</body>"));
// El script serializado tiene que ser JavaScript válido y no cerrar la etiqueta <script> antes de tiempo.
const code = injected.match(/<script>([\s\S]*)<\/script>/)[1];
assert.doesNotThrow(() => new Function(code));
assert.strictEqual(/<\/script>/.test(code), false);
assert.strictEqual(A.isPesa(new URL("https://online.pesa.net/index.asp?id=es")), true);
assert.strictEqual(A.isPesa(new URL("https://lurraldebus.eus/")), false);
console.log("OK pesa-autofill");
