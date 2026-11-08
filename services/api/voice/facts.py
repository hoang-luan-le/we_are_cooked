"""Where Dana's knowledge comes from: GET /api/incident/{id}/facts (or a fake file in Phase 1)."""
import json

import httpx

from .config import DANA_FACTS, HERE

_FAKE = json.loads((HERE / "fake_facts.json").read_text(encoding="utf-8"))


async def get_facts(incident_id: str) -> dict:
    if DANA_FACTS == "fake":
        return {**_FAKE, "incident_id": incident_id}
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            r = await client.get(f"{DANA_FACTS.rstrip('/')}/api/incident/{incident_id}/facts")
            r.raise_for_status()
            return r.json()
    except Exception as e:  # noqa: BLE001  (never crash a live call)
        return {"error": f"Incident facts are unavailable right now ({type(e).__name__})."}
