#!/usr/bin/env python3
"""Proxy de desarrollo para probar el tiempo real en local (imita worker/worker.js).

En local el navegador no puede llamar a lurraldebus.eus (no manda CORS), igual que en
producción; este servidor reenvía las dos rutas que espera web/realtime.js:

    GET /stops?muni=<id>                      -> JSON de paradas del municipio
    GET /arrivals?stop=<id>&muni=<id>         -> HTML del tablero de llegadas

Uso:
    python3 scripts/dev_proxy.py              # escucha en http://localhost:8931
    python3 scripts/dev_proxy.py 9000         # otro puerto
"""
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UP = "https://lurraldebus.eus"
UA = "Mozilla/5.0 lurraldebus-viajes-dev"


class Proxy(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        try:
            if u.path == "/stops" and "muni" in qs:
                body = urllib.parse.urlencode({"municipioId": qs["muni"][0]}).encode()
                url = UP + "/real/ajax_get_paradas_municipio_info.json"
                ctype = "application/json; charset=utf-8"
            elif u.path == "/arrivals" and "stop" in qs:
                body = urllib.parse.urlencode({"_method": "POST",
                                               "data[Real][municipioId]": qs.get("muni", ["0000"])[0],
                                               "data[Real][paradaId]": qs["stop"][0]}).encode()
                url = UP + "/real/result"
                ctype = "text/html; charset=utf-8"
            else:
                self.send_response(404)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"rutas: /stops?muni= y /arrivals?stop=&muni=")
                return
        except KeyError:
            self.send_response(400)
            self.end_headers()
            return

        req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(f"la web oficial no responde: {e}".encode())
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"proxy: {fmt % args}", file=sys.stderr)


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8931
print(f"proxy de tiempo real en http://localhost:{port}", file=sys.stderr)
ThreadingHTTPServer(("127.0.0.1", port), Proxy).serve_forever()
