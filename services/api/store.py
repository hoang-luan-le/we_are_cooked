"""In-memory incident store (demo mode). One lock; every write swaps in a new frozen state.

Idempotency: a repeated (incident_id, idempotency_key) returns the first reply without re-applying.
SQLite / Tiger Data persistence comes later behind the same methods.
"""
from __future__ import annotations

import threading
from typing import Callable, Hashable, TypeVar

from engine.actions import settle
from engine.state import IncidentState, new_incident
from scenario_loader import Scenario

MAX_STORED_REPLIES = 2000
T = TypeVar("T")
Clock = Callable[[], float]
Change = Callable[[IncidentState, float], tuple[IncidentState, T]]


class UnknownIncident(KeyError):
    pass


class IdempotencyConflict(Exception):
    pass


class IncidentStore:
    def __init__(self, scenario: Scenario, clock: Clock) -> None:
        self._scenario = scenario
        self._clock = clock
        self._lock = threading.Lock()
        self._incidents: dict[str, IncidentState] = {}
        self._replies: dict[tuple[str, str], tuple[Hashable, dict]] = {}

    def now(self) -> float:
        return self._clock()

    def reset(self, incident_id: str, level: str) -> tuple[IncidentState, float]:
        with self._lock:
            now = self._clock()
            state = new_incident(incident_id, level, now)
            self._incidents = {**self._incidents, incident_id: state}
            self._replies = {k: v for k, v in self._replies.items() if k[0] != incident_id}
            return state, now

    def get(self, incident_id: str) -> tuple[IncidentState, float]:
        with self._lock:
            now = self._clock()
            return self._settled(incident_id, now), now

    def change(self, incident_id: str, change: Change) -> T:
        with self._lock:
            now = self._clock()
            new_state, result = change(self._settled(incident_id, now), now)
            self._incidents = {**self._incidents, incident_id: new_state}
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
            self._incidents = {**self._incidents, incident_id: new_state}
            self._remember(incident_id, key, fingerprint, reply)
            return reply

    def _settled(self, incident_id: str, now: float) -> IncidentState:
        state = self._incidents.get(incident_id)
        if state is None:
            raise UnknownIncident(incident_id)
        settled = settle(state, self._scenario, now)
        if settled is not state:
            self._incidents = {**self._incidents, incident_id: settled}
        return settled

    def _remember(self, incident_id: str, key: str, fingerprint: Hashable, reply: dict) -> None:
        replies = {**self._replies, (incident_id, key): (fingerprint, reply)}
        if len(replies) > MAX_STORED_REPLIES:
            oldest = next(iter(replies))
            replies = {k: v for k, v in replies.items() if k != oldest}
        self._replies = replies
