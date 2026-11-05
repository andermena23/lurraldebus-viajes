#!/usr/bin/env python3
"""Proxy de desarrollo para probar el tiempo real en local (imita worker/worker.js).

En local el navegador no puede llamar a lurraldebus.eus (no manda CORS), igual que en
producción; este servidor reenvía las dos rutas que espera web/realtime.js:

    GET /health                               -> {"ok": true}
    GET /board?muni=<id>&stop=<id>            -> HTML de la tabla de llegadas

Uso:
    python3 scripts/dev_proxy.py              # escucha en http://localhost:8931
    python3 scripts/dev_proxy.py 9000         # otro puerto
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UP = "https://lurraldebus.eus"
UA = "Mozilla/5.0 lurraldebus-viajes-dev"


def extract_table(html):
    m = re.search(r'<div class="live-lines-content">.*?</table>', html, re.S | re.I)
    return m.group(0) if m else html


class Proxy(BaseHTTPRequestHandler):
    def send_text(self, text, status=200, ctype="text/html; charset=utf-8", extra=None):
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept")
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)

        if u.path == "/health":
            self.send_text(json.dumps({"ok": True, "now": int(time.time() * 1000)}),
                           ctype="application/json; charset=utf-8")
            return

        if u.path != "/board" or "muni" not in qs or "stop" not in qs:
            self.send_text("rutas: /health y /board?muni=…&stop=…", 404, "text/plain; charset=utf-8")
            return

        muni = qs["muni"][0]
        stop = qs["stop"][0]
        if not re.fullmatch(r"\d{4}[0-9A-Z]{0,3}", muni, re.I) or not re.fullmatch(r"\d{1,4}", stop):
            self.send_text("municipio o parada no válidos", 400, "text/plain; charset=utf-8")
            return

        url = f"{UP}/real/result/{urllib.parse.quote(muni)}/{urllib.parse.quote(stop)}"
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                html = r.read().decode("utf-8", "replace")
        except Exception as e:
            self.send_text(f"la web oficial no responde: {e}", 502, "text/plain; charset=utf-8")
            return

        self.send_text(extract_table(html), extra={"X-RT-Time": str(int(time.time() * 1000))})

    def log_message(self, fmt, *args):
        print(f"proxy: {fmt % args}", file=sys.stderr)


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8931
print(f"proxy de tiempo real en http://localhost:{port}", file=sys.stderr)
ThreadingHTTPServer(("127.0.0.1", port), Proxy).serve_forever()
