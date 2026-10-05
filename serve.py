"""Servidor de producción. El proveedor debe terminar HTTPS antes de este proceso."""
import os
from waitress import serve
from wsgi import application

if __name__ == "__main__":
    serve(application, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")),
          threads=12, connection_limit=128, channel_timeout=60,
          max_request_body_size=1024)
