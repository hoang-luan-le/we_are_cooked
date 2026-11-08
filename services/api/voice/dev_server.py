"""Run Dana on her own (Phase 1), before the backend is ready.

    cd services/api
    pip install -r voice/requirements.txt
    uvicorn voice.dev_server:app --port 8001
    open http://localhost:8001

Also serves fake /api/incident/{id}/facts, so DANA_FACTS=http://localhost:8001 tests the HTTP path.
"""
from fastapi import FastAPI
from fastapi.responses import FileResponse

from .config import DANA_FACTS, DANA_MODEL, DEEPGRAM_API_KEY, GEMINI_API_KEY, HERE
from .facts import _FAKE
from .relay import router

app = FastAPI(title="Dana dev server")
app.include_router(router)


@app.get("/")
async def page():
    return FileResponse(HERE / "dev_page.html")


@app.get("/health")
async def health():
    return {"ok": True, "model": DANA_MODEL, "facts": DANA_FACTS,
            "has_deepgram_key": bool(DEEPGRAM_API_KEY), "has_gemini_key": bool(GEMINI_API_KEY)}


@app.get("/api/incident/{incident_id}/facts")
async def fake_facts(incident_id: str):
    return {**_FAKE, "incident_id": incident_id}
