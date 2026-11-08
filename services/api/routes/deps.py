"""Shared route dependencies."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, TypeVar

from fastapi import HTTPException, Request

from auth import Actor
from engine.errors import ActionRejected, conflict
from engine.state import IncidentState
from scenario_loader import Scenario
from store import IdempotencyConflict, IncidentStore, UnknownIncident

T = TypeVar("T")


@dataclass(frozen=True)
class Runtime:
    scenario: Scenario
    store: IncidentStore


def get_runtime(request: Request) -> Runtime:
    runtime: Runtime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="Scenario not loaded. See GET /health.")
    return runtime


def require_teammate(state: IncidentState, actor: Actor) -> None:
    """Only teammates act on an incident (design doc). The relay key is allowed where the route allows it."""
    if actor.internal:
        return
    if actor.handle not in state.all_teammates:
        raise ActionRejected(403, "not_teammate", "Only teammates on this incident can do that.")


def translate_store_errors(call: Callable[[], T], incident_id: str) -> T:
    try:
        return call()
    except UnknownIncident:
        raise HTTPException(status_code=404, detail=f"No incident '{incident_id}'.") from None
    except IdempotencyConflict as exc:
        raise conflict("idempotency_conflict", str(exc)) from None
