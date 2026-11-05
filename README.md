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
  con sus paradas intermedias, el **sentido** del bus («→ Hondarribia»), las paradas intermedias de **solo subida o solo
  bajada** y, en el último tramo, las otras paradas del municipio destino por las que sigue el mismo autobús.
- Pestaña **Comparar líneas**: gráfico de salidas a lo largo del día y tabla con servicios, frecuencia y duración
  mínima, media y máxima por línea (o por combinación de líneas si solo hay trasbordos).
- Combinaciones con **un trasbordo** cuando no hay directo (se ocultan las de más de 2 h de espera si hay
  alternativas, con un botón para verlas todas).
- **Horario de una línea** completo (como la pestaña «Líneas» de la web oficial): un cuadro por sentido con todas las
  paradas y todos los viajes del día.
- **Líneas a demanda** (código acabado en E: TO22E, GO21E...): marcadas como «A demanda» con el teléfono y la antelación
  necesarios, y excluidas de «Próximo»; se pueden ocultar desde Más opciones.
- **Tarifa orientativa** entre los dos municipios (saltos de zona, precio con MUGI y billete ocasional).
- **Tiempo real** al desplegar un viaje de hoy: minutos hasta tu parada, retraso, ocupación y posición aproximada
  («ahora entre X e Y», con barra de progreso), consultando el tablero oficial a través de un proxy propio. Se mantiene
  el botón «Tiempo real» que abre lurraldebus.eus en esa parada, además del **mapa** del tramo
  (OpenStreetMap, se carga solo al pedirlo), teléfono y web del operador, y **avisos oficiales** (paradas suprimidas...)
  en los viajes de las líneas afectadas.
- Día anterior/siguiente, Hoy/Mañana, "desde las" y "Ahora" en vivo (se actualiza cada minuto).
- **Festivo** (aplica el horario de domingo): se marca solo en los festivos habituales (`web/holidays.js`: nacionales,
  Semana Santa y Euskadi; sin festivos locales) y se puede cambiar a mano.
- **Viajes guardados**: la estrella ☆ guarda la ruta (con las paradas que hayas elegido) y aparece en una tira bajo el
  buscador para abrirla con un toque. Se guardan en el navegador, no se sincronizan entre dispositivos.
- **Comprar billetes**: en los tramos de Pesa (largo recorrido) el botón «Comprar en Avanza» copia tu número de MUGI (se
  guarda en el navegador desde el engranaje de Ajustes) y abre la web de venta, indicando origen, destino y fecha con los
  nombres de Pesa (p. ej. San Prudentzio se compra desde San Prudentzio, no desde Arrasate). Pesa no admite rellenar el viaje
  desde fuera (rechaza los POST de otras webs y no acepta el viaje en la URL), así que el resto se elige a mano en su web.
- Tema claro, oscuro o automático. Recientes, enlaces compartibles y diseño pensado para móvil.
- Instalable como app y con los horarios disponibles **sin conexión** (PWA).

## De dónde salen los datos

Los **GTFS oficiales** de los 17 operadores de Lurraldebus, publicados en el
[Punto de Acceso Nacional de Transporte](https://nap.transportes.gob.es) (NAP, licencia abierta). El NAP exige API
key para descargar, así que `scripts/build_data.py` los baja del espejo diario de
[MobilityDatabase](https://mobilitydatabase.org) y los junta en `web/data/network.json` (unos 4 MB). En ese paso:

- se asigna cada parada a su municipio (por el prefijo del nombre, o por cercanía si no lo tiene) y se corrigen
  erratas del tipo "Hondarrbia";
- se guardan calendarios y horas en minutos (los segundos se **redondean**: 16:46:59 es la 16:47), con las
  restricciones de subir/bajar de cada parada;
- se marcan las líneas a demanda, se guarda la vigencia de cada operador (los urbanos caducan antes) y los datos de
  contacto del operador;
- se comprueba qué paradas tienen **tiempo real** en lurraldebus.eus (código oficial = `stop_id`) y se copian los
  **avisos oficiales** (opcional: si esa web falla, se conserva lo anterior y no se bloquea la build);
- se verifica el resultado antes de escribirlo: si algún feed llega vacío o los viajes/paradas/municipios caen más de un
  20 % respecto a la versión anterior, la build falla y no se publica. Las descargas se reintentan.

Las **tarifas** (`web/data/fares.json`) salen de la web oficial con `python3 scripts/build_fares.py`; cambian como mucho una
vez al año, así que no se actualizan a diario (ejecútalo a mano cuando cambien).

No hay backend: el navegador carga ese JSON y `web/search.js` hace la búsqueda ahí mismo.

## Tiempo real

El tablero oficial (`https://lurraldebus.eus/real/result/{municipio}/{parada}`) devuelve la línea, el destino, la
ocupación y los minutos que faltan para cada bus. No envía cabeceras CORS, así que el navegador no puede leerlo
directamente desde GitHub Pages. Para eso está el **Cloudflare Worker** de `worker/`:

- `GET /health` comprueba que está desplegado.
- `GET /board?muni=<idMunicipio>&stop=<idParada>` reenvía la consulta y devuelve solo la tabla de llegadas.
- Cachea 15 s en memoria para no golpear al servidor oficial si varios clientes miran la misma parada.
- Las cabeceras `X-RT-Time` / `X-RT-Now` indican a qué instante corresponden los minutos, sin depender del reloj del móvil.

`web/realtime.js` parsea la tabla, casa cada fila con el viaje del horario (línea + hora prevista + sentido) y consulta
unas cuantas paradas alrededor de la posición esperada para estimar el tramo actual. El panel «EN VIVO» aparece al
desplegar un viaje de hoy y se refresca cada 30 s solo si el viaje sigue abierto y la pestaña está visible. La URL del
proxy se configura en **Ajustes** o se inyecta al publicar desde la variable de repositorio `RT_PROXY_URL`; si no hay
proxy, el panel no aparece y queda el botón de la web oficial.

El Worker se despliega con `.github/workflows/worker.yml` al cambiar `worker/**` (o a mano con `workflow_dispatch`).
Necesita los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`. También se puede lanzar en local:

```sh
python3 scripts/dev_proxy.py     # http://localhost:8931; la web lo usa sola en localhost
```

### Limitaciones del tiempo real

- **No hay posición GPS pública.** Lurraldebus solo publica llegadas por parada; la posición es una estimación y puede
  fallar en líneas con varios autobuses de la misma línea cerca.
- Solo se muestra para viajes de hoy y paradas con tablero oficial. Si la web oficial cambia su HTML, el panel cae al
  horario programado o muestra «sin datos».
- El retraso se deduce de casar la hora prevista del tablero con la programada; un autobús muy retrasado puede
  confundirse con el siguiente de la misma línea.

### Limitaciones

- Los horarios de la app son programados. El panel en vivo usa el tablero oficial, pero solo para viajes de hoy y
  paradas con tablero; ante cambios o incidencias, consulta la [web oficial](https://lurraldebus.eus).
- Las horas de las paradas intermedias son estimaciones del operador (en los feeds ninguna parada está marcada como
  horaria).
- Los feeds no traen calendario de festivos: la lista de `web/holidays.js` es aproximada (sin festivos locales) y se puede
  desmarcar a mano.
- Los horarios de los operadores **urbanos** de Zarautz, Eibar, Arrasate, Hernani, Tolosa, Errenteria y Oiartzun solo
  llegan hasta el 31/12/2026; la app lo avisa para fechas posteriores.
- No se saben qué paradas son «a demanda» dentro de una línea regular, ni los servicios especiales (sidrerías, fiestas).
- La tarifa es orientativa: no cubre trasbordos ni líneas con tarifa propia, y faltan algunos municipios sin zona oficial
  (Loiu, Durana, Arroiabe, Ullibarri-Gamboa, Landa, Mendibil).
- El recorrido del mapa une las paradas en línea recta (no se usan los `shapes.txt`, que pesan varios MB).
- Los datos pueden diferir unos minutos de la web oficial en alguna línea (p. ej. DG04).
- Cobertura = lo que publica el NAP: casi todos los municipios del selector oficial; faltan los aeropuertos
  (aparecen como paradas dentro de Loiu y Hondarribia) y Arratzua-Ubarrundia.
- La llegada se cuenta en la primera parada del municipio destino; elige parada concreta si quieres otra.
- Si Lurraldebus añade un operador nuevo, hay que añadir su feed a mano en `FEEDS` (`scripts/build_data.py`).
- El script depende de la estructura de la página de MobilityDatabase; si cambia, habrá que adaptarlo.

## Desarrollo

```sh
python3 scripts/build_data.py     # refrescar datos (solo librería estándar)
python3 scripts/build_fares.py    # refrescar tarifas (cuando cambien)
python3 scripts/dev_proxy.py      # proxy local del tiempo real (http://localhost:8931)
python3 -m http.server -d web     # abrir http://localhost:8000
for t in data search realtime pesa holidays fares; do node test/$t.test.js; done
```

Estructura:

| Ruta | Contenido |
| --- | --- |
| `scripts/build_data.py` | descarga los GTFS y genera `web/data/network.json` |
| `scripts/build_fares.py` | zonas y tarifas oficiales -> `web/data/fares.json` |
| `web/search.js` | motor de búsqueda (directos + 1 trasbordo) y horario de línea, sin dependencias; funciona en navegador y Node |
| `web/realtime.js` | tablero oficial: parser, casado con el horario y estimación de posición/retraso |
| `worker/` | proxy CORS en Cloudflare Worker (`/health`, `/board`) |
| `scripts/dev_proxy.py` | el mismo proxy en local para desarrollo |
| `web/holidays.js`, `web/fares.js` | festivos habituales y tarifa por saltos de zona |
| `web/app.js`, `index.html`, `style.css`, `theme.js` | interfaz |
| `web/sw.js`, `manifest.webmanifest`, `icons/` | PWA |
| `web/pesa.js` | compra en Pesa: emparejar nuestras paradas con las suyas |
| `test/*.test.js` | tests (las fechas son relativas a la vigencia de los datos) |

## Publicación

La web se publica con GitHub Pages desde `.github/workflows/pages.yml`: pasa los tests y despliega `web/`.

- En cada **push** a `main` publica lo que haya en el repo.
- Cada **día** (04:17 UTC) y bajo demanda vuelve a descargar los GTFS, guarda `network.json` en el repo si cambió y
  vuelve a publicar. Si la descarga o los tests fallan, no se despliega y sigue la versión anterior.
- Para el tiempo real, el workflow sustituye `__RT_PROXY__` en `web/realtime.js` por la variable `RT_PROXY_URL` (por
  ejemplo `https://lurraldebus-rt.<subdominio>.workers.dev`). El Worker se despliega aparte con `worker.yml`.

Sobre el caché offline: los datos se sirven "caché y actualizar", así que tras una actualización diaria puede hacer
falta abrir la app dos veces para ver los datos nuevos.

> El repositorio es privado, pero **el sitio de Pages es público** para cualquiera que tenga la URL.
