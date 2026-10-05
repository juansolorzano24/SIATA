"""Importa los polígonos públicos de SIATA, sin aproximar zonas con círculos."""
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://siata.gov.co"
FORECAST = "/kml/Pronostico%20%28Experimental%29/Meteorologico.kml"
SECTORS = "/kml/04_Divisiones/04_Medellin/"
NS = {"k": "http://www.opengis.net/kml/2.2"}


def polygons(path):
    root = ET.fromstring(urlopen(BASE + path, timeout=30).read())
    result = []
    for placemark in root.findall(".//k:Placemark", NS):
        parts = []
        for polygon in placemark.findall(".//k:Polygon", NS):
            rings = []
            for boundary in polygon.findall("k:outerBoundaryIs", NS) + polygon.findall("k:innerBoundaryIs", NS):
                coordinates = boundary.findtext(".//k:coordinates", namespaces=NS) or ""
                ring = [[round(float(v), 6) for v in token.split(",")[:2]] for token in coordinates.split()]
                if len(ring) >= 4:
                    if ring[0] != ring[-1]:
                        ring.append(ring[0])
                    rings.append(ring)
            if rings:
                parts.append(rings)
        if parts:
            result.append({"type": "Feature", "properties": {"name": placemark.findtext("k:name", namespaces=NS).strip(),
                           "source": BASE + path}, "geometry": {"type": "MultiPolygon", "coordinates": parts}})
    return result


def write(name, features, sources):
    data = {"type": "FeatureCollection", "sources": sources, "imported_at": datetime.now(timezone.utc).isoformat(),
            "attribution": "AMVA–SIATA", "features": features}
    (ROOT / "data" / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(name, len(features), "polígonos")


def main():
    forecasts = polygons(FORECAST)
    for feature in forecasts:
        name = feature["properties"]["name"]
        if name == "Santa Elena":
            name = "Medellín Oriente"
        elif name.startswith("Medellin"):
            name = name.replace("Medellin", "Medellín")
        elif name.startswith("Itag"):
            name = "Itagüí"
        feature["properties"].update(name=name, municipality="Medellín" if name.startswith("Medellín") else name)
    communes = polygons(SECTORS + "Comunas.kml")
    rural = polygons(SECTORS + "Corregimientos.kml")
    # Algunos KML antiguos contienen nombres con caracteres de codificación dañados.
    names = {12: "La América", 16: "Belén", 60: "San Cristóbal"}
    sectors = []
    for feature in communes + rural:
        match = re.match(r"(\d+)\s+(.+)", feature["properties"]["name"])
        if not match:  # San Javier ya aparece con su número; evita el duplicado antiguo.
            continue
        number, name = int(match[1]), match[2]
        feature["properties"].update(name=names.get(number, name), code=number,
                                     kind="comuna" if number <= 16 else "corregimiento")
        sectors.append(feature)
        if number == 50:
            forecasts.append({**feature, "properties": {**feature["properties"], "name": "Palmitas", "municipality": "Medellín"}})
    assert len(forecasts) == 13 and len(sectors) == 21
    write("forecast_zones.geojson", forecasts, [BASE + FORECAST, BASE + SECTORS + "Corregimientos.kml"])
    write("medellin_sectors.geojson", sectors, [BASE + SECTORS + "Comunas.kml", BASE + SECTORS + "Corregimientos.kml"])


if __name__ == "__main__":
    main()
