# Lurraldebus · comparador de viajes

Web para consultar y **comparar** los autobuses de [Lurraldebus](https://lurraldebus.eus) (Gipuzkoa) entre dos
municipios. La web oficial solo enseña unos pocos resultados de las próximas horas; esta muestra **todos los
servicios del día**, con salida, llegada y duración claras, y deja compararlos entre líneas.

**Web:** https://andermena23.github.io/lurraldebus-viajes/

> Proyecto personal, no oficial y sin relación con Lurraldebus ni con la Diputación Foral de Gipuzkoa.

## Qué hace

- Origen y destino con autocompletado (sin tildes ni mayúsculas) y, opcionalmente, parada concreta. Las paradas
  ofrecidas son solo las que conectan ambos municipios.
- Todos los viajes del día, ordenables por salida, llegada o duración; filtro por línea; cada viaje se despliega
  con sus paradas intermedias.
- Pestaña **Comparar líneas**: gráfico de salidas a lo largo del día y tabla con servicios, frecuencia y duración
  mínima, media y máxima por línea.
- Combinaciones con **un trasbordo** cuando no hay directo (se ocultan las de más de 2 h de espera si hay
  alternativas).
- Día anterior/siguiente, Hoy/Mañana, "desde las" y "Ahora" en vivo (se actualiza cada minuto).
- Interruptor de **festivo** (aplica el horario de domingo).
- Tema claro, oscuro o automático. Recientes, enlaces compartibles y diseño pensado para móvil.
- Instalable como app y con los horarios disponibles **sin conexión** (PWA).

## De dónde salen los datos

Los **GTFS oficiales** de los 17 operadores de Lurraldebus, publicados en el
[Punto de Acceso Nacional de Transporte](https://nap.transportes.gob.es) (NAP, licencia abierta). El NAP exige API
key para descargar, así que `scripts/build_data.py` los baja del espejo diario de
[MobilityDatabase](https://mobilitydatabase.org) y los junta en `web/data/network.json` (unos 4 MB). En ese paso:

- se asigna cada parada a su municipio (por el prefijo del nombre, o por cercanía si no lo tiene) y se corrigen
  erratas del tipo "Hondarrbia";
- se guardan calendarios y horas en minutos, con las restricciones de subir/bajar de cada parada.

No hay backend: el navegador carga ese JSON y `web/search.js` hace la búsqueda ahí mismo.

### Limitaciones

- Son horarios programados, **sin tiempo real**: no se ven retrasos ni incidencias. Ante cambios, consulta la
  [web oficial](https://lurraldebus.eus).
- Los feeds no traen calendario de festivos (de ahí el interruptor manual).
- Los datos pueden diferir unos minutos de la web oficial en alguna línea (p. ej. DG04).
- Cobertura = lo que publica el NAP: casi todos los municipios del selector oficial; faltan los aeropuertos
  (aparecen como paradas dentro de Loiu y Hondarribia) y Arratzua-Ubarrundia.
- La llegada se cuenta en la primera parada del municipio destino; elige parada concreta si quieres otra.
- Si Lurraldebus añade un operador nuevo, hay que añadir su feed a mano en `FEEDS` (`scripts/build_data.py`).
- El script depende de la estructura de la página de MobilityDatabase; si cambia, habrá que adaptarlo.

## Desarrollo

```sh
python3 scripts/build_data.py     # refrescar datos (solo librería estándar)
python3 -m http.server -d web     # abrir http://localhost:8000
node test/search.test.js          # tests del motor de búsqueda
```

Estructura:

| Ruta | Contenido |
| --- | --- |
| `scripts/build_data.py` | descarga los GTFS y genera `web/data/network.json` |
| `web/search.js` | motor de búsqueda (directos + 1 trasbordo), sin dependencias; funciona en navegador y Node |
| `web/app.js`, `index.html`, `style.css`, `theme.js` | interfaz |
| `web/sw.js`, `manifest.webmanifest`, `icons/` | PWA |
| `test/search.test.js` | tests (las fechas son relativas a la vigencia de los datos) |

## Publicación

La web se publica con GitHub Pages desde `.github/workflows/pages.yml`: pasa los tests y despliega `web/`.

- En cada **push** a `main` publica lo que haya en el repo.
- Cada **día** (04:17 UTC) y bajo demanda vuelve a descargar los GTFS, guarda `network.json` en el repo si cambió y
  vuelve a publicar. Si la descarga o los tests fallan, no se despliega y sigue la versión anterior.

Sobre el caché offline: los datos se sirven "caché y actualizar", así que tras una actualización diaria puede hacer
falta abrir la app dos veces para ver los datos nuevos.

> El repositorio es privado, pero **el sitio de Pages es público** para cualquiera que tenga la URL.
