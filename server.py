"""Servidor local del geovisor. Consulta únicamente la API pública de SIATA."""

from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.parse import unquote
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import csv
import io
import json
import math
import re
import sys
import time
import unicodedata
import mimetypes
import gzip
from functools import lru_cache
from analytics import public_config, UMAMI_ORIGIN, UMAMI_COLLECTOR_ORIGIN


ROOT = Path(__file__).resolve().parent
SIATA = "https://datos.siata.gov.co"
OPERATIONAL = "https://siata.gov.co"
GEOPORTAL = "https://geoportal.siata.gov.co"
RADAR_DIRECTORY = "/data/radar/10_DBZH/"
RADAR_BOUNDS = [[5.1, -76.6], [7.3, -74.3]]  # KML oficial: /kml/00_Radar/Ultimo_Barrido/AreaMetropolitanaRadar_10_120_DBZH.kml
FORECAST_ZONES = {
    "Medellín Centro": "wrfmedCentro", "Medellín Oriente": "wrfmedOriente",
    "Medellín Occidente": "wrfmedOccidente", "Palmitas": "wrfpalmitas",
    "Caldas": "wrfcaldas", "Copacabana": "wrfcopacabana",
    "La Estrella": "wrflaestrella", "Itagüí": "wrfitagui",
    "Bello": "wrfbello", "Envigado": "wrfenvigado",
    "Sabaneta": "wrfsabaneta", "Barbosa": "wrfbarbosa",
    "Girardota": "wrfgirardota",
}
CATALOG_FILE = ROOT / "data" / "siata_catalog.json"
CATALOG_TTL = 60 * 60
CATALOG_SCHEMA = 3
MAX_DOWNLOAD = 20 * 1024 * 1024
AIR_STATIONS_DOI = "doi:10.83041/XTI3FH"
AIR_PM25_DOI = "doi:10.83041/AUWZWT"
STATION_TABLES = {
    "Pluviometrica": ("doi:10.83041/JSGPWD", "Estaciones_pluviometro.tab"),
    "Nivel": ("doi:10.83041/5ZOUUO", "Estaciones_nivel.tab"),
    "Meteorologica": ("doi:10.83041/NXHIKW", "Estaciones_meteorologica.tab"),
    "VelocidadSuperficialCauces": ("doi:10.83041/F0LTDK", "Estaciones_velocidad.tab"),
    "Disdrometro": ("doi:10.83041/I4RVOK", "Estaciones_disdrometro.tab"),
    "Piranometro": ("doi:10.83041/BD6U2H", "Estaciones_piranometro.tab"),
    "RedCalidadAire": (AIR_STATIONS_DOI, "Estaciones_calidad_aire.tab"),
}
OBSERVATION_PATHS = {
    "Pluviometrica": "/fastgeoapi/geodata/geodataJson/3/pluvios_v2",
    "Nivel": "/fastgeoapi/geodata/geodataJson/2/niveles",
    "Meteorologica": "/fastgeoapi/geodata/geodataJson/3/tempVient",
    "RedCalidadAire": "/fastgeoapi/geodata/geodataJson/1/pm25_minio",
}
BOGOTA = timezone(timedelta(hours=-5))

catalog_lock = Lock()
catalog_cache = None
catalog_time = 0.0
radar_lock = Lock()
radar_cache = {}
forecast_lock = Lock()
forecast_cache = {}
boundaries_cache = None
observations_lock = Lock()
observations_cache = {}


def read_url(path, params=None, limit=MAX_DOWNLOAD):
    query = "?" + urlencode(params, doseq=True) if params else ""
    request = Request(SIATA + path + query, headers={"User-Agent": "SIATA-geovisor-academico/1.0"})
    with urlopen(request, timeout=30) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError("El archivo de SIATA supera el tamaño permitido para la vista previa")
    return content


def read_operational(base, path, limit=MAX_DOWNLOAD):
    request = Request(base + path, headers={"User-Agent": "SIATA-geovisor-academico/1.0"})
    with urlopen(request, timeout=25) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError("El producto de SIATA supera el tamaño permitido")
    return content


def get_radar(force=False):
    """Último barrido publicado, limitado a 30 minutos de antigüedad."""
    with radar_lock:
        now = datetime.now(timezone.utc)
        if radar_cache.get("checked_at") and (now - radar_cache["checked_at"]).total_seconds() < (15 if force else 120):
            return radar_cache["metadata"]
        image_name = None
        for day in (now, now - timedelta(days=1)):
            folder = day.strftime("%Y%m%d")
            try:
                listing = read_operational(OPERATIONAL, RADAR_DIRECTORY + folder + "/", limit=3 * 1024 * 1024)
            except HTTPError as exc:
                if exc.code == 404:
                    continue
                raise
            names = set(re.findall(rb'href="(\d{12})\.png"', listing))
            candidates = []
            for name in names:
                timestamp = datetime.strptime(name.decode("ascii"), "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
                if timestamp <= now + timedelta(minutes=2):
                    candidates.append((timestamp, folder + "/" + name.decode("ascii") + ".png"))
            if candidates:
                timestamp, image_name = max(candidates)
                break
        available = bool(image_name and now - timestamp <= timedelta(minutes=30))
        metadata = {
            "available": available,
            "observed_at": timestamp.isoformat() if image_name else None,
            "age_minutes": round((now - timestamp).total_seconds() / 60) if image_name else None,
            "bounds": RADAR_BOUNDS,
            "bounds_source": OPERATIONAL + "/kml/00_Radar/Ultimo_Barrido/AreaMetropolitanaRadar_10_120_DBZH.kml",
            "source": OPERATIONAL + RADAR_DIRECTORY + image_name if image_name else None,
            "image": "/api/radar/image" if available else None,
        }
        if radar_cache.get("image_name") != image_name:
            radar_cache.pop("image", None)
        radar_cache.update(checked_at=now, metadata=metadata, image_name=image_name)
        return metadata


def get_radar_image(expected_stamp=None):
    metadata = get_radar()
    if not metadata["available"]:
        raise ValueError("No hay un barrido de radar reciente")
    if expected_stamp and expected_stamp != metadata["observed_at"]:
        raise ValueError("El barrido cambió. Actualiza la consulta de radar.")
    with radar_lock:
        if "image" not in radar_cache:
            radar_cache["image"] = read_operational(
                OPERATIONAL, RADAR_DIRECTORY + radar_cache["image_name"], limit=3 * 1024 * 1024)
        return radar_cache["image"]


def get_boundaries():
    global boundaries_cache
    if boundaries_cache is not None:
        return boundaries_cache
    boundaries_cache = json.loads((ROOT / "data" / "forecast_zones.geojson").read_text(encoding="utf-8"))
    return boundaries_cache


def get_forecast(force=False):
    with forecast_lock:
        now = datetime.now(timezone.utc)
        if forecast_cache.get("checked_at") and (now - forecast_cache["checked_at"]).total_seconds() < (60 if force else 1800):
            return forecast_cache["payload"]

        def zone(item):
            name, slug = item
            path = "/fastgeoapi/geodata/geodataJson/2/" + slug
            try:
                data = json.loads(read_operational(GEOPORTAL, path))
                props = data["features"][0]["properties"]
                return {
                    "name": name, "updated_at": props.get("date"),
                    "days": [{"date": day.get("fecha"), "periods": {
                        "madrugada": day.get("lluvia_madrugada"),
                        "mañana": day.get("lluvia_mannana"),
                        "tarde": day.get("lluvia_tarde"),
                        "noche": day.get("lluvia_noche"),
                    }, "temperature_min": day.get("temperatura_minima"),
                        "temperature_max": day.get("temperatura_maxima")} for day in props.get("pronostico", [])],
                    "source": GEOPORTAL + path,
                }
            except Exception as exc:
                print("Pronóstico SIATA:", name, repr(exc), file=sys.stderr)
                return None

        with ThreadPoolExecutor(max_workers=6) as pool:
            zones = [item for item in pool.map(zone, FORECAST_ZONES.items()) if item]
        if not zones:
            raise ValueError("SIATA no publicó pronósticos de zona disponibles")
        payload = {
            "source": GEOPORTAL,
            "fetched_at": now.isoformat(),
            "zones": zones,
            "boundaries": get_boundaries(),
            "boundaries_source": get_boundaries()["sources"],
            "missing_zones": [name for name in FORECAST_ZONES if name not in {zone["name"] for zone in zones}],
        }
        forecast_cache.update(checked_at=now, payload=payload)
        return payload


def read_json(path, params=None):
    result = json.loads(read_url(path, params).decode("utf-8-sig"))
    if result.get("status") != "OK":
        raise ValueError("La API de SIATA no devolvió una respuesta válida")
    return result["data"]


def dataset_url(doi):
    return SIATA + "/dataset.xhtml?" + urlencode({"persistentId": doi})


def location_from_item(item):
    fields = item.get("metadataBlocks", {}).get("geospatial", {}).get("fields", [])
    bounds = next((field.get("value", []) for field in fields
                   if field.get("typeName") == "geographicBoundingBox"), [])
    place = next((field.get("value", []) for field in fields
                  if field.get("typeName") == "geographicUnit"), [])
    location = {"lat": None, "lon": None, "place": place[0] if place else ""}
    if bounds:
        box = bounds[0]
        try:
            west = float(box["westLongitude"]["value"])
            east = float(box["eastLongitude"]["value"])
            south = float(box["southLatitude"]["value"])
            north = float(box["northLatitude"]["value"])
            lat, lon = (south + north) / 2, (west + east) / 2
            if valid_coordinates(lat, lon):
                location.update(lat=lat, lon=lon)
        except (KeyError, TypeError, ValueError):
            pass
    return location


def valid_coordinates(lat, lon):
    return math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180 and (lat, lon) != (0, 0)


def normalized(value):
    return "".join(c for c in unicodedata.normalize("NFD", value) if not unicodedata.combining(c)).lower()


def station_table(item):
    category, (doi, filename) = item
    data = read_json("/api/datasets/:persistentId/", {"persistentId": doi})
    file = next(f["dataFile"] for f in data["latestVersion"]["files"] if f["dataFile"]["filename"] == filename)
    rows = list(csv.DictReader(io.StringIO(read_url("/api/access/datafile/" + str(file["id"])).decode("utf-8-sig")), delimiter="\t"))
    return category, doi, [{normalized(key): "" if value.strip().upper() in {"NULL", "NA", "N/A"} else value.strip()
                           for key, value in row.items() if key and value is not None} for row in rows]


def enrich_station_locations(records):
    """Las tablas de estaciones contienen coordenadas omitidas en la API de búsqueda."""
    by_code = {}
    for record in records:
        match = re.match(r"(\d+)\s*-", record["name"])
        if match:
            record["station_code"] = match[1]
            by_code[(record["category"], match[1])] = record
    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {category: pool.submit(station_table, (category, spec)) for category, spec in STATION_TABLES.items()}
        for category, future in futures.items():
            try:
                _, doi, rows = future.result()
                for row in rows:
                    code = row.get("nombre_corto_estacion", "") if category == "RedCalidadAire" else row.get("codigo", "")
                    try:
                        lat, lon = float(row["latitud"]), float(row["longitud"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    if not code or not valid_coordinates(lat, lon):
                        continue
                    record = by_code.get((category, code))
                    if record is None:
                        record = {"id": "station:" + category + ":" + code, "doi": doi, "name": row.get("nombre", row.get("nombre_completo_estacion", code)),
                                  "category": category, "kind": "station_metadata", "published_at": None, "url": dataset_url(doi)}
                        if category == "RedCalidadAire":
                            record.update(doi=AIR_PM25_DOI, source_doi=doi, code=code, kind="air_station")
                        records.append(record)
                        by_code[(category, code)] = record
                    record.update(station_code=code, lat=lat, lon=lon, municipality=row.get("municipio", ""),
                                  sector=row.get("comuna/corregimiento", ""), location_source=dataset_url(doi))
                    record["place"] = " · ".join(v for v in [row.get("barrio/vereda", ""), record["sector"], record["municipality"]] if v) or record.get("place", "")
            except Exception as exc:
                failures.append(category)
                print("Tabla de estaciones SIATA:", category, repr(exc), file=sys.stderr)
    return failures


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result > -900 else None
    except (ValueError, TypeError):
        return None


def observation_record(category, feature, now):
    props = feature.get("properties", {})
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates", [])
    if geometry.get("type") != "Point" or len(coords) < 2 or not valid_coordinates(coords[1], coords[0]):
        return None
    code = str(props.get("estacion") if category == "RedCalidadAire" else props.get("codigo", props.get("Codigo", "")))
    date_keys = {"Pluviometrica": "fecha_ultima_actualizacion", "Nivel": "fechaUltimoDato", "Meteorologica": "FechaUltimaModificacion", "RedCalidadAire": "fechaFin"}
    stamp = props.get(date_keys[category])
    try:
        date = datetime.fromisoformat(stamp)
        date = date if date.tzinfo else date.replace(tzinfo=BOGOTA)
        age = max(0, int((now - date).total_seconds() / 60))
        stamp = date.isoformat()
    except (TypeError, ValueError):
        age = None
    definitions = {
        "Pluviometrica": [("acumulado_15min", "Lluvia acumulada · 15 min", "mm")],
        "Nivel": [("nivelActual", "Nivel del cauce", "cm")],
        "Meteorologica": [("Temperatura", "Temperatura", "°C"), ("Humedad_relativa", "Humedad relativa", "%")],
        "RedCalidadAire": [("PM25_24H_prom", "PM2.5 · promedio 24 h", "µg/m³"), ("ICA_24H_prom", "ICA · promedio 24 h", "")],
    }
    readings = [{"field": field, "label": label, "unit": unit, "value": number(props.get(field))}
                for field, label, unit in definitions[category] if number(props.get(field)) is not None]
    return {"id": "live:" + category + ":" + code, "category": category, "station_code": code,
            "name": props.get("nombre", props.get("nombreEstacion", props.get("NombreEstacion", code))),
            "lat": coords[1], "lon": coords[0], "place": props.get("ubicacion", props.get("municipio", props.get("Municipio", ""))),
            "observed_at": stamp, "age_minutes": age, "recent": age is not None and age <= (90 if category == "RedCalidadAire" else 20),
            "readings": readings, "properties": props, "source": GEOPORTAL + OBSERVATION_PATHS[category]}


def get_observations(force=False):
    with observations_lock:
        now = datetime.now(timezone.utc)
        if observations_cache.get("checked_at") and (now - observations_cache["checked_at"]).total_seconds() < (30 if force else 180):
            return observations_cache["payload"]
        def network(category):
            try:
                data = json.loads(read_operational(GEOPORTAL, OBSERVATION_PATHS[category]))
                return [record for feature in data.get("features", []) if (record := observation_record(category, feature, now))], None
            except Exception as exc:
                print("Red operativa SIATA:", category, repr(exc), file=sys.stderr)
                return [], category
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(network, OBSERVATION_PATHS))
        stations = [station for rows, _ in results for station in rows]
        if not stations:
            raise ValueError("Las redes operativas de SIATA no respondieron")
        payload = {"source": GEOPORTAL, "fetched_at": now.isoformat(), "stations": stations,
                   "unavailable_networks": [failed for _, failed in results if failed]}
        observations_cache.update(checked_at=now, payload=payload)
        return payload


def fetch_catalog():
    common = [
        ("q", "*"), ("type", "dataset"), ("per_page", "100"),
        ("metadata_fields", "geospatial:geographicBoundingBox"),
        ("metadata_fields", "geospatial:geographicUnit"),
    ]

    def page(start):
        return read_json("/api/search", common + [("start", str(start))])

    first = page(0)
    total = first["total_count"]
    items = list(first["items"])
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(page, range(100, total, 100)):
            items.extend(result["items"])

    records = []
    for item in items:
        category = item.get("identifier_of_dataverse", "")
        if category in {"siata", "Productos_tecnicos"}:
            continue
        doi = item.get("global_id", "")
        record = {
            "id": doi,
            "doi": doi,
            "name": item.get("name", "Sin nombre"),
            "category": category,
            "published_at": item.get("published_at"),
            "file_count": item.get("fileCount", 0),
            "url": dataset_url(doi),
            "kind": "dataset",
        }
        record.update(location_from_item(item))
        records.append(record)

    failures = enrich_station_locations(records)

    return {
        "source": SIATA,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "dataset_count": len(items),
        "schema_version": CATALOG_SCHEMA,
        "unavailable_tables": failures,
        "records": records,
    }


def get_catalog(force=False):
    global catalog_cache, catalog_time
    with catalog_lock:
        if force and catalog_cache and catalog_cache.get("schema_version") == CATALOG_SCHEMA and time.time() - catalog_time < 30:
            return catalog_cache
        if catalog_cache and catalog_cache.get("schema_version") == CATALOG_SCHEMA and not force and time.time() - catalog_time < CATALOG_TTL:
            return catalog_cache
        if catalog_cache is None and CATALOG_FILE.exists():
            try:
                catalog_cache = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
                fetched = datetime.fromisoformat(catalog_cache["fetched_at"]).timestamp()
                catalog_time = fetched
                if catalog_cache.get("schema_version") == CATALOG_SCHEMA and not force and time.time() - catalog_time < CATALOG_TTL:
                    return catalog_cache
            except (ValueError, KeyError):
                catalog_cache = None
        try:
            fresh = fetch_catalog()
            CATALOG_FILE.write_text(json.dumps(fresh, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            catalog_cache = fresh
            catalog_time = time.time()
            return fresh
        except Exception as exc:
            if catalog_cache:
                return {**catalog_cache, "stale": True, "error": str(exc)}
            raise


def get_dataset(doi):
    if not re.fullmatch(r"doi:[A-Za-z0-9./_-]+", doi):
        raise ValueError("Identificador de dataset inválido")
    data = read_json("/api/datasets/:persistentId/", {"persistentId": doi})
    version = data["latestVersion"]
    fields = version["metadataBlocks"]["citation"]["fields"]
    title = next((field.get("value", "") for field in fields if field["typeName"] == "title"), doi)
    files = []
    for entry in version.get("files", []):
        file = entry["dataFile"]
        if entry.get("restricted"):
            continue
        name = file["filename"]
        match = re.search(r"(20\d\d)[_-](0[1-9]|1[0-2])", name)
        order = match.group(1) + match.group(2) if match else "000000"
        files.append({
            "id": file["id"], "name": name, "bytes": file.get("filesize", 0),
            "url": SIATA + "/api/access/datafile/" + str(file["id"]),
            "tabular": name.lower().endswith((".tab", ".tsv", ".csv")),
            "order": order,
        })
    files.sort(key=lambda file: (file["order"], file["name"]), reverse=True)
    return {"doi": doi, "title": title, "url": dataset_url(doi), "files": files}


@lru_cache(maxsize=24)
def get_series(file_id):
    if not re.fullmatch(r"\d{1,10}", file_id):
        raise ValueError("Identificador de archivo inválido")
    raw = read_url("/api/access/datafile/" + file_id)
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter="\t")
    if not reader.fieldnames or len(reader.fieldnames) < 2:
        raise ValueError("El archivo no contiene una tabla de mediciones")
    date_column = next((name for name in reader.fieldnames
                        if name.lower() in {"fecha_hora", "fecha", "timestamp", "date"}), None)
    if date_column is None:
        raise ValueError("El archivo no contiene una columna de fecha para graficar")
    rows = deque(reader, maxlen=360)
    ignored = {date_column, "codigo", "código", "id", "calidad"}
    columns = []
    values = {}
    for name in reader.fieldnames:
        if name.lower() in ignored:
            continue
        parsed = []
        for row in rows:
            try:
                value = float(row.get(name, "").strip())
                parsed.append(value if math.isfinite(value) else None)
            except (TypeError, ValueError):
                parsed.append(None)
        if any(value is not None for value in parsed):
            columns.append(name)
            values[name] = parsed
    result = {
        "file_id": int(file_id), "date_column": date_column,
        "times": [row.get(date_column, "") for row in rows],
        "columns": columns, "values": values,
    }
    return result


STATIC_FILES = {"index.html", "scripts.js", "styles.css", "coverage.js", "pwa.js", "analytics.js", "manifest.webmanifest", "service-worker.js",
                "data/siata_catalog.json", "data/forecast_zones.geojson", "data/medellin_sectors.geojson"}
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
}


def security_headers():
    headers = dict(SECURITY_HEADERS)
    if public_config()["enabled"]:
        headers["Content-Security-Policy"] = headers["Content-Security-Policy"].replace(
            "script-src 'self'", "script-src 'self' " + UMAMI_ORIGIN).replace(
            "connect-src 'self'", "connect-src 'self' " + UMAMI_COLLECTOR_ORIGIN)
    return headers


def response_for_url(url, accept_encoding=""):
    parsed = urlparse(url)
    path = unquote(parsed.path)
    status, mime, cache = 200, "application/json; charset=utf-8", "no-store"
    try:
        query = parse_qs(parsed.query)
        force = query.get("refresh") == ["1"]
        if path == "/healthz":
            payload = {"status": "ok"}
        elif path == "/api/analytics/config":
            payload = public_config()
        elif path == "/api/radar/image":
            payload, mime = get_radar_image(query.get("stamp", [None])[0]), "image/png"
        elif path == "/api/radar":
            payload = get_radar(force)
        elif path == "/api/forecast":
            payload = get_forecast(force)
        elif path == "/api/observations":
            payload = get_observations(force)
        elif path == "/api/catalog":
            payload = get_catalog(force)
        elif path == "/api/dataset":
            payload = get_dataset(query.get("doi", [""])[0])
        elif path == "/api/series":
            payload = get_series(query.get("file", [""])[0])
        else:
            filename = "index.html" if path == "/" else path.lstrip("/")
            file = (ROOT / filename).resolve()
            canonical = file.relative_to(ROOT).as_posix() if file.is_relative_to(ROOT) else ""
            public = canonical in STATIC_FILES or canonical.startswith(("vendor/", "icons/"))
            if not public or not file.is_file():
                status, payload = 404, {"error": "Ruta desconocida"}
            else:
                filename = canonical
                payload = file.read_bytes()
                mime = "application/manifest+json" if filename.endswith(".webmanifest") else (mimetypes.guess_type(filename)[0] or "application/octet-stream")
                if filename.endswith(".geojson"):
                    mime = "application/geo+json"
                cache = "public, max-age=86400" if filename.startswith(("vendor/", "icons/")) else "no-cache"
    except ValueError as exc:
        status, payload = 400, {"error": str(exc)}
    except Exception as exc:
        print("Error de fuente SIATA:", repr(exc), file=sys.stderr)
        status, payload = 502, {"error": "SIATA no respondió a esta consulta. Intenta actualizar en unos minutos."}
    body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": mime, "Cache-Control": cache, **security_headers()}
    if len(body) > 1024 and "gzip" in accept_encoding and not mime.startswith("image/"):
        body = gzip.compress(body)
        headers.update({"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    headers["Content-Length"] = str(len(body))
    return status, headers, body


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        status, headers, body = response_for_url(self.path, self.headers.get("Accept-Encoding", ""))
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        status, headers, _ = response_for_url(self.path, self.headers.get("Accept-Encoding", ""))
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    class LocalServer(ThreadingHTTPServer):
        allow_reuse_address = False
    server = LocalServer(("127.0.0.1", port), Handler)
    print(f"Geovisor SIATA: http://127.0.0.1:{port}/", flush=True)
    server.serve_forever()
