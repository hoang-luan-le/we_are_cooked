"""Incident Lab API + Dana's voice socket on one port.

Run from services/api:  uvicorn main:app --reload --port 8000
(.env is read from the repo root.)
"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from config import Settings
from routes import debrief, demo, incidents
from routes.deps import Runtime
from scenario_loader import ScenarioError, load_scenario
from store import IncidentStore
from voice import router as dana_router

logger = logging.getLogger("incident_lab.api")
DEMO_START_LEVEL = "explore"


def _start_runtime(settings: Settings, clock: Callable[[], float]) -> tuple[Runtime | None, str | None]:
    try:
        scenario = load_scenario(settings.scenario_path)
    except ScenarioError as exc:
        logger.error("Scenario not loaded from %s: %s", settings.scenario_path, exc.reason)
        return None, exc.reason
    store = IncidentStore(scenario, clock)
    store.reset(scenario.spec.incident_id, DEMO_START_LEVEL)
    logger.info("Scenario %s loaded; demo incident %s ready", scenario.id, scenario.spec.incident_id)
    return Runtime(scenario=scenario, store=store), None


def create_app(settings: Settings | None = None, clock: Callable[[], float] = time.monotonic) -> FastAPI:
    resolved = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = resolved
        app.state.runtime, app.state.scenario_error = _start_runtime(resolved, clock)
        yield

    app = FastAPI(title="Incident Lab API", version="0.2.0", lifespan=lifespan)
    app.include_router(incidents.router)
    app.include_router(debrief.router)
    app.include_router(demo.router)
    app.include_router(dana_router)  # WS /ws/voice (owned by AI)

    @app.get("/health")
    def health(request: Request) -> JSONResponse:
        runtime: Runtime | None = request.app.state.runtime
        if runtime is None:
            return JSONResponse(
                status_code=503,
                content={"status": "degraded",
                         "scenario": {"loaded": False, "error": request.app.state.scenario_error}},
            )
        return JSONResponse(
            status_code=200,
            content={"status": "ok", "scenario": {"loaded": True, "id": runtime.scenario.id},
                     "demo_incident": runtime.scenario.spec.incident_id,
                     "demo_mode": request.app.state.settings.demo_mode},
        )

    return app


app = create_app()
