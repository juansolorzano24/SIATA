"""Guarda Leaflet 1.9.4 y su licencia para servir la app desde el mismo dominio."""
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1] / "vendor" / "leaflet"
FILES = ["leaflet.js", "leaflet.css", "images/layers.png", "images/layers-2x.png", "images/marker-icon.png", "images/marker-icon-2x.png", "images/marker-shadow.png"]
for filename in FILES:
    path = ROOT / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(urlopen("https://unpkg.com/leaflet@1.9.4/dist/" + filename, timeout=30).read())
(ROOT / "LICENSE").write_bytes(urlopen("https://unpkg.com/leaflet@1.9.4/LICENSE", timeout=30).read())
print("Leaflet 1.9.4 guardado localmente")
