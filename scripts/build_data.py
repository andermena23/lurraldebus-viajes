#!/usr/bin/env python3
"""Descarga los GTFS de Lurraldebus y genera web/data/network.json.

Fuente: Punto de Acceso Nacional (NAP, MITMA), espejado a diario por
MobilityDatabase (el NAP exige API key; el espejo es abierto).
Solo usa la librería estándar.
"""
import csv
import difflib
import io
import json
import math
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "network.json"
UA = "Mozilla/5.0 lurraldebus-viajes"

# web oficial: tablero de llegadas en tiempo real ("kartel hervea")
RT_URL = "https://lurraldebus.eus/real"
RT_RADIUS_M = 70  # distancia máxima para casar una parada del GTFS con la oficial

# id de MobilityDatabase -> (operador, municipio fijo si es servicio urbano)
FEEDS = {
    2724: ("Irunbus (Auif)", None),
    2725: ("Oiartzun (Xorrola)", "Oiartzun"),
    2726: ("Tolosaldea", None),
    2728: ("Zarautz Hiribusa", "Zarautz"),
    2731: ("Ekialdebus", None),
    2732: ("Goierrialdea (Bilman)", None),
    2733: ("Arrasate urbano", "Arrasate"),
    2734: ("Hernani urbano", "Hernani"),
    2735: ("Udalbus Eibar", "Eibar"),
    2736: ("La Guipuzcoana", None),
    2737: ("Oñati Herribusa", "Oñati"),
    2756: ("Euskotren Bus", None),
    2757: ("Tolosa-Buruntzaldea", None),
    2776: ("Pesa (Debagoiena)", None),
    2758: ("Tolosa Hiribusa", "Tolosa"),
    2759: ("Errenteria urbano", "Errenteria"),
    2760: ("Lasarte-Oria urbano", "Lasarte-Oria"),
}

ALIASES = {
    "pasai donibane": "Pasaia",
    "pasai san pedro": "Pasaia",
    "pasai antxo": "Pasaia",
    "hondarrbia": "Hondarribia",
    "zeagama": "Zegama",
}
NOT_MUNI = {"begiristain doktorea"}  # calle usada como prefijo en un feed
DASH = re.compile(r"\s+-\s*|\s*-\s+")


def norm(s):
    s = unicodedata.normalize("NFD", s.lower().strip())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def get(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=timeout).read()


def post(url, fields, timeout):
    req = urllib.request.Request(
        url, data=urllib.parse.urlencode(fields).encode(),
        headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"})
    return urllib.request.urlopen(req, timeout=timeout).read()


def utm_to_wgs84(x, y, zone=30):
    """Convierte coordenadas UTM ETRS89/WGS84 (hemisferio norte) a lat/lon."""
    k0 = 0.9996
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    x -= 500000.0
    M = y / k0
    mu = M / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    phi1 = (mu + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
            + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
            + (151 * e1**3 / 96) * math.sin(6 * mu)
            + (1097 * e1**4 / 512) * math.sin(8 * mu))
    s, c, t = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    ep2 = e2 / (1 - e2)
    N1 = a / math.sqrt(1 - e2 * s * s)
    R1 = a * (1 - e2) / (1 - e2 * s * s) ** 1.5
    D = x / (N1 * k0)
    lat = phi1 - (N1 * t / R1) * (D**2 / 2
        - (5 + 3 * t * t + 10 * ep2 * c * c - 4 * ep2**2 * c**4 - 9 * ep2) * D**4 / 24
        + (61 + 90 * t * t + 298 * ep2 * c * c + 45 * t**4 - 252 * ep2 - 3 * ep2**2 * c**4) * D**6 / 720)
    lon0 = math.radians(zone * 6 - 183)
    lon = lon0 + (D - (1 + 2 * t * t + ep2 * c * c) * D**3 / 6
        + (5 - 2 * ep2 * c * c + 28 * t * t - 3 * ep2**2 * c**4 + 8 * ep2 + 24 * t**4) * D**5 / 120) / c
    return math.degrees(lat), math.degrees(lon)


def mdist(lat1, lon1, lat2, lon2):
    return math.hypot((lat1 - lat2) * 111320, (lon1 - lon2) * 111320 * math.cos(math.radians(lat1)))


def realtime_codes(stops, timeout=20):
    """Códigos de parada del tablero en tiempo real, casadas por coordenadas.

    La web oficial da las paradas de cada municipio con coordenadas UTM; se convierten
    a WGS84 y se casan con las del GTFS (el stop_id del GTFS suele ser ya el código
    oficial, así que la coincidencia es alta). Devuelve {índice_de_parada: "muniId:código"}.
    """
    page = get(f"{RT_URL}/result", 30).decode("utf-8", "replace")
    muni_ids = sorted(set(re.findall(r'value="(\d{4}[0-9A-Z]{0,3})"', page)))
    if not muni_ids:
        print("aviso: sin municipios en el tablero de tiempo real", file=sys.stderr)
        return None
    cands = []  # (lat, lon, muniId, código)
    for mid in muni_ids:
        try:
            j = json.loads(post(f"{RT_URL}/ajax_get_paradas_municipio_info.json",
                                {"municipioId": mid}, timeout))
        except Exception:
            continue
        for p in j.get("data") or []:
            try:
                lat, lon = utm_to_wgs84(float(p["UTM_X"]), float(p["UTM_Y"]))
                cands.append((lat, lon, mid, str(p["value"])))
            except Exception:
                continue
    if not cands:
        return None
    # índice en rejilla de 0.005º (~500 m) para no comparar esto con aquello
    grid = defaultdict(list)
    for lat, lon, mid, code in cands:
        grid[round(lat * 200), round(lon * 200)].append((lat, lon, mid, code))
    rt, hits = {}, 0
    for i, s in enumerate(stops):
        best, bestD = None, RT_RADIUS_M
        for gx in (round(s[2] * 200) + d for d in (-1, 0, 1)):
            for gy in (round(s[3] * 200) + d for d in (-1, 0, 1)):
                for lat, lon, mid, code in grid.get((gx, gy), ()):
                    d = mdist(s[2], s[3], lat, lon)
                    if d <= bestD:
                        best, bestD = (mid, code), d
        if best:
            rt[i] = f"{best[0]}:{best[1]}"
            hits += 1
    print(f"tiempo real: {hits}/{len(stops)} paradas casadas", file=sys.stderr)
    return rt or None


def fetch_latest_zip(feed_id):
    page = get(f"https://mobilitydatabase.org/feeds/gtfs/mdb-{feed_id}", 60).decode("utf-8", "replace")
    urls = sorted(set(re.findall(
        rf"https://files\.mobilitydatabase\.org/mdb-{feed_id}/[^\"\\\\ ]+\.zip", page)))
    if not urls:
        sys.exit(f"sin zip para mdb-{feed_id}")
    return get(urls[-1], 120)


def read_csv(z, name):
    if name not in z.namelist():
        return []
    return list(csv.DictReader(io.TextIOWrapper(z.open(name), "utf-8-sig")))


def to_min(t):
    h, m, _ = t.split(":")
    return int(h) * 60 + int(m)


def split_prefix(name):
    parts = DASH.split(name.strip(), maxsplit=1)
    if len(parts) == 2 and parts[0].strip():
        return parts[0].strip(), parts[1].strip()
    return None, name.strip()


def main():
    raw = []  # (feed_id, operador, muni fijo, stops, routes, trips, stop_times, calendar)
    for fid, (op, fixed) in FEEDS.items():
        print("descargando", fid, op, file=sys.stderr)
        z = zipfile.ZipFile(io.BytesIO(fetch_latest_zip(fid)))
        raw.append((fid, op, fixed, {n: read_csv(z, n) for n in (
            "stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt",
            "calendar_dates.txt")}))

    # 1) municipios canónicos: prefijos frecuentes de las paradas interurbanas
    prefix_count = Counter()
    for _, _, fixed, t in raw:
        if fixed:
            continue
        for s in t["stops.txt"]:
            p, _ = split_prefix(s["stop_name"])
            if p:
                prefix_count[ALIASES.get(norm(p), p.title() if p.islower() else p)] += 1
    canon = {}
    for name, n in prefix_count.most_common():
        canon.setdefault(norm(name), name)
    frequent = [k for k, v in ((norm(n), c) for n, c in prefix_count.items()) if v >= 3]

    def muni_from_prefix(p):
        k = norm(p)
        if k in NOT_MUNI:
            return None
        if k in ALIASES:
            return ALIASES[k]
        if k in canon:
            return canon[k]
        m = difflib.get_close_matches(k, frequent, n=1, cutoff=0.8)
        return canon[m[0]] if m else canon.get(k)

    # 2) centroides para asignar por coordenadas las paradas sin prefijo
    pts = defaultdict(list)
    for _, _, fixed, t in raw:
        for s in t["stops.txt"]:
            p, _ = split_prefix(s["stop_name"])
            m = canon.get(norm(fixed), fixed) if fixed else (muni_from_prefix(p) if p else None)
            if m:
                pts[m].append((float(s["stop_lat"]), float(s["stop_lon"])))
    centroid = {m: (median(a for a, _ in v), median(b for _, b in v)) for m, v in pts.items()}

    def nearest(lat, lon):
        return min(centroid, key=lambda m: (centroid[m][0] - lat) ** 2
                   + ((centroid[m][1] - lon) * 0.73) ** 2)

    munis, muni_idx = [], {}

    def mi(name):
        name = "-".join(w[:1].upper() + w[1:] for w in name.split("-"))
        if name not in muni_idx:
            muni_idx[name] = len(munis)
            munis.append(name)
        return muni_idx[name]

    stops, agencies, routes, services, trips = [], [], [], [], []
    for fid, op, fixed, t in raw:
        agencies.append(op)
        ai = len(agencies) - 1
        stop_ref = {}
        for s in t["stops.txt"]:
            p, rest = split_prefix(s["stop_name"])
            lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
            m = canon.get(norm(fixed), fixed) if fixed else (muni_from_prefix(p) if p else None)
            label = rest if (p and m and not fixed) else s["stop_name"].strip()
            if not m:
                m = nearest(lat, lon)
            stop_ref[s["stop_id"]] = len(stops)
            stops.append([label, mi(m), round(lat, 5), round(lon, 5)])
        route_ref = {}
        for r in t["routes.txt"]:
            route_ref[r["route_id"]] = len(routes)
            routes.append([r["route_short_name"].strip() or r["route_id"],
                           r["route_long_name"].strip(), r.get("route_text_color", ""), ai])
        svc_ref = {}
        for c in t["calendar.txt"]:
            svc_ref[c["service_id"]] = len(services)
            days = sum((int(c[d]) << i) for i, d in enumerate(
                ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")))
            services.append([days, int(c["start_date"]), int(c["end_date"]), [], []])
        for cd in t["calendar_dates.txt"]:
            if cd["service_id"] in svc_ref:
                services[svc_ref[cd["service_id"]]][3 if cd["exception_type"] == "1" else 4].append(
                    int(cd["date"]))
        by_trip = defaultdict(list)
        for st in t["stop_times.txt"]:
            by_trip[st["trip_id"]].append(st)
        for tr in t["trips.txt"]:
            if tr["service_id"] not in svc_ref or tr["route_id"] not in route_ref:
                continue
            sts = sorted(by_trip.get(tr["trip_id"], []), key=lambda x: int(x["stop_sequence"]))
            if len(sts) < 2:
                continue
            trips.append([
                route_ref[tr["route_id"]], svc_ref[tr["service_id"]],
                (tr.get("trip_headsign") or tr.get("trip_short_name") or "").strip(),
                [stop_ref[x["stop_id"]] for x in sts],
                [to_min(x["arrival_time"] or x["departure_time"]) for x in sts],
                [to_min(x["departure_time"] or x["arrival_time"]) for x in sts],
                # bit0: no se puede subir, bit1: no se puede bajar
                "".join(str(int(x.get("pickup_type") == "1") + 2 * int(x.get("drop_off_type") == "1"))
                        for x in sts),
            ])

    ends = [s[2] for s in services]
    starts = [s[1] for s in services]
    data = {
        "validFrom": min(starts), "validTo": max(ends),
        "munis": munis, "agencies": agencies, "stops": stops,
        "routes": routes, "services": services, "trips": trips,
    }
    # códigos de la parada en tiempo real: separable para poder saltárselo con --no-rt
    if "--no-rt" not in sys.argv:
        try:
            data["rt"] = realtime_codes(stops)
        except Exception as e:
            print(f"aviso: tiempo real no disponible ({e})", file=sys.stderr)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(munis)} municipios, {len(stops)} paradas, {len(routes)} líneas, "
          f"{len(trips)} viajes -> {OUT} ({OUT.stat().st_size // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
