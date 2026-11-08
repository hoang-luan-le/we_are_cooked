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
CREATE TABLE IF NOT EXISTS users (
    handle       TEXT PRIMARY KEY,   -- pseudonymous
    github_login TEXT,
    contact      TEXT,               -- shown only to mutual connections
    public_evidence INTEGER NOT NULL DEFAULT 0,   -- opt-in: evidence page visible to anyone
    updated      REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
    incident_id TEXT NOT NULL,
    from_user   TEXT NOT NULL,
    to_user     TEXT NOT NULL,
    work_again  INTEGER NOT NULL,    -- private answer: "work with them again?"
    note        TEXT NOT NULL,
    updated     REAL NOT NULL,
    PRIMARY KEY (incident_id, from_user, to_user)
);
CREATE TABLE IF NOT EXISTS before_after (
    handle      TEXT NOT NULL,
    incident_id TEXT NOT NULL,
    stage       TEXT NOT NULL,       -- before | after
    decision    TEXT NOT NULL,
    explanation TEXT NOT NULL,
    score       INTEGER NOT NULL,
    updated     REAL NOT NULL,
    PRIMARY KEY (handle, incident_id, stage)
);
CREATE TABLE IF NOT EXISTS accounts (
    auth_sub TEXT PRIMARY KEY,       -- Auth0 subject; never shown to anyone
    handle   TEXT NOT NULL UNIQUE,   -- the pseudonymous handle people see
    created  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS cohort_members (
    cohort_id TEXT NOT NULL REFERENCES cohorts(id),
    handle    TEXT NOT NULL,
    joined    REAL NOT NULL,
    PRIMARY KEY (cohort_id, handle)
);
"""


class _NetworkTables:
    """users + connections, mixed into Database below."""

    def save_user(self, handle: str, github_login: str | None, contact: str | None, public_evidence: bool,
                  updated: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO users (handle, github_login, contact, public_evidence, updated) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(handle) DO UPDATE SET github_login=excluded.github_login, "
                "contact=excluded.contact, public_evidence=excluded.public_evidence, updated=excluded.updated",
                (handle, github_login, contact, int(public_evidence), updated),
            )

    def load_users(self) -> list[tuple[str, str | None, str | None, int]]:
        with self._lock:
            return self._conn.execute("SELECT handle, github_login, contact, public_evidence FROM users").fetchall()

    def save_connection(self, incident_id: str, from_user: str, to_user: str, work_again: bool,
                        note: str, updated: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO connections VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(incident_id, from_user, to_user) DO UPDATE SET "
                "work_again=excluded.work_again, note=excluded.note, updated=excluded.updated",
                (incident_id, from_user, to_user, int(work_again), note, updated),
            )

    def save_check(self, handle: str, incident_id: str, stage: str, decision: str, explanation: str,
                   score: int, updated: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO before_after VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(handle, incident_id, stage) DO UPDATE SET decision=excluded.decision, "
                "explanation=excluded.explanation, score=excluded.score, updated=excluded.updated",
                (handle, incident_id, stage, decision, explanation, score, updated),
            )

    def load_checks(self) -> list[tuple]:
        with self._lock:
            return self._conn.execute(
                "SELECT handle, incident_id, stage, decision, explanation, score FROM before_after").fetchall()

    def save_account(self, auth_sub: str, handle: str, created: float) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT INTO accounts (auth_sub, handle, created) VALUES (?, ?, ?)",
                               (auth_sub, handle, created))

    def load_accounts(self) -> list[tuple[str, str]]:
        with self._lock:
            return self._conn.execute("SELECT auth_sub, handle FROM accounts").fetchall()

    def load_connections(self) -> list[tuple[str, str, str, int, str]]:
        with self._lock:
            return self._conn.execute(
                "SELECT incident_id, from_user, to_user, work_again, note FROM connections").fetchall()


class Database(_NetworkTables):
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
            self._migrate()

    def _migrate(self) -> None:
        """Columns added after a table first shipped (caller holds the lock and a transaction)."""
        columns = {row[1] for row in self._conn.execute("PRAGMA table_info(users)")}
        if "public_evidence" not in columns:
            self._conn.execute("ALTER TABLE users ADD COLUMN public_evidence INTEGER NOT NULL DEFAULT 0")

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
