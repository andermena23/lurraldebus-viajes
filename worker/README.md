# Proxy de tiempo real (Cloudflare Worker)

La web del comparador es estática (GitHub Pages) y el tablero de llegadas en
tiempo real de <https://lurraldebus.eus> no manda cabeceras CORS, así que el
navegador no puede llamarlo directamente. Este Worker (uno solo, gratis en el
plan de Cloudflare para uso normal) actúa de puente:

| Endpoint del Worker | Lo que hace |
|---|---|
| `GET /health` | Comprueba que el Worker está desplegado |
| `GET /board?muni=<idMunicipio>&stop=<idParada>` | Devuelve solo la tabla de llegadas del tablero oficial |

Lleva caché en memoria de 15 s para no golpear al servidor oficial si varios
clientes consultan la misma parada a la vez. Las cabeceras `X-RT-Time` (cuándo
se generó la tabla) y `X-RT-Now` (hora del servidor al responder) indican el
instante (epoch, ms) al que corresponden los minutos, sin fiarse del reloj del
dispositivo.

## Despliegue automático

El repositorio incluye `.github/workflows/worker.yml`, que despliega el Worker
al hacer push a `main` (o a la rama `realtime-vivo` mientras se prueba) cuando
cambia algo en `worker/`.

Antes del primer despliegue hay que configurar en GitHub, en
**Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`: token de Cloudflare con permiso **Edit Cloudflare Workers**.
- `CLOUDFLARE_ACCOUNT_ID`: el Account ID de Cloudflare (Workers & Pages → barra lateral).

La URL del Worker aparece en el log del workflow, con la forma
`https://lurraldebus-rt.<tu-subdominio>.workers.dev`. Después se guarda en la
variable de repositorio `RT_PROXY_URL` para que la web la use por defecto.

### Despliegue manual (alternativa)

```bash
npm i -g wrangler
wrangler login
cd worker
wrangler deploy
```

## Notas de la API original

- Los "municipios" del tablero tienen ids tipo `20069` (Gipuzkoa), `48020`
  (Bizkaia), `01059` (Araba); los aeropuertos van aparte (`20036N01`).
- El `paradaId` es el número de parada de Lurraldebus, único en toda la red: es
  el mismo `stop_id` que traen los GTFS. El parámetro `municipioId` del tablero
  llega con cualquier valor (aunque conviene pasarlo bien).
- La tabla trae la línea, el recorrido, la ocupación, el destino y los minutos
  hasta la llegada (`00 min` = en la parada).
