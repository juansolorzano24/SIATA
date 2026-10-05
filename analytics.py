"""Configuración pública de estadísticas. Nunca expone credenciales del panel."""

import os
import re
from uuid import UUID


UMAMI_ORIGIN = "https://cloud.umami.is"
UMAMI_COLLECTOR_ORIGIN = "https://gateway.umami.is"
DOMAIN = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")


def public_config():
    """Sin un ID real y dominios válidos no se carga el servicio externo."""
    value = os.environ.get("UMAMI_WEBSITE_ID", "").strip()
    try:
        website_id = str(UUID(value))
        if UUID(website_id).int == 0:
            return {"enabled": False}
    except (ValueError, AttributeError):
        return {"enabled": False}
    domains = list(dict.fromkeys(part.strip().lower() for part in
                   os.environ.get("UMAMI_DOMAINS", "siata.onrender.com").split(",")))
    if not domains or len(domains) > 20 or any(not DOMAIN.fullmatch(domain) for domain in domains):
        return {"enabled": False}
    return {"enabled": True, "website_id": website_id,
            "script_url": UMAMI_ORIGIN + "/script.js", "domains": domains}
