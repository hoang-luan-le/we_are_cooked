"""Shift handoff: POST/GET /api/incident/{id}/handoff and POST .../handoff/rating."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from auth import Actor, require_member
from engine.handoff import rate_handoff, write_handoff
from engine.state import HANDOFF_PARTS, RATING_MAX, RATING_MIN
from engine.views import handoff_view, state_view

from .deps import Runtime, get_runtime, require_teammate, translate_store_errors
from .incidents import known_handles

MAX_PART_CHARS = 1000
MAX_MORNING_PAIR = 4
MAX_NOTE_CHARS = 200   # "rates the handoff 1-5 with one line"
router = APIRouter(prefix="/api/incident", tags=["handoff"])


class HandoffRequest(BaseModel):
    """What happened · current state · what was tried · what is still risky."""

    what_happened: str = Field(min_length=1, max_length=MAX_PART_CHARS)
    current_state: str = Field(min_length=1, max_length=MAX_PART_CHARS)
    tried: str = Field(min_length=1, max_length=MAX_PART_CHARS)
    risks: str = Field(min_length=1, max_length=MAX_PART_CHARS)
    morning_pair: list[str] = Field(default_factory=list, max_length=MAX_MORNING_PAIR)  # join as teammates

    def parts(self) -> dict[str, str]:
        return {part: getattr(self, part) for part in HANDOFF_PARTS}

    @field_validator(*HANDOFF_PARTS)
    @classmethod
    def _not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be blank")
        return cleaned


class RatingRequest(BaseModel):
    score: int = Field(ge=RATING_MIN, le=RATING_MAX)
    note: str = Field(default="", max_length=MAX_NOTE_CHARS)

    @field_validator("note")
    @classmethod
    def _one_line(cls, value: str) -> str:
        if "\n" in value or "\r" in value:
            raise ValueError("note must be one line")
        return value.strip()


@router.post("/{incident_id}/handoff")
def post_handoff(
    incident_id: str,
    body: HandoffRequest,
    request: Request,
    actor: Actor = Depends(require_member),
    rt: Runtime = Depends(get_runtime),
) -> dict:
    settings = request.app.state.settings

    def change(state, now):
        require_teammate(state, actor)  # before known_handles, so outsiders learn nothing about handles
        morning_pair = known_handles(settings, body.morning_pair)
        new_state = write_handoff(state, actor=actor.handle, parts=body.parts(), morning_pair=morning_pair, now=now)
        return new_state, state_view(new_state, rt.scenario, now)

    return translate_store_errors(lambda: rt.store.change(incident_id, change), incident_id)


@router.get("/{incident_id}/handoff")
def get_handoff(incident_id: str, rt: Runtime = Depends(get_runtime)) -> dict:
    state, _ = translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    handoff = handoff_view(state, rt.scenario)
    if handoff is None:
        raise HTTPException(status_code=404, detail="No handoff written yet.")
    return handoff


@router.post("/{incident_id}/handoff/rating")
def post_rating(
    incident_id: str, body: RatingRequest, actor: Actor = Depends(require_member), rt: Runtime = Depends(get_runtime),
) -> dict:
    def change(state, now):
        require_teammate(state, actor)
        new_state = rate_handoff(state, actor=actor.handle, score=body.score, note=body.note, now=now)
        return new_state, handoff_view(new_state, rt.scenario)

    return translate_store_errors(lambda: rt.store.change(incident_id, change), incident_id)
