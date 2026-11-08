"""Incident Lab API + Dana's voice socket on one port.

Run from services/api:  uvicorn main:app --reload --port 8000
(.env is read from the repo root.)
"""
from __future__ import annotations

import logging
import sqlite3
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator, Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cohorts import CohortStore
from config import Settings
from db import MEMORY, Database, open_database
from engine.errors import ActionRejected
from routes import cohorts, debrief, demo, handoff, incidents
from routes.deps import Runtime
from scenario_loader import ScenarioError, load_scenario
from store import IncidentStore
from voice import router as dana_router

logger = logging.getLogger("incident_lab.api")
DEMO_START_LEVEL = "explore"


def _start_runtime(
    settings: Settings, clock: Callable[[], float], db: Database,
) -> tuple[Runtime | None, str | None]:
    try:
        scenario = load_scenario(settings.scenario_path)
    except ScenarioError as exc:
        logger.error("Scenario not loaded from %s: %s", settings.scenario_path, exc.reason)
        return None, exc.reason
    store = IncidentStore(scenario, clock, db)
    # The fixed demo incident survives restarts: only created if the database doesn't have it.
    store.ensure(scenario.spec.incident_id, DEMO_START_LEVEL, settings.demo_team)
    logger.info("Scenario %s loaded; %d incident(s) ready", scenario.id, len(store.ids()))
    return Runtime(scenario=scenario, store=store), None


def _open_database_or_memory(settings: Settings) -> Database:
    """Never let the demo depend on the database: if it can't be opened, run from memory."""
    try:
        return open_database(settings.database_url, settings.sqlite_path)
    except sqlite3.Error:
        logger.exception("Could not open the database; running from memory, nothing will be saved")
        return Database(MEMORY)


CORS_HEADERS = ["Content-Type", "Authorization", "X-Demo-User", "X-Internal-Key"]


def _add_cors(app: FastAPI, settings: Settings) -> None:
    """CORS_ORIGINS limits browsers to the web app's origin; empty allows all (dev only)."""
    origins = list(settings.cors_origins) or ["*"]
    if origins == ["*"]:
        logger.warning("CORS_ORIGINS is empty: allowing every origin (dev only)")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=CORS_HEADERS,
        allow_credentials=False,
    )


async def _rejected(request: Request, exc: ActionRejected) -> JSONResponse:
    """Engine rejections as {"code", "detail"} so the UI can show a plain message per code."""
    return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "detail": exc.message})


def create_app(settings: Settings | None = None, clock: Callable[[], float] = time.time) -> FastAPI:
    """`clock` is wall-clock seconds: saved snapshots must still mean something after a restart."""
    resolved = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        db = _open_database_or_memory(resolved)
        app.state.settings = resolved
        app.state.db = db
        app.state.cohorts = CohortStore(db, clock)  # independent of the scenario
        app.state.runtime, app.state.scenario_error = _start_runtime(resolved, clock, db)
        try:
            yield
        finally:
            db.close()

    app = FastAPI(title="Incident Lab API", version="0.3.0", lifespan=lifespan)
    _add_cors(app, resolved)
    app.add_exception_handler(ActionRejected, _rejected)
    app.include_router(incidents.router)
    app.include_router(handoff.router)
    app.include_router(debrief.router)
    app.include_router(cohorts.router)
    app.include_router(demo.router)
    app.include_router(dana_router)  # WS /ws/voice (owned by AI)

    @app.get("/health")
    def health(request: Request) -> JSONResponse:
        runtime: Runtime | None = request.app.state.runtime
        db: Database = request.app.state.db
        database = {"kind": db.kind, "persistent": db.path != MEMORY,
                    "save_failures": runtime.store.save_failures if runtime else 0}
        if runtime is None:
            return JSONResponse(
                status_code=503,
                content={"status": "degraded", "database": database,
                         "scenario": {"loaded": False, "error": request.app.state.scenario_error}},
            )
        return JSONResponse(
            status_code=200,
            content={"status": "ok", "scenario": {"loaded": True, "id": runtime.scenario.id},
                     "database": database,
                     "demo_incident": runtime.scenario.spec.incident_id,
                     "demo_mode": request.app.state.settings.demo_mode},
        )

    return app


app = create_app()
