# Lurraldebus · comparador de viajes

Web estática para consultar y comparar los autobuses de Lurraldebus (Gipuzkoa) entre dos municipios:
**todos los servicios del día** (no solo las próximas 3 h como la web oficial), con hora de salida y llegada
claras, duración, tabla comparativa por línea, paradas intermedias y combinaciones con un trasbordo.

## Datos
Los GTFS oficiales de los 16 operadores de Lurraldebus, publicados en el Punto de Acceso Nacional de
Transporte (NAP, licencia abierta). El NAP exige API key, así que `scripts/build_data.py` los baja del
espejo diario de [MobilityDatabase](https://mobilitydatabase.org) y genera `web/data/network.json`.
Un workflow de GitHub Actions (`.github/workflows/update-data.yml`) lo regenera cada día y hace commit si cambia.

Limitaciones:
- Son horarios programados, **sin tiempo real**.
- Los feeds no traen calendario de festivos: hay un check "Festivo" que aplica el horario de domingo.
- Cobertura = lo que publica el NAP; hoy no incluye, por ejemplo, Bergara.
- La llegada se cuenta en la primera parada del municipio destino; elige parada concreta si quieres otra.

## Uso
```sh
python3 scripts/build_data.py     # opcional: refrescar datos (solo librería estándar)
python3 -m http.server -d web     # abrir http://localhost:8000
node test/search.test.js          # tests del motor de búsqueda
```
`web/` es 100 % estático: se puede desplegar en cualquier hosting estático (GitHub Pages en repos
privados requiere plan de pago; Cloudflare Pages / Netlify valen).
