"""Dana, the AI engineering manager (voice + text fallback).

Backend mounts it with:
    from voice import router as dana_router
    app.include_router(dana_router)
"""
from .relay import router  # noqa: F401
