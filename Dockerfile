FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home app
COPY server.py serve.py wsgi.py index.html scripts.js styles.css coverage.js pwa.js manifest.webmanifest service-worker.js ./
COPY vendor ./vendor
COPY icons ./icons
COPY data/siata_catalog.json data/forecast_zones.geojson data/medellin_sectors.geojson ./data/
RUN chown -R app:app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ['PORT']+'/healthz',timeout=4)"
CMD ["python", "serve.py"]
