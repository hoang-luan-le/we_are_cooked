"""Tiger Data (Postgres + TimescaleDB): same tables and methods as db.Database, plus the metrics hypertable.

`incident_metrics` is a TimescaleDB hypertable: one sample per second per incident while the dashboard
is polled. /metrics/history reads it back with time_bucket. A dropped connection is reopened once per
call; if Tiger Data can't be reached at startup, db.open_database falls back to SQLite.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Callable, TypeVar

import psycopg
from psycopg.types.json import Jsonb

from cohorts import Cohort

logger = logging.getLogger("incident_lab.tigerdata")
CONNECT_TIMEOUT_S = 10
T = TypeVar("T")

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY, level TEXT NOT NULL, teammates JSONB NOT NULL,
        snapshot JSONB NOT NULL, updated DOUBLE PRECISION NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS users (
        handle TEXT PRIMARY KEY, github_login TEXT, contact TEXT,
        public_evidence BOOLEAN NOT NULL DEFAULT FALSE, updated DOUBLE PRECISION NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS connections (
        incident_id TEXT NOT NULL, from_user TEXT NOT NULL, to_user TEXT NOT NULL,
        work_again BOOLEAN NOT NULL, note TEXT NOT NULL, updated DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (incident_id, from_user, to_user))""",
    """CREATE TABLE IF NOT EXISTS before_after (
        handle TEXT NOT NULL, incident_id TEXT NOT NULL, stage TEXT NOT NULL, decision TEXT NOT NULL,
        explanation TEXT NOT NULL, score INTEGER NOT NULL, updated DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (handle, incident_id, stage))""",
    """CREATE TABLE IF NOT EXISTS accounts (
        auth_sub TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, created DOUBLE PRECISION NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS cohorts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, join_code TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL, created DOUBLE PRECISION NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS cohort_members (
        cohort_id TEXT NOT NULL REFERENCES cohorts(id), handle TEXT NOT NULL,
        joined DOUBLE PRECISION NOT NULL, PRIMARY KEY (cohort_id, handle))""",
    # The hypertable (design doc: incident_metrics, one sample per second while polled).
    """CREATE TABLE IF NOT EXISTS incident_metrics (
        time TIMESTAMPTZ NOT NULL, incident_id TEXT NOT NULL, error_rate DOUBLE PRECISION NOT NULL,
        orders_per_min INTEGER NOT NULL, p95_ms INTEGER NOT NULL, PRIMARY KEY (incident_id, time))""",
    "SELECT create_hypertable('incident_metrics', by_range('time'), if_not_exists => TRUE)",
]


class PostgresDatabase:
    kind = "tigerdata"
    persistent = True
    supports_metrics = True

    def __init__(self, url: str) -> None:
        self._url = url
        self._lock = threading.Lock()
        self._conn = self._connect()
        with self._lock:
            for statement in SCHEMA:
                self._conn.execute(statement)

    def _connect(self) -> psycopg.Connection:
        return psycopg.connect(self._url, connect_timeout=CONNECT_TIMEOUT_S, autocommit=True)

    def _run(self, work: Callable[[psycopg.Connection], T]) -> T:
        """Run under the lock; if the connection dropped, reconnect once and retry."""
        with self._lock:
            try:
                return work(self._conn)
            except psycopg.OperationalError:
                logger.warning("Tiger Data connection dropped; reconnecting")
                self._conn = self._connect()
                return work(self._conn)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ---- incidents ----
    def save_incident(self, incident_id: str, level: str, teammates: tuple[str, ...],
                      snapshot: dict[str, Any], updated: float) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO incidents (id, level, teammates, snapshot, updated) VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level, teammates = EXCLUDED.teammates, "
            "snapshot = EXCLUDED.snapshot, updated = EXCLUDED.updated",
            (incident_id, level, Jsonb(list(teammates)), Jsonb(snapshot), updated)))

    def load_snapshots(self) -> list[dict[str, Any]]:
        rows = self._run(lambda c: c.execute("SELECT snapshot FROM incidents ORDER BY updated").fetchall())
        return [row[0] for row in rows]

    # ---- users and connections ----
    def save_user(self, handle: str, github_login: str | None, contact: str | None, public_evidence: bool,
                  updated: float) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO users (handle, github_login, contact, public_evidence, updated) VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (handle) DO UPDATE SET github_login = EXCLUDED.github_login, contact = EXCLUDED.contact, "
            "public_evidence = EXCLUDED.public_evidence, updated = EXCLUDED.updated",
            (handle, github_login, contact, public_evidence, updated)))

    def load_users(self) -> list[tuple]:
        return self._run(lambda c: c.execute(
            "SELECT handle, github_login, contact, public_evidence FROM users").fetchall())

    def save_connection(self, incident_id: str, from_user: str, to_user: str, work_again: bool,
                        note: str, updated: float) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO connections VALUES (%s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (incident_id, from_user, to_user) DO UPDATE SET work_again = EXCLUDED.work_again, "
            "note = EXCLUDED.note, updated = EXCLUDED.updated",
            (incident_id, from_user, to_user, work_again, note, updated)))

    def load_connections(self) -> list[tuple]:
        return self._run(lambda c: c.execute(
            "SELECT incident_id, from_user, to_user, work_again, note FROM connections").fetchall())

    # ---- before/after checks and accounts ----
    def save_check(self, handle: str, incident_id: str, stage: str, decision: str, explanation: str,
                   score: int, updated: float) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO before_after VALUES (%s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (handle, incident_id, stage) DO UPDATE SET decision = EXCLUDED.decision, "
            "explanation = EXCLUDED.explanation, score = EXCLUDED.score, updated = EXCLUDED.updated",
            (handle, incident_id, stage, decision, explanation, score, updated)))

    def load_checks(self) -> list[tuple]:
        return self._run(lambda c: c.execute(
            "SELECT handle, incident_id, stage, decision, explanation, score FROM before_after").fetchall())

    def save_account(self, auth_sub: str, handle: str, created: float) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO accounts (auth_sub, handle, created) VALUES (%s, %s, %s)", (auth_sub, handle, created)))

    def load_accounts(self) -> list[tuple[str, str]]:
        return self._run(lambda c: c.execute("SELECT auth_sub, handle FROM accounts").fetchall())

    # ---- cohorts ----
    def save_cohort(self, cohort: Cohort, created: float) -> None:
        def work(c: psycopg.Connection) -> None:
            with c.transaction():
                c.execute("INSERT INTO cohorts (id, name, join_code, created_by, created) VALUES (%s, %s, %s, %s, %s)",
                          (cohort.id, cohort.name, cohort.join_code, cohort.created_by, created))
                c.execute("INSERT INTO cohort_members (cohort_id, handle, joined) VALUES (%s, %s, %s)",
                          (cohort.id, cohort.created_by, created))
        self._run(work)

    def add_cohort_member(self, cohort_id: str, handle: str, joined: float) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO cohort_members (cohort_id, handle, joined) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (cohort_id, handle, joined)))

    def load_cohorts(self) -> list[Cohort]:
        cohorts = self._run(lambda c: c.execute(
            "SELECT id, name, join_code, created_by FROM cohorts ORDER BY created").fetchall())
        members = self._run(lambda c: c.execute(
            "SELECT cohort_id, handle FROM cohort_members ORDER BY joined").fetchall())
        by_cohort: dict[str, list[str]] = {}
        for cohort_id, handle in members:
            by_cohort.setdefault(cohort_id, []).append(handle)
        return [Cohort(id=cid, name=name, join_code=code, created_by=creator, members=tuple(by_cohort.get(cid, ())))
                for cid, name, code, creator in cohorts]

    # ---- metrics hypertable ----
    def record_metrics(self, rows: list[tuple[str, float, float, int, int]]) -> None:
        """rows: (incident_id, epoch_second, error_rate, orders_per_min, p95_ms). Duplicates are ignored."""
        def work(c: psycopg.Connection) -> None:
            with c.cursor() as cur:
                cur.executemany(
                    "INSERT INTO incident_metrics (time, incident_id, error_rate, orders_per_min, p95_ms) "
                    "VALUES (to_timestamp(%s), %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                    [(second, incident_id, err, orders, p95) for incident_id, second, err, orders, p95 in rows])
        self._run(work)

    def metrics_buckets(self, incident_id: str, start: float, end: float, step_s: int) -> dict[int, dict]:
        """time_bucket averages, keyed by bucket start (epoch seconds, aligned to multiples of step_s)."""
        rows = self._run(lambda c: c.execute(
            "SELECT extract(epoch FROM time_bucket(make_interval(secs => %s), time, to_timestamp(0)))::bigint, "
            "avg(error_rate), avg(orders_per_min), avg(p95_ms) FROM incident_metrics "
            "WHERE incident_id = %s AND time >= to_timestamp(%s) AND time <= to_timestamp(%s) "
            "GROUP BY 1 ORDER BY 1",
            (step_s, incident_id, start, end)).fetchall())
        return {int(b): {"error_rate": float(e), "orders_per_min": float(o), "p95_ms": float(p)} for b, e, o, p in rows}
