"""Incident routes: state, Dana's facts, actions, help calls."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from auth import Actor, require_actor, require_member
from engine.actions import MAX_TEXT_CHARS, apply_action, request_hint
from engine.state import ACTIONS
from engine.views import facts_view, state_view

from .deps import Runtime, get_runtime, translate_store_errors

router = APIRouter(prefix="/api/incident", tags=["incident"])
ActionName = Literal[ACTIONS]  # type: ignore[valid-type]


class ActionRequest(BaseModel):
    action: ActionName
    idempotency_key: str = Field(min_length=1, max_length=128)
    panel: str | None = Field(default=None, max_length=32)
    text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)


@router.get("/{incident_id}")
def get_incident(incident_id: str, rt: Runtime = Depends(get_runtime)) -> dict:
    state, now = translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    return state_view(state, rt.scenario, now)


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
        new_state, hint = request_hint(state, rt.scenario, now)
        return new_state, {**hint, "hint_calls": new_state.hint_calls}

    return translate_store_errors(lambda: rt.store.change(incident_id, change), incident_id)
