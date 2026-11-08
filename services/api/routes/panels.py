"""Panel routes: GET .../logs, .../deploys, .../runbooks[/{name}], .../metrics/history.

Reads stay open like GET /api/incident/{id}; opening a panel is still recorded through
POST .../action {"action": "open_panel"} so Dana's facts unlock.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from engine.panels import (
    LEVELS, MAX_HISTORY_WINDOW_S, MAX_LOG_LINES, MIN_HISTORY_STEP_S,
    deploy_history, metrics_history, recent_logs, runbook, runbook_index,
)

from .deps import Runtime, get_runtime, translate_store_errors

router = APIRouter(prefix="/api/incident", tags=["panels"])


@router.get("/{incident_id}/logs")
def get_logs(
    incident_id: str,
    limit: int = Query(default=MAX_LOG_LINES, ge=1, le=MAX_LOG_LINES),
    level: Literal[LEVELS] | None = None,  # type: ignore[valid-type]
    q: str | None = Query(default=None, max_length=50),
    rt: Runtime = Depends(get_runtime),
) -> dict:
    state, now = translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    return {"lines": recent_logs(state, rt.scenario, now, limit=limit, level=level, query=q)}


@router.get("/{incident_id}/deploys")
def get_deploys(incident_id: str, request: Request, rt: Runtime = Depends(get_runtime)) -> dict:
    state, _ = translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    github = getattr(request.app.state, "github", None)
    diffs = github.release_diffs(rt.scenario) if github is not None else None
    return deploy_history(state, rt.scenario, diffs)


@router.get("/{incident_id}/runbooks")
def get_runbooks(incident_id: str, rt: Runtime = Depends(get_runtime)) -> dict:
    translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    return {"runbooks": runbook_index(rt.scenario)}


@router.get("/{incident_id}/runbooks/{name}")
def get_runbook(incident_id: str, name: str, rt: Runtime = Depends(get_runtime)) -> dict:
    translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    book = runbook(rt.scenario, name)
    if book is None:
        raise HTTPException(status_code=404, detail=f"No runbook '{name}'.")
    return book


@router.get("/{incident_id}/metrics/history")
def get_metrics_history(
    incident_id: str,
    window_s: int = Query(default=900, ge=MIN_HISTORY_STEP_S, le=MAX_HISTORY_WINDOW_S),
    step_s: int = Query(default=10, ge=MIN_HISTORY_STEP_S, le=300),
    rt: Runtime = Depends(get_runtime),
) -> dict:
    state, now = translate_store_errors(lambda: rt.store.get(incident_id), incident_id)
    return metrics_history(state, rt.scenario, now, window_s=window_s, step_s=step_s)
