"""Shared route dependencies."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, TypeVar

from fastapi import HTTPException, Request

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


def translate_store_errors(call: Callable[[], T], incident_id: str) -> T:
    try:
        return call()
    except UnknownIncident:
        raise HTTPException(status_code=404, detail=f"No incident '{incident_id}'.") from None
    except IdempotencyConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
