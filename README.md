# Lurraldebus · comparador de viajes

Web para consultar y **comparar** los autobuses de [Lurraldebus](https://lurraldebus.eus) (Gipuzkoa) entre dos
municipios. La web oficial solo enseña unos pocos resultados de las próximas horas; esta muestra **todos los
servicios del día**, con salida, llegada y duración claras, y deja compararlos entre líneas.

**Web:** https://andermena23.github.io/lurraldebus-viajes/

> Proyecto personal, no oficial y sin relación con Lurraldebus ni con la Diputación Foral de Gipuzkoa.

## Índice

- [Qué hace](#qué-hace)
- [Cómo funciona](#cómo-funciona)
- [Datos](#datos)
- [Tiempo real](#tiempo-real)
- [Desarrollo](#desarrollo)
- [Publicación](#publicación)
- [Limitaciones](#limitaciones)

## Qué hace

### Buscar un viaje

- **Origen y destino** con autocompletado (sin tildes ni mayúsculas) y, opcionalmente, **parada concreta** (debajo de
  cada municipio; solo aparece si hay donde elegir). Las paradas ofrecidas son solo las que conectan ambos municipios.
- **Todos los viajes del día**, ordenables por salida, llegada o duración, con filtro por línea.
- **Trasbordos mezclados con los directos**, en el mismo orden y con la etiqueta «1 cambio en …» y borde discontinuo, para
  que nunca parezca que no hay viaje a una hora que sí lo tiene. Se descartan las combinaciones peores que un directo y
  las de más de 2 h de espera; si aún son muchas, se muestran las 40 más rápidas. Un botón permite verlas todas.
- **Filtros siempre visibles** bajo el buscador: *Trasbordos*, *A demanda* y *Festivo*. «Con trasbordos / Solo directos»
  también está sobre los resultados, para cambiarlo sin abrir el formulario en móvil.
- **Día y hora**: anterior/siguiente, Hoy/Mañana, «Desde las» y «Ahora» en vivo (se actualiza cada minuto).
- **Festivo** (aplica el horario de domingo): se marca solo en los festivos habituales (`web/holidays.js`: nacionales,
  Semana Santa y Euskadi; sin festivos locales) y se puede cambiar a mano.

### Cada viaje

Se despliega con sus paradas intermedias, el **sentido** del bus («→ Hondarribia»), las paradas de **solo subida o solo
bajada** y, en el último tramo, las otras paradas del municipio destino por las que sigue el mismo autobús. Además:

- **Tarifa orientativa** entre los dos municipios (saltos de zona, precio con MUGI y billete ocasional).
- **Mapa** del tramo (OpenStreetMap, se carga solo al pedirlo), teléfono y web del operador.
- **Avisos oficiales** (paradas suprimidas...) en los viajes de las líneas afectadas.
- **Líneas a demanda** (código acabado en E: TO22E, GO21E...): marcadas como «A demanda» con el teléfono y la antelación
  necesarios, y excluidas de «Próximo». Se pueden ocultar con el filtro *A demanda*.
- **Tiempo real** al desplegar un viaje de hoy (ver [Tiempo real](#tiempo-real)), además del botón «Tiempo real» que abre
  lurraldebus.eus en esa parada.
- **Comprar billetes**: en los tramos de Pesa (largo recorrido), «Comprar en Avanza» copia tu número de MUGI (se guarda
  en el navegador desde el engranaje de Ajustes) y abre la web de venta, indicando origen, destino y fecha con los
  nombres de Pesa (p. ej. San Prudentzio se compra desde San Prudentzio, no desde Arrasate). Pesa no admite rellenar el
  viaje desde fuera (rechaza los POST de otras webs y no acepta el viaje en la URL), así que el resto se elige a mano.

### Comparar y consultar líneas

- Pestaña **Comparar líneas**: gráfico de salidas a lo largo del día y tabla con servicios, frecuencia y duración
  mínima, media y máxima por línea (o por combinación de líneas si solo hay trasbordos).
- **Horario de una línea** completo (como la pestaña «Líneas» de la web oficial): un cuadro por sentido con todas las
  paradas y todos los viajes del día.

### Comodidad

- **Viajes guardados**: la estrella ☆ guarda la ruta (con las paradas elegidas) y aparece en una tira bajo el buscador
  para abrirla con un toque. Junto a los **recientes**, se guardan en el navegador y no se sincronizan entre dispositivos.
- **Enlaces compartibles**: la búsqueda completa va en la URL.
- Tema claro, oscuro o automático, y diseño pensado para móvil.
- **Instalable como app** y con los horarios disponibles **sin conexión** (PWA).

## Cómo funciona

No hay backend. El esquema es:

```
GTFS de 17 operadores ──(scripts/build_data.py)──▶ web/data/network.json ──▶ navegador (web/search.js)
                                                                                  │
tablero oficial lurraldebus.eus ──▶ Cloudflare Worker (worker/) ──▶ web/realtime.js ┘ (solo viajes de hoy)
```

El navegador descarga `network.json` y `web/search.js` hace la búsqueda ahí mismo (funciona también en Node, por eso es
fácil de probar). Lo único que necesita un servicio aparte es el tiempo real, porque el tablero oficial no envía
cabeceras CORS.

## Datos

Los **GTFS oficiales** de los 17 operadores de Lurraldebus, publicados en el
[Punto de Acceso Nacional de Transporte](https://nap.transportes.gob.es) (NAP, licencia abierta). El NAP exige API
key para descargar, así que `scripts/build_data.py` los baja del espejo diario de
[MobilityDatabase](https://mobilitydatabase.org) y los junta en `web/data/network.json` (unos 4 MB). Solo usa la
librería estándar y reintenta las descargas.

### Qué hace la build

- Asigna cada parada a su municipio (por el prefijo del nombre, o por cercanía si no lo tiene) y corrige erratas del
  tipo «Hondarrbia».
- Guarda calendarios y horas en minutos (los segundos se **redondean**: 16:46:59 es la 16:47), con las restricciones de
  subir/bajar de cada parada.
- Marca las líneas a demanda, guarda la vigencia de cada operador (los urbanos caducan antes) y sus datos de contacto.
- Comprueba qué paradas tienen **tiempo real** en lurraldebus.eus (código oficial = `stop_id`) y copia los **avisos
  oficiales**. Es opcional: si esa web falla, se conserva lo anterior y no se bloquea la build.

### Comprobaciones antes de escribir

La build falla, sin tocar `network.json`, si:

- algún feed llega **sin viajes**;
- los viajes, paradas o municipios caen **más de un 20 %** respecto a la versión anterior;
- alguna **línea con 10 o más viajes pierde más de la mitad** de ellos. Esto detecta feeds truncados que el control
  global no ve: así se perdieron los 68 viajes de GO07 entre semana (solo un 6 % del total) cuando el espejo publicó un
  zip incompleto. Si la bajada es real (fin de temporada, línea suprimida), se repite con `--accept-drops`.

Ante un fallo así, la web sigue con los datos anteriores (ver [Publicación](#publicación)). Si es el espejo el que tiene
el feed roto, conviene comparar con la web oficial antes de forzar nada.

### Tarifas

`web/data/fares.json` sale de la web oficial con `python3 scripts/build_fares.py`. Cambian como mucho una vez al año, así
que no se actualizan a diario: ejecútalo a mano cuando cambien.

## Tiempo real

El tablero oficial (`https://lurraldebus.eus/real/result/{municipio}/{parada}`) devuelve la línea, el destino, la
ocupación y los minutos que faltan para cada bus. No envía cabeceras CORS, así que el navegador no puede leerlo desde
GitHub Pages. Para eso está el **Cloudflare Worker** de `worker/`:

| Endpoint | Qué hace |
| --- | --- |
| `GET /health` | Comprueba que está desplegado. |
| `GET /board?muni=<idMunicipio>&stop=<idParada>` | Reenvía la consulta y devuelve solo la tabla de llegadas. |

- Cachea 15 s en memoria, para no golpear al servidor oficial si varios clientes miran la misma parada.
- Las cabeceras `X-RT-Time` / `X-RT-Now` indican a qué instante corresponden los minutos, sin depender del reloj del
  móvil.

`web/realtime.js` parsea la tabla, casa cada fila con el viaje del horario (línea + hora prevista + sentido) y consulta
unas cuantas paradas alrededor de la posición esperada para estimar el tramo actual. El panel «EN VIVO» muestra los
minutos hasta tu parada, el retraso, la ocupación y la posición aproximada («ahora entre X e Y», con barra de progreso).
Aparece al desplegar un viaje de hoy y se refresca cada 30 s solo si el viaje sigue abierto y la pestaña está visible.

### Configurar el proxy

- **En producción**: la URL se inyecta al publicar desde la variable de repositorio `RT_PROXY_URL`.
- **Por usuario**: se puede indicar en **Ajustes** (engranaje).
- **En local**: `python3 scripts/dev_proxy.py` levanta el mismo proxy en http://localhost:8931, y la web lo usa sola en
  localhost.

Si no hay proxy, el panel no aparece y queda el botón de la web oficial.

El Worker se despliega con `.github/workflows/worker.yml` al cambiar `worker/**` (o a mano con `workflow_dispatch`) y
necesita los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`. Más detalles en `worker/README.md`.

## Desarrollo

```sh
python3 scripts/build_data.py     # refrescar datos (--accept-drops si una línea pierde viajes de verdad)
python3 scripts/build_fares.py    # refrescar tarifas (cuando cambien)
python3 scripts/dev_proxy.py      # proxy local del tiempo real
python3 -m http.server -d web     # abrir http://localhost:8000
for t in data search realtime pesa holidays fares; do node test/$t.test.js; done
```

Las fechas de los tests son relativas a la vigencia de los datos.

| Ruta | Contenido |
| --- | --- |
| `scripts/build_data.py` | Descarga los GTFS y genera `web/data/network.json`. |
| `scripts/build_fares.py` | Zonas y tarifas oficiales → `web/data/fares.json`. |
| `scripts/dev_proxy.py` | El proxy del tiempo real en local, para desarrollo. |
| `web/search.js` | Motor de búsqueda (directos + 1 trasbordo) y horario de línea; sin dependencias, funciona en navegador y Node. |
| `web/realtime.js` | Tablero oficial: parser, casado con el horario y estimación de posición/retraso. |
| `web/holidays.js`, `web/fares.js` | Festivos habituales y tarifa por saltos de zona. |
| `web/pesa.js` | Compra en Pesa: emparejar nuestras paradas con las suyas. |
| `web/app.js`, `index.html`, `style.css`, `theme.js` | Interfaz. |
| `web/sw.js`, `manifest.webmanifest`, `icons/` | PWA. |
| `worker/` | Proxy CORS en Cloudflare Worker (`/health`, `/board`). |
| `test/*.test.js` | Tests. |

## Publicación

La web se publica con GitHub Pages desde `.github/workflows/pages.yml`: pasa los tests y despliega `web/`. El repositorio
y el sitio son públicos.

| Cuándo | Qué hace |
| --- | --- |
| **Push** a `main` | Publica lo que haya en el repo, sin volver a bajar datos. |
| **Cada día** (04:17 UTC) o bajo demanda | Vuelve a descargar los GTFS, guarda `network.json` en el repo si cambió y publica. |

- Si la actualización de datos **no pasa las comprobaciones** (feed roto), el workflow avisa con un *warning* y sigue
  publicando el `network.json` que ya hay en el repo, en vez de dejar la web sin desplegar. Ojo: al ser solo un aviso,
  conviene mirar de vez en cuando las ejecuciones del workflow.
- Si **fallan los tests**, no se despliega y sigue la versión anterior.
- Para el tiempo real, el workflow sustituye `__RT_PROXY__` en `web/realtime.js` por la variable `RT_PROXY_URL` (por
  ejemplo `https://lurraldebus-rt.<subdominio>.workers.dev`). El Worker se despliega aparte con `worker.yml`.
- Los archivos estáticos se versionan con el commit (`?v=<sha>`) para que los navegadores no sirvan CSS/JS viejos.

Sobre el caché offline: los datos se sirven «caché y actualizar», así que tras una actualización diaria puede hacer
falta abrir la app dos veces para ver los datos nuevos.

## Limitaciones

### Horarios y cobertura

- Los horarios son **programados**; ante cambios o incidencias, consulta la [web oficial](https://lurraldebus.eus).
- Las horas de las paradas intermedias son estimaciones del operador (en los feeds ninguna parada está marcada como
  horaria). En alguna línea (p. ej. DG04) los datos pueden diferir unos minutos de la web oficial.
- Los horarios de los operadores **urbanos** de Zarautz, Eibar, Arrasate, Hernani, Tolosa, Errenteria y Oiartzun solo
  llegan hasta el 31/12/2026; la app lo avisa para fechas posteriores.
- Los feeds no traen calendario de festivos: la lista de `web/holidays.js` es aproximada (sin festivos locales) y se
  puede desmarcar a mano.
- No se sabe qué paradas son «a demanda» dentro de una línea regular, ni los servicios especiales (sidrerías, fiestas).
- Cobertura = lo que publica el NAP: casi todos los municipios del selector oficial. Faltan los aeropuertos (aparecen
  como paradas dentro de Loiu y Hondarribia) y Arratzua-Ubarrundia.
- La llegada se cuenta en la primera parada del municipio destino; elige parada concreta si quieres otra.
- Solo se combina **un trasbordo** como máximo.

### Tiempo real

- **No hay posición GPS pública.** Lurraldebus solo publica llegadas por parada; la posición es una estimación y puede
  fallar en líneas con varios autobuses de la misma línea cerca.
- Solo se muestra para viajes de hoy y paradas con tablero oficial. Si la web oficial cambia su HTML, el panel cae al
  horario programado o muestra «sin datos».
- El retraso se deduce de casar la hora prevista del tablero con la programada; un autobús muy retrasado puede
  confundirse con el siguiente de la misma línea.

### Tarifas y mapa

- La tarifa es orientativa: no cubre trasbordos ni líneas con tarifa propia, y faltan algunos municipios sin zona oficial
  (Loiu, Durana, Arroiabe, Ullibarri-Gamboa, Landa, Mendibil).
- El recorrido del mapa une las paradas en línea recta (no se usan los `shapes.txt`, que pesan varios MB).

### Mantenimiento

- Si Lurraldebus añade un operador nuevo, hay que añadir su feed a mano en `FEEDS` (`scripts/build_data.py`).
- `build_data.py` depende de la estructura de la página de MobilityDatabase (de ahí saca el último zip de cada feed); si
  cambia, habrá que adaptarlo. El espejo también puede publicar de vez en cuando un feed incompleto (ver
  [Comprobaciones antes de escribir](#comprobaciones-antes-de-escribir)).
