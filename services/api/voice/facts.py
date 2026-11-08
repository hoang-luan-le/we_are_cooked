"""Dana's link to the backend (contract section 5): /facts, /hint, /debrief.

DANA_FACTS=fake uses fake_facts.json for /facts only (Phase 1 dev); /hint and /debrief need the backend.
"""
import json

import httpx

from .config import DANA_FACTS, HERE, INTERNAL_KEY

_FAKE = json.loads((HERE / "fake_facts.json").read_text(encoding="utf-8"))
MAX_ANSWER_CHARS = 3000


def _url(path: str) -> str:
    return f"{DANA_FACTS.rstrip('/')}{path}"


def _auth(user: str) -> dict:
    # Contract 5c: the relay uses the shared key; X-Demo-User only works in demo mode for DEMO_TEAM.
    return {"X-Internal-Key": INTERNAL_KEY} if INTERNAL_KEY else {"X-Demo-User": user}


async def get_facts(incident_id: str) -> dict:
    if DANA_FACTS == "fake":
        return {**_FAKE, "incident_id": incident_id}
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            r = await client.get(_url(f"/api/incident/{incident_id}/facts"))
            r.raise_for_status()
            return r.json()
    except Exception as e:  # noqa: BLE001  (never crash a live call)
        return {"error": f"Incident facts are unavailable right now ({type(e).__name__})."}


async def _post(path: str, user: str, body: dict | None = None) -> dict:
    if DANA_FACTS == "fake":
        return {"error": "backend_needed"}
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.post(_url(path), json=body, headers=_auth(user))
        if r.status_code == 409:
            return {"error": "not_ready", "detail": r.json().get("detail", "")}
        r.raise_for_status()
        return r.json()
    except Exception as e:  # noqa: BLE001
        return {"error": f"backend_unavailable ({type(e).__name__})"}


async def request_hint(incident_id: str, user: str) -> dict:
    """Once per help call: returns {topic, hint, hint_calls}, counts the call, clears the nudge."""
    return await _post(f"/api/incident/{incident_id}/hint", user)


async def post_debrief(incident_id: str, user: str, answer: str) -> dict:
    return await _post("/api/debrief", user, {"incident_id": incident_id, "answer": answer[:MAX_ANSWER_CHARS]})
