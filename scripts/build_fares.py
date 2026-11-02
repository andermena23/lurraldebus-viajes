#!/usr/bin/env python3
"""Genera web/data/fares.json con la zonificación y las tarifas oficiales de Lurraldebus.

Fuente: https://lurraldebus.eus/info/tarifas_zonas (zonas por comarca, saltos entre zonas y precios por salto).
Las tarifas cambian como mucho una vez al año, así que NO forma parte de la actualización diaria:
ejecútalo a mano cuando cambien (python3 scripts/build_fares.py) y sube el resultado.
Solo usa la librería estándar.
"""
import json
import re
import sys
import urllib.request
from html import unescape
from http.cookiejar import CookieJar
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "fares.json"
URL = "https://lurraldebus.eus/info/tarifas_zonas"


# Municipios que la web de tarifas escribe distinto (o no lista) -> municipio oficial de su misma zona.
ALIASES = {
    "Lasarte-Oria": "Lasarte",
    "Amorebieta-Etxano": "Amorebieta",
    "Elduain": "Elduaien",
    "Bidania-Goiatz": "Tolosa",   # Tolosaldea
    "Atxondo": "Abadiño",         # Durangaldea
}


def text(s):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def main():
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    hdr = {"User-Agent": "Mozilla/5.0 lurraldebus-viajes"}
    op.open(urllib.request.Request("https://lurraldebus.eus/?language=es", headers=hdr), timeout=30).read()  # idioma en sesión
    page = op.open(urllib.request.Request(URL, headers=hdr), timeout=30).read().decode("utf-8", "replace")

    def box(box_id):
        m = re.search(rf'<div id="{box_id}" class="[^"]*">', page)
        if not m:
            sys.exit(f"no encuentro {box_id}: ¿ha cambiado la página de tarifas?")
        rest = page[m.end():]
        n = re.search(r'<div id="[\w-]+-box" class="(?:jumps|prices)-towns-col">', rest)
        return rest[: n.start()] if n else rest[:8000]

    zone_ids = re.findall(r'<p id="(\w+)" class="zone-title', page)
    zones, towns, jumps = [], {}, []
    for zi, zid in enumerate(zone_ids):
        b = box(f"{zid}-box")
        zones.append(text(re.search(rf'<p id="{zid}" class="zone-title[^>]*>(.*?)</p>', page).group(1)))
        for t in re.findall(r'<p class="town-title">(.*?)</p>', b):
            towns[text(t)] = zi
        rows = re.findall(r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>", b, flags=re.S)
        jumps.append([int(v) if text(v).isdigit() else None for k, v in rows if text(k).upper() != "HASTA ..."])
    if any(len(r) != len(zones) for r in jumps):
        sys.exit("la matriz de saltos no es cuadrada")

    for alias, official in ALIASES.items():
        if official in towns:
            towns.setdefault(alias, towns[official])

    prices = {}
    for i in range(1, 9):
        b = box(f"prices-{i}-box")
        title = text(re.search(r'<p class="jumps-from-title">(.*?)</p>', b).group(1))
        vals = [float(n) for _, v in re.findall(r"<tr>\s*<td>(\d+ saltos?)</td>\s*<td>(.*?)</td>", b, flags=re.S)
                for n in [m.replace(",", ".") for m in re.findall(r"\d+(?:,\d+)?", text(v))] if "€" in v][:6]
        if vals:
            prices[title] = vals
    if not prices:
        sys.exit("no he encontrado precios")

    OUT.write_text(json.dumps({"zones": zones, "towns": towns, "jumps": jumps, "prices": prices},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(zones)} zonas, {len(towns)} municipios, tarifas: {', '.join(prices)} -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
