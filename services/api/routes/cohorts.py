"""Cohort routes: POST /api/cohorts, POST /api/cohorts/join, GET /api/cohorts/{id}. All need a member."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from auth import Actor, require_member
from cohorts import JOIN_CODE_LENGTH, Cohort, CohortFull, CohortNotFound, CohortStore, normalize_code

MAX_NAME_CHARS = 60
router = APIRouter(prefix="/api/cohorts", tags=["cohorts"])


class CreateCohortRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_CHARS)

    @field_validator("name")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("name must not be blank")
        return cleaned


class JoinCohortRequest(BaseModel):
    join_code: str = Field(max_length=JOIN_CODE_LENGTH + 4)

    @field_validator("join_code")
    @classmethod
    def _six_characters(cls, value: str) -> str:
        code = normalize_code(value)
        if len(code) != JOIN_CODE_LENGTH:
            raise ValueError(f"join code must be {JOIN_CODE_LENGTH} characters")
        return code


def get_cohorts(request: Request) -> CohortStore:
    return request.app.state.cohorts


def cohort_view(cohort: Cohort) -> dict:
    return {
        "id": cohort.id,
        "name": cohort.name,
        "join_code": cohort.join_code,
        "created_by": cohort.created_by,
        "members": [{"handle": handle} for handle in cohort.members],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_cohort(
    body: CreateCohortRequest, actor: Actor = Depends(require_member), store: CohortStore = Depends(get_cohorts),
) -> dict:
    return cohort_view(store.create(body.name, actor.handle))


@router.post("/join")
def join_cohort(
    body: JoinCohortRequest, actor: Actor = Depends(require_member), store: CohortStore = Depends(get_cohorts),
) -> dict:
    try:
        return cohort_view(store.join(body.join_code, actor.handle))
    except CohortNotFound:
        raise HTTPException(status_code=404, detail="No cohort with that join code.") from None
    except CohortFull:
        raise HTTPException(status_code=409, detail="That cohort is full.") from None


@router.get("/{cohort_id}")
def get_cohort(
    cohort_id: str, actor: Actor = Depends(require_member), store: CohortStore = Depends(get_cohorts),
) -> dict:
    try:
        return cohort_view(store.get_for_member(cohort_id, actor.handle))
    except CohortNotFound:
        raise HTTPException(status_code=404, detail="No such cohort.") from None
