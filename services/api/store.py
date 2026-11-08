"""Incident store. Live state stays in memory (one lock; every write swaps in a new frozen state)
and a snapshot is written to the database after every change, so a restart loses nothing.

Idempotency: a repeated (incident_id, idempotency_key) returns the first reply without re-applying.
Stored replies stay in memory only; after a restart a retried key is applied as new.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
from dataclasses import replace
from typing import Callable, Hashable, TypeVar

from engine.actions import settle
from engine.snapshot import SnapshotError, from_snapshot, to_snapshot
from engine.state import IncidentState, new_incident
from scenario_loader import Scenario

logger = logging.getLogger("incident_lab.store")
MAX_STORED_REPLIES = 2000
T = TypeVar("T")
Clock = Callable[[], float]
Change = Callable[[IncidentState, float], tuple[IncidentState, T]]


class UnknownIncident(KeyError):
    pass


class IdempotencyConflict(Exception):
    pass


class IncidentStore:
    def __init__(self, scenario: Scenario, clock: Clock, db=None) -> None:
        self._scenario = scenario
        self._clock = clock
        self._db = db
        self._lock = threading.Lock()
        self._incidents: dict[str, IncidentState] = self._load()
        self._replies: dict[tuple[str, str], tuple[Hashable, dict]] = {}
        self.save_failures = 0

    def now(self) -> float:
        return self._clock()

    def all(self) -> list[tuple[IncidentState, float]]:
        """Every incident, settled to now (for evidence and pending connections)."""
        with self._lock:
            now = self._clock()
            return [(self._settled(incident_id, now), now) for incident_id in tuple(self._incidents)]

    def ids(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(self._incidents)

    def create(self, incident_id: str, level: str, teammates: tuple[str, ...]) -> tuple[IncidentState, float]:
        """Create or replace an incident (also used by the demo reset)."""
        with self._lock:
            now = self._clock()
            state = new_incident(incident_id, level, now, teammates)
            self._put(state, now)
            self._replies = {k: v for k, v in self._replies.items() if k[0] != incident_id}
            return state, now

    def ensure(self, incident_id: str, level: str, teammates: tuple[str, ...]) -> IncidentState:
        """Create the incident only if it doesn't exist yet (the fixed demo incident at startup).

        A saved one keeps its progress (it survives restarts); only its teammates are refreshed.
        """
        with self._lock:
            existing = self._incidents.get(incident_id)
            now = self._clock()
            if existing is not None:
                if existing.teammates != tuple(teammates):  # e.g. DEMO_TEAM changed since last run
                    existing = replace(existing, teammates=tuple(dict.fromkeys(teammates)))
                    self._put(existing, now)
                return existing
            state = new_incident(incident_id, level, now, teammates)
            self._put(state, now)
            return state

    def get(self, incident_id: str) -> tuple[IncidentState, float]:
        with self._lock:
            now = self._clock()
            return self._settled(incident_id, now), now

    def change(self, incident_id: str, change: Change) -> T:
        with self._lock:
            now = self._clock()
            new_state, result = change(self._settled(incident_id, now), now)
            self._put(new_state, now)
            return result

    def change_once(self, incident_id: str, key: str, fingerprint: Hashable, change: Change[dict]) -> dict:
        """Like change(), but repeating (key, same request) returns the stored reply.

        `fingerprint` identifies the request (who + what). A reused key with a different
        fingerprint is a conflict, so nobody gets another person's reply.
        """
        with self._lock:
            stored = self._replies.get((incident_id, key))
            if stored is not None:
                stored_fingerprint, reply = stored
                if stored_fingerprint != fingerprint:
                    raise IdempotencyConflict("idempotency_key was already used for a different request")
                return reply
            now = self._clock()
            new_state, reply = change(self._settled(incident_id, now), now)
            self._put(new_state, now)
            self._remember(incident_id, key, fingerprint, reply)
            return reply

    def _settled(self, incident_id: str, now: float) -> IncidentState:
        state = self._incidents.get(incident_id)
        if state is None:
            raise UnknownIncident(incident_id)
        settled = settle(state, self._scenario, now)
        if settled is not state:
            self._put(settled, now)
        return settled

    def _put(self, state: IncidentState, now: float) -> None:
        self._incidents = {**self._incidents, state.incident_id: state}
        if self._db is None:
            return
        try:
            self._db.save_incident(state.incident_id, state.level, state.teammates, to_snapshot(state), now)
        except sqlite3.Error:
            # The live demo keeps going from memory; /health reports the failures.
            self.save_failures += 1
            logger.exception("Could not save a snapshot of incident %s", state.incident_id)

    def _load(self) -> dict[str, IncidentState]:
        if self._db is None:
            return {}
        incidents = {}
        for snapshot in self._db.load_snapshots():
            try:
                state = from_snapshot(snapshot)
            except SnapshotError as exc:
                logger.error("Skipping a saved incident: %s", exc)
                continue
            incidents[state.incident_id] = state
        return incidents

    def _remember(self, incident_id: str, key: str, fingerprint: Hashable, reply: dict) -> None:
        replies = {**self._replies, (incident_id, key): (fingerprint, reply)}
        if len(replies) > MAX_STORED_REPLIES:
            oldest = next(iter(replies))
            replies = {k: v for k, v in replies.items() if k != oldest}
        self._replies = replies
