"""Profiles and mutual connections. In memory, written through to the database.

Privacy (users may be minors, CLAUDE.md hard rule 6):
- each "work with them again?" answer is private; nobody can read another person's answer;
- a connection exists only when both people said yes about the same incident;
- contact details are shown only on such a mutual connection; no messaging at all.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import time
from dataclasses import dataclass, replace
from typing import Callable

logger = logging.getLogger("incident_lab.network")
UNSET = object()


@dataclass(frozen=True)
class Profile:
    handle: str
    github_login: str | None = None
    contact: str | None = None


@dataclass(frozen=True)
class Answer:
    incident_id: str
    from_user: str
    to_user: str
    work_again: bool
    note: str


class NetworkStore:
    def __init__(self, db=None, clock: Callable[[], float] = time.time) -> None:
        self._db = db
        self._clock = clock
        self._lock = threading.Lock()
        self._profiles = {h: Profile(h, g, c) for h, g, c in (db.load_users() if db else [])}
        self._answers = {
            (i, f, t): Answer(i, f, t, bool(w), n) for i, f, t, w, n in (db.load_connections() if db else [])
        }

    def profile(self, handle: str) -> Profile:
        with self._lock:
            return self._profiles.get(handle, Profile(handle))

    def update_profile(self, handle: str, *, github_login=UNSET, contact=UNSET) -> Profile:
        with self._lock:
            current = self._profiles.get(handle, Profile(handle))
            changes = {k: v for k, v in (("github_login", github_login), ("contact", contact)) if v is not UNSET}
            updated = replace(current, **changes)
            self._persist(lambda db: db.save_user(handle, updated.github_login, updated.contact, self._clock()))
            self._profiles = {**self._profiles, handle: updated}
            return updated

    def answer(self, incident_id: str, from_user: str, to_user: str, work_again: bool, note: str) -> Answer:
        with self._lock:
            answer = Answer(incident_id, from_user, to_user, work_again, note)
            self._persist(lambda db: db.save_connection(incident_id, from_user, to_user, work_again, note,
                                                        self._clock()))
            self._answers = {**self._answers, (incident_id, from_user, to_user): answer}
            return answer

    def answered(self, handle: str) -> set[tuple[str, str]]:
        """(incident_id, to_user) pairs this person already answered about."""
        with self._lock:
            return {(i, t) for (i, f, t) in self._answers if f == handle}

    def mutual(self, handle: str) -> list[tuple[str, str]]:
        """(other_handle, incident_id) where both said yes, oldest first."""
        with self._lock:
            return [
                (a.to_user, a.incident_id) for a in self._answers.values()
                if a.from_user == handle and a.work_again
                and (back := self._answers.get((a.incident_id, a.to_user, handle))) is not None and back.work_again
            ]

    def _persist(self, write: Callable) -> None:
        if self._db is None:
            return
        try:
            write(self._db)
        except sqlite3.Error:
            logger.exception("Could not save a network change")
