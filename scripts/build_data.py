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
import re
import sys
import time
import unicodedata
import urllib.request
import zipfile
from http.cookiejar import CookieJar
from html import unescape
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "network.json"

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


def get(url, timeout, opener=None, tries=3):
    """GET con reintentos (los espejos fallan de vez en cuando)."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 lurraldebus-viajes"})
    for n in range(1, tries + 1):
        try:
            return (opener.open(req, timeout=timeout) if opener else urllib.request.urlopen(req, timeout=timeout)).read()
        except OSError as e:
            if n == tries:
                raise
            print(f"  reintento {n}/{tries - 1} de {url}: {e}", file=sys.stderr)
            time.sleep(3 * n)


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
    """HH:MM:SS -> minutos, redondeando los segundos (16:46:59 es la 16:47, no la 16:46)."""
    h, m, sec = t.split(":")
    return int(h) * 60 + int(m) + (1 if int(sec) >= 30 else 0)


# Líneas a demanda: el código acaba en E (TO22E, GO21E...). Hay que pedirlas por teléfono con antelación.
DEMAND = re.compile(r"\d[eE]$")

NOTICES_URL = "https://lurraldebus.eus/notifications/index"


def fetch_notices():
    """Avisos oficiales de Lurraldebus (paradas suprimidas, incidencias...). Opcional: si falla, no se bloquea la build."""
    try:
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        get("https://lurraldebus.eus/?language=es", 30, op)  # el idioma va en la sesión
        page = get(NOTICES_URL, 30, op).decode("utf-8", "replace")
        out = []
        for blk in re.findall(r'<div class="alert-detail">(.*?)</div>\s*</div>', page, flags=re.S):
            date = re.search(r'<p class="alert-data">\s*([^<]+?)\s*</p>', blk)
            title = re.search(r'<h1 class="alert-title">\s*(.*?)\s*</h1>', blk, flags=re.S)
            text = re.search(r'<div class="alert-text">(.*)', blk, flags=re.S)
            if not (title and text):
                continue
            body = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", text.group(1)))).strip()
            out.append({"date": date.group(1) if date else "", "title": unescape(title.group(1)).strip(),
                        "text": body, "lines": sorted(set(re.findall(r"\b([A-Z]{2}\d{2}[A-Z]?)\b", title.group(1) + " " + body)))})
        print(f"{len(out)} avisos oficiales", file=sys.stderr)
        return out
    except Exception as e:  # noqa: BLE001 - los avisos son un extra
        print(f"AVISO: no se pudieron leer los avisos oficiales ({e})", file=sys.stderr)
        return None


def split_prefix(name):
    parts = DASH.split(name.strip(), maxsplit=1)
    if len(parts) == 2 and parts[0].strip():
        return parts[0].strip(), parts[1].strip()
    return None, name.strip()


def fetch_realtime(munis):
    """{municipio: (código oficial, {ids de parada})} con las paradas que tienen tiempo real en lurraldebus.eus.
    Opcional: si falla devuelve None y se conserva lo de la versión anterior."""
    try:
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        home = get("https://lurraldebus.eus/?language=es", 30, op).decode("utf-8", "replace")
        sel = re.search(r'id="RealMunicipioId">(.*?)</select>', home, flags=re.S).group(1)
        # "Donostia / San Sebastián" -> "donostia"; "Arrasate/mondragón" -> "arrasate"
        off = {norm(re.split(r"/", name)[0]): code for code, name in re.findall(
            r'<option value="(\d+)">([^<]+)</option>', unescape(sel))}
        out = {}
        for m in munis:
            code = off.get(norm(m))
            if not code:
                continue
            req = urllib.request.Request(
                "https://lurraldebus.eus/real/ajax_get_paradas_municipio_info.json",
                data=f"municipioId={code}".encode(), headers={"User-Agent": "Mozilla/5.0 lurraldebus-viajes"})
            r = json.loads(op.open(req, timeout=30).read())
            out[m] = (int(code), {x["value"] for x in r.get("data", [])})
            time.sleep(0.1)
        if not out:
            raise ValueError("sin municipios")
        print(f"tiempo real oficial: {sum(len(v[1]) for v in out.values())} paradas en {len(out)} municipios", file=sys.stderr)
        return out
    except Exception as e:  # noqa: BLE001
        print(f"AVISO: no se pudo leer el tiempo real oficial ({e})", file=sys.stderr)
        return None


def check(data, feed_trips):
    """Comprobaciones antes de escribir: mejor no publicar que publicar datos rotos."""
    empty = [op for op, n in feed_trips.items() if n == 0]
    if empty:
        sys.exit(f"feeds sin viajes: {', '.join(empty)}")
    if OUT.exists():
        old = json.loads(OUT.read_text(encoding="utf-8"))
        for what, a, b in (("viajes", len(old["trips"]), len(data["trips"])),
                           ("paradas", len(old["stops"]), len(data["stops"])),
                           ("municipios", len(old["munis"]), len(data["munis"]))):
            if b < a * 0.8:
                sys.exit(f"sospechoso: {what} pasan de {a} a {b} (más de un 20 % menos); revisa los feeds")
        # Una línea que pierde la mitad de sus viajes casi nunca es real: suele ser un feed truncado (así se perdió
        # GO07 entre semana: -68 de 100 viajes, solo -6 % en total, y el control global no lo veía).
        def per_route(d):
            return Counter((d["agencies"][r[3]], r[0]) for r in (d["routes"][t[0]] for t in d["trips"]))
        before, after = per_route(old), per_route(data)
        lost = [f"{ag} {name}: {n} -> {after[(ag, name)]}" for (ag, name), n in sorted(before.items())
                if n >= 10 and after[(ag, name)] < n * 0.5]
        if lost and "--accept-drops" not in sys.argv:
            sys.exit("sospechoso: líneas que pierden más de la mitad de sus viajes (si es real, repite con "
                     "--accept-drops):\n  " + "\n  ".join(lost))


def main():
    raw = []  # (feed_id, operador, muni fijo, stops, routes, trips, stop_times, calendar)
    for fid, (op, fixed) in FEEDS.items():
        print("descargando", fid, op, file=sys.stderr)
        z = zipfile.ZipFile(io.BytesIO(fetch_latest_zip(fid)))
        raw.append((fid, op, fixed, {n: read_csv(z, n) for n in (
            "stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt",
            "calendar_dates.txt", "agency.txt", "feed_info.txt")}))

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
    agency_info, feed_dates, feed_trips = [], [], {}
    for fid, op, fixed, t in raw:
        agencies.append(op)
        ai = len(agencies) - 1
        ag = (t["agency.txt"] or [{}])[0]
        agency_info.append({k: (ag.get(c) or "").strip() for k, c in (("phone", "agency_phone"), ("url", "agency_url"))})
        fi = (t["feed_info.txt"] or [{}])[0]
        if (fi.get("feed_version") or "")[:8].isdigit():
            feed_dates.append(int(fi["feed_version"][:8]))
        n_trips0, svc0 = len(trips), len(services)
        stop_ref = {}
        for s in t["stops.txt"]:
            p, rest = split_prefix(s["stop_name"])
            lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
            m = canon.get(norm(fixed), fixed) if fixed else (muni_from_prefix(p) if p else None)
            label = rest if (p and m and not fixed) else s["stop_name"].strip()
            if not m:
                m = nearest(lat, lon)
            stop_ref[s["stop_id"]] = len(stops)
            # el stop_id es el código oficial de la parada (sirve para abrir su tiempo real en lurraldebus.eus)
            stops.append([label, mi(m), round(lat, 5), round(lon, 5), s["stop_id"]])
        route_ref = {}
        for r in t["routes.txt"]:
            route_ref[r["route_id"]] = len(routes)
            name = r["route_short_name"].strip() or r["route_id"]
            # [código, nombre largo, color, operador, 1 si es a demanda]
            routes.append([name, r["route_long_name"].strip(), r.get("route_text_color", ""), ai,
                           int(bool(DEMAND.search(name)))])
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

        feed_trips[op] = len(trips) - n_trips0
        # vigencia propia de cada operador (los urbanos caducan antes que los interurbanos)
        used = {tr[1] for tr in trips[n_trips0:]}
        agency_info[-1]["validTo"] = max((services[i][2] for i in used), default=0)

    # 6º campo de cada parada: código oficial del municipio si la parada tiene tiempo real en lurraldebus.eus, o 0
    rt = fetch_realtime(munis)
    if rt is not None:
        for st in stops:
            code, ids = rt.get(munis[st[1]], (0, ()))
            st.append(code if st[4] in ids else 0)
    else:
        old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"stops": [], "munis": []}
        prev = {(x[0], old["munis"][x[1]], x[4]): x[5] for x in old["stops"] if len(x) > 5}
        for st in stops:
            st.append(prev.get((st[0], munis[st[1]], st[4]), 0))

    ends = [s[2] for s in services]
    starts = [s[1] for s in services]
    data = {
        "validFrom": min(starts), "validTo": max(ends),
        "feedDate": max(feed_dates, default=0),  # fecha de los feeds (solo cambia cuando cambian ellos)
        "munis": munis, "agencies": agencies, "agencyInfo": agency_info, "stops": stops,
        "routes": routes, "services": services, "trips": trips,
    }
    notices = fetch_notices()
    if notices is not None:
        data["notices"] = notices
    elif OUT.exists():  # no se pudo leer: conservar los de la versión anterior
        data["notices"] = json.loads(OUT.read_text(encoding="utf-8")).get("notices", [])
    check(data, feed_trips)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(munis)} municipios, {len(stops)} paradas, {len(routes)} líneas, "
          f"{len(trips)} viajes -> {OUT} ({OUT.stat().st_size // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
