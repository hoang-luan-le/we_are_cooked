"""Incident routes: start, state, Dana's facts, actions, help calls."""
from __future__ import annotations

import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from auth import Actor, is_known_handle, require_actor, require_member
from engine.actions import MAX_TEXT_CHARS, apply_action, request_hint
from engine.errors import invalid
from engine.state import ACTIONS, LEVELS
from engine.views import facts_view, state_view

from .deps import Runtime, get_runtime, require_teammate, translate_store_errors

HANDLE_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,31}")   # pseudonymous handles only
MAX_OTHER_TEAMMATES = 3   # a pair, plus room for a mentor or a third learner
router = APIRouter(prefix="/api/incident", tags=["incident"])
ActionName = Literal[ACTIONS]  # type: ignore[valid-type]


class ActionRequest(BaseModel):
    action: ActionName
    idempotency_key: str = Field(min_length=1, max_length=128)
    panel: str | None = Field(default=None, max_length=32)
    text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)


class StartRequest(BaseModel):
    level: Literal[LEVELS] = "explore"  # type: ignore[valid-type]
    teammates: list[str] = Field(default_factory=list, max_length=MAX_OTHER_TEAMMATES)


def known_handles(request: Request, handles: list[str]) -> tuple[str, ...]:
    """Normalize handles; refuse anyone the API doesn't know (demo team, or claimed handles with Auth0)."""
    cleaned = tuple(dict.fromkeys(h.strip().lower() for h in handles if h.strip()))
    unknown = [h for h in cleaned if not HANDLE_PATTERN.fullmatch(h) or not is_known_handle(request, h)]
    if unknown:
        raise invalid("unknown_handle", f"Unknown handle(s): {', '.join(unknown)}.")
    return cleaned


@router.post("/start", status_code=status.HTTP_201_CREATED)
def start_incident(
    body: StartRequest, request: Request, actor: Actor = Depends(require_member), rt: Runtime = Depends(get_runtime),
) -> dict:
    """A new incident from the 2:04 page. The caller is always a teammate."""
    others = known_handles(request, body.teammates)
    incident_id = f"inc_{secrets.token_hex(4)}"
    state, now = rt.store.create(incident_id, body.level, (actor.handle, *others))
    return state_view(state, rt.scenario, now)


@router.get("/{incident_id}")
def get_incident(incident_id: str, request: Request, rt: Runtime = Depends(get_runtime)) -> dict:
    """Polled every 2-3 s. With Tiger Data, each poll also records one metrics sample per second."""
    state, now = translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    view = state_view(state, rt.scenario, now)
    recorder = getattr(request.app.state, "metrics_recorder", None)
    if recorder is not None:
        recorder.sample(incident_id, now, view["metrics"])
    return view


@router.get("/{incident_id}/facts")
def get_facts(incident_id: str, rt: Runtime = Depends(get_runtime)) -> dict:
    """Dana's only source (hard rule 3). Never includes the answer key."""
    state, now = translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    return facts_view(state, rt.scenario, now)


@router.post("/{incident_id}/action")
def post_action(
    incident_id: str,
    body: ActionRequest,
    actor: Actor = Depends(require_member),
    rt: Runtime = Depends(get_runtime),
) -> dict:
    # Same key + different request (or different person) -> 409, never someone else's reply.
    fingerprint = (actor.handle, body.action, body.panel, body.text)

    def change(state, now):
        require_teammate(state, actor)
        new_state, message = apply_action(
            state, rt.scenario, action=body.action, actor=actor.handle, now=now, panel=body.panel, text=body.text,
        )
        return new_state, {"ok": True, "action": body.action, "message": message,
                           "state": state_view(new_state, rt.scenario, now)}

    # ActionRejected -> {"code", "detail"} via the app's exception handler (main.py).
    return translate_store_errors(
        lambda: rt.store.change_once(incident_id, body.idempotency_key, fingerprint, change), incident_id,
    )


@router.post("/{incident_id}/hint")
def post_hint(incident_id: str, actor: Actor = Depends(require_actor), rt: Runtime = Depends(get_runtime)) -> dict:
    """One help call. Counts once and clears the nudge. The relay calls this; the frontend does not."""
    def change(state, now):
        require_teammate(state, actor)
        new_state, hint = request_hint(state, rt.scenario, now)
        return new_state, {**hint, "hint_calls": new_state.hint_calls}

    return translate_store_errors(lambda: rt.store.change(incident_id, change), incident_id)
