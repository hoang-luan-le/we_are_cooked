"""TLS for outgoing HTTPS (GitHub, Auth0, Adzuna): trust the operating system's certificate store.

Python's bundled CA list (certifi) doesn't know certificates the OS trusts, such as an antivirus
"HTTPS scanning" root (seen on a demo laptop: Avast Web/Mail Shield) or a corporate proxy. Using the
OS store makes the API trust exactly what the browser trusts. Falls back to certifi if truststore
isn't installed.
"""
from __future__ import annotations

import ssl

try:
    import truststore
except ImportError:  # pragma: no cover - truststore is in requirements.txt
    truststore = None


def verify() -> ssl.SSLContext | bool:
    """Pass as httpx's `verify=`. Certificates are always checked; only the trust store changes."""
    if truststore is None:
        return True
    return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
