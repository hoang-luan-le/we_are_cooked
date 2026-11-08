"""Persistence: SQLite now; Tiger Data (Postgres) behind the same methods next.

Tables follow the design doc's data model: `incidents` (one JSON snapshot per incident,
rewritten after every change), `cohorts` and `cohort_members`.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any

from cohorts import Cohort

logger = logging.getLogger("incident_lab.db")
MEMORY = ":memory:"

SCHEMA = """
CREATE TABLE IF NOT EXISTS incidents (
    id        TEXT PRIMARY KEY,
    level     TEXT NOT NULL,
    teammates TEXT NOT NULL,          -- JSON list of handles
    snapshot  TEXT NOT NULL,          -- JSON: engine/snapshot.py
    updated   REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS cohorts (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    join_code  TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    created    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS cohort_members (
    cohort_id TEXT NOT NULL REFERENCES cohorts(id),
    handle    TEXT NOT NULL,
    joined    REAL NOT NULL,
    PRIMARY KEY (cohort_id, handle)
);
"""


class Database:
    """One SQLite connection guarded by a lock (FastAPI runs sync routes in a thread pool)."""

    kind = "sqlite"

    def __init__(self, path: str) -> None:
        if path != MEMORY:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        with self._lock, self._conn:
            self._conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ---- incidents ----
    def save_incident(self, incident_id: str, level: str, teammates: tuple[str, ...],
                      snapshot: dict[str, Any], updated: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO incidents (id, level, teammates, snapshot, updated) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET level=excluded.level, teammates=excluded.teammates, "
                "snapshot=excluded.snapshot, updated=excluded.updated",
                (incident_id, level, json.dumps(list(teammates)), json.dumps(snapshot), updated),
            )

    def load_snapshots(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute("SELECT id, snapshot FROM incidents ORDER BY updated").fetchall()
        snapshots = []
        for incident_id, raw in rows:
            try:
                snapshots.append(json.loads(raw))
            except json.JSONDecodeError:
                logger.error("Skipping incident %s: snapshot is not valid JSON", incident_id)
        return snapshots

    # ---- cohorts ----
    def save_cohort(self, cohort: Cohort, created: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO cohorts (id, name, join_code, created_by, created) VALUES (?, ?, ?, ?, ?)",
                (cohort.id, cohort.name, cohort.join_code, cohort.created_by, created),
            )
            self._conn.execute(
                "INSERT INTO cohort_members (cohort_id, handle, joined) VALUES (?, ?, ?)",
                (cohort.id, cohort.created_by, created),
            )

    def add_cohort_member(self, cohort_id: str, handle: str, joined: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO cohort_members (cohort_id, handle, joined) VALUES (?, ?, ?)",
                (cohort_id, handle, joined),
            )

    def load_cohorts(self) -> list[Cohort]:
        with self._lock:
            cohorts = self._conn.execute(
                "SELECT id, name, join_code, created_by FROM cohorts ORDER BY created").fetchall()
            members = self._conn.execute(
                "SELECT cohort_id, handle FROM cohort_members ORDER BY joined, rowid").fetchall()
        by_cohort: dict[str, list[str]] = {}
        for cohort_id, handle in members:
            by_cohort.setdefault(cohort_id, []).append(handle)
        return [
            Cohort(id=cid, name=name, join_code=code, created_by=creator, members=tuple(by_cohort.get(cid, ())))
            for cid, name, code, creator in cohorts
        ]


def open_database(database_url: str, sqlite_path: str) -> Database:
    """DATABASE_URL picks the database; empty or unsupported falls back to local SQLite."""
    url = database_url.strip()
    if url.startswith("sqlite:///"):
        return Database(url.removeprefix("sqlite:///"))
    if url:
        # Tiger Data (Postgres) support is the next step; never let the demo depend on it.
        logger.warning("DATABASE_URL is set but only SQLite is supported so far; using %s", sqlite_path)
    return Database(sqlite_path)
