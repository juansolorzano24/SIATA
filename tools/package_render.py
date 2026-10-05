"""Preparar los archivos del geovisor para subirlos a GitHub y Render."""

from pathlib import Path
from shutil import copy2
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "publicar-render"
ARCHIVE = ROOT / "dist" / "lluvia-aburra-render.zip"
FILES = [
    ".gitignore", ".dockerignore", ".python-version", "render.yaml", "requirements.txt",
    "serve.py", "server.py", "wsgi.py", "Dockerfile", "Procfile", "README.md", "PUBLICACION.md",
    "index.html", "scripts.js", "styles.css", "coverage.js", "pwa.js", "manifest.webmanifest",
    "service-worker.js", "data/siata_catalog.json", "data/forecast_zones.geojson",
    "data/medellin_sectors.geojson", "tools/package_render.py",
    "tools/import_siata_geography.py", "tools/create_icons.py", "tools/vendor_leaflet.py",
    "tests/test_data.py", "tests/coverage.test.js", "tests/pwa.test.js",
]


def prepare():
    files = [ROOT / name for name in FILES]
    files += [file for file in (ROOT / "vendor" / "leaflet").rglob("*") if file.is_file()]
    files += [file for file in (ROOT / "icons").rglob("*")
              if file.is_file() and file.suffix.lower() in {".png", ".svg", ".ico"}]
    files = sorted(set(files))
    for destination in (FOLDER, ARCHIVE):
        if not destination.resolve().is_relative_to(ROOT):
            raise ValueError("La carpeta de publicación debe permanecer dentro del proyecto")
    for file in files:
        if not file.is_file() or not file.resolve().is_relative_to(ROOT):
            raise ValueError(f"Falta un archivo de publicación o está fuera del proyecto: {file.name}")

    # Evitar que archivos agregados a mano entren en una nueva publicación.
    expected = {file.relative_to(ROOT).as_posix() for file in files}
    unexpected = [file.relative_to(FOLDER).as_posix() for file in FOLDER.rglob("*")
                  if file.is_file() and file.relative_to(FOLDER).as_posix() not in expected
                  and ".git" not in file.relative_to(FOLDER).parts
                  and "__pycache__" not in file.relative_to(FOLDER).parts]
    if unexpected:
        raise ValueError("La carpeta de publicación tiene archivos adicionales; revisar antes de continuar: " +
                         ", ".join(unexpected))

    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(ARCHIVE, "w", compression=ZIP_DEFLATED) as bundle:
        for file in files:
            relative = file.relative_to(ROOT)
            destination = FOLDER / relative
            if not destination.resolve().is_relative_to(FOLDER.resolve()):
                raise ValueError("Un archivo de destino está fuera de la carpeta de publicación")
            destination.parent.mkdir(parents=True, exist_ok=True)
            copy2(file, destination)
            bundle.write(file, relative.as_posix())
    return {"folder": str(FOLDER), "archive": str(ARCHIVE), "file_count": len(files),
            "archive_bytes": ARCHIVE.stat().st_size,
            "sha256": hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()}


if __name__ == "__main__":
    print(json.dumps(prepare(), ensure_ascii=False, indent=2))
