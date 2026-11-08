"""POST /api/debrief: the learner's words to customers/VP -> the rubric score."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth import Actor, require_actor
from engine.actions import ActionRejected, record_debrief
from engine.rubric import build_rubric

from .deps import Runtime, get_runtime, translate_store_errors

MAX_ANSWER_CHARS = 3000
router = APIRouter(prefix="/api", tags=["debrief"])


class DebriefRequest(BaseModel):
    incident_id: str = Field(min_length=1, max_length=64)
    answer: str = Field(min_length=1, max_length=MAX_ANSWER_CHARS)

    @field_validator("answer")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("answer must not be blank")
        return cleaned


@router.post("/debrief")
def post_debrief(body: DebriefRequest, actor: Actor = Depends(require_actor), rt: Runtime = Depends(get_runtime)) -> dict:
    def change(state, now):
        new_state = record_debrief(state, actor=actor.handle, answer=body.answer, now=now)
        return new_state, {**build_rubric(new_state, rt.scenario), "answer": body.answer}

    try:
        return translate_store_errors(lambda: rt.store.change(body.incident_id, change), body.incident_id)
    except ActionRejected as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from None
