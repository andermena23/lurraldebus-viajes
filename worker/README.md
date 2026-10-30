# Proxy de tiempo real (Cloudflare Worker)

La web del comparador es estática (GitHub Pages) y el tablero de llegadas en
tiempo real de <https://lurraldebus.eus> no manda cabeceras CORS, así que el
navegador no puede llamarlo directamente. Este Worker (uno solo, gratis en el
plan de Cloudflare para uso normal) actúa de puente:

| Endpoint del Worker | Lo que hace |
|---|---|
| `GET /stops?muni=<idMunicipio>` | Pasa al JSON de paradas del municipio (`/real/ajax_get_paradas_municipio_info.json`) |
| `GET /arrivals?stop=<idParada>&muni=<idMunicipio>` | Pasa al HTML del tablero de llegadas (`/real/result`) |

Lleva caché en memoria de 20 s (llegadas) y 10 min (paradas) para no golpear
al servidor oficial si varios clientes consultan la misma parada, y reenvía
los cabeceras CORS para que la web del comparador funcione sin tocar nada más.

## Despliegue (5 min)

1. Cuenta gratis en [Cloudflare](https://dash.cloudflare.com/) (no hace falta dominio).
2. En una terminal con Node:

   ```bash
   npm i -g wrangler
   wrangler login     # se abre el navegador y aceptas
   cd worker
   wrangler deploy
   ```

3. Con la URL que imprime el deploy (tipo `https://lurraldebus-rt.tucuenta.workers.dev`)
   basta: actívalo en la web, sección "Más opciones → Tiempo real".

Opcional: en `wrangler.toml` puedes restringir quién usa tu proxy con
`ALLOW_ORIGIN` (por defecto, abierto). Cuidado con la cuota gratuita de
Cloudflare: las llegadas se cachear 20 s, así que los refrescos cada 30 s que
hace la web están de sobra dentro del límite de uso personal.

## Notas de la API original (sin autenticación)

- Los "municipios" del tablero tienen ids tipo `20069` (Gipuzkoa), `48020`
  (Bizkaia), `01059` (Araba); los aeropuertos van aparte (`20036N01`).
- El `paradaId` es el número de parada de Lurraldebus, único en toda la red:
  es el mismo `stop_id` que traen los GTFS. El parámetro `municipioId` del
  tablero llega con cualquier valor (aunque conviene pasarlo bien).
- La ocupación y la dirección salen casadas con la fila del tablero; el
  tiempo son "minutos hasta la llegada" (`00 min` = en la parada).
