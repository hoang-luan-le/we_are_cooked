"""POST /api/demo/reset: restart the demo incident from the 2:04 page."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import Actor, require_member
from engine.state import LEVELS
from engine.views import state_view

from .deps import Runtime, get_runtime

router = APIRouter(prefix="/api/demo", tags=["demo"])


class ResetRequest(BaseModel):
    level: Literal[LEVELS] = "explore"  # type: ignore[valid-type]


@router.get("/team")
def demo_team(request: Request) -> dict:
    """Demo mode only: the handles the web app may 'sign in as' (Auth0 mode answers 404)."""
    settings = request.app.state.settings
    if not settings.demo_mode:
        raise HTTPException(status_code=404, detail="Not in demo mode.")
    return {"team": list(settings.demo_team)}


@router.post("/reset")
def reset_demo(
    body: ResetRequest, request: Request, actor: Actor = Depends(require_member), rt: Runtime = Depends(get_runtime),
) -> dict:
    team = request.app.state.settings.demo_team
    state, now = rt.store.create(rt.scenario.spec.incident_id, body.level, team)
    return state_view(state, rt.scenario, now)
