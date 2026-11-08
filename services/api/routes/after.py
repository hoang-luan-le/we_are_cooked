"""After the incident: GET /api/jobs (saved snapshot) and the before/after check (GET/POST /api/checks).

The check asks the same question before and after the incident. Scores come from the scenario's
answer key and are shown only once both answers are in, so the "before" answer never gives the
lesson away (and the answer key itself never leaves the server).
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

import oss
from adzuna import load_snapshot
from auth import Actor, require_member
from engine.errors import conflict, invalid

from .deps import Runtime, get_runtime, require_teammate, translate_store_errors

MAX_EXPLANATION_CHARS = 500
AFTER_PHASES = ("stabilized", "handed_off", "fixed", "debriefed")
router = APIRouter(prefix="/api", tags=["after"])


@router.get("/jobs")
def get_jobs(request: Request) -> dict:
    snapshot = load_snapshot(request.app.state.settings.jobs_snapshot_path)
    if snapshot is None:
        return {"source": "Adzuna", "fetched_at": None, "searches": [],
                "message": "No job snapshot saved yet. Run python adzuna.py before the demo."}
    return snapshot


@router.get("/next-fixes")
def get_next_fixes(request: Request) -> dict:
    """Real open "good first issue" issues saved by `python oss.py`, grouped by practised skill."""
    snapshot = oss.load_snapshot(request.app.state.settings.next_fixes_snapshot_path)
    if snapshot is None:
        return {"source": "GitHub", "fetched_at": None, "searches": [],
                "message": "No open-source snapshot saved yet. Run python oss.py before the demo."}
    return snapshot


class CheckRequest(BaseModel):
    incident_id: str = Field(min_length=1, max_length=64)
    stage: Literal["before", "after"]
    choice: str = Field(min_length=1, max_length=8)
    explanation: str = Field(default="", max_length=MAX_EXPLANATION_CHARS)


def _view(rt: Runtime, answers: dict, incident_id: str) -> dict:
    """Scores only when both stages are answered."""
    check = rt.scenario.spec.check
    both = "before" in answers and "after" in answers
    stages = {
        stage: None if stage not in answers else {
            "choice": answers[stage]["choice"], "explanation": answers[stage]["explanation"],
            **({"score": answers[stage]["score"]} if both else {}),
        }
        for stage in ("before", "after")
    }
    return {"incident_id": incident_id, "question": check.question,
            "choices": [{"id": c.id, "text": c.text} for c in check.choices], **stages,
            "improved": (answers["after"]["score"] - answers["before"]["score"]) if both else None}


@router.get("/checks")
def get_checks(request: Request, incident_id: str = Query(min_length=1, max_length=64),
               actor: Actor = Depends(require_member), rt: Runtime = Depends(get_runtime)) -> dict:
    translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    return _view(rt, request.app.state.checks.answers(actor.handle, incident_id), incident_id)


@router.post("/checks")
def post_check(body: CheckRequest, request: Request, actor: Actor = Depends(require_member),
               rt: Runtime = Depends(get_runtime)) -> dict:
    state, _ = translate_store_errors(lambda: rt.store.get(body.incident_id), body.incident_id)
    require_teammate(state, actor)
    if body.choice not in {c.id for c in rt.scenario.spec.check.choices}:
        raise invalid("unknown_choice", "Pick one of the listed choices.")
    store = request.app.state.checks
    answers = store.answers(actor.handle, body.incident_id)
    if body.stage == "before" and "after" in answers:
        raise conflict("check_closed", "The before check is closed once the after check is in.")
    if body.stage == "after" and (state.phase not in AFTER_PHASES or "before" not in answers):
        raise conflict("check_not_ready", "The after check opens once checkout is stable and the before check is in.")
    score = rt.scenario.answer_key.check_scores.get(body.choice, 0)
    store.save(actor.handle, body.incident_id, body.stage, body.choice, body.explanation.strip(), score)
    return _view(rt, store.answers(actor.handle, body.incident_id), body.incident_id)
