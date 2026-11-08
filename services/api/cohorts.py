"""Cohorts: create, join by code, list members. Saved to the database on every change.

Privacy (users may be minors, CLAUDE.md hard rule 6): members are pseudonymous handles only,
and only members can see a cohort.
"""
from __future__ import annotations

import logging
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass, replace
from typing import Callable

logger = logging.getLogger("incident_lab.cohorts")
JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L: easy to read aloud
JOIN_CODE_LENGTH = 6
MAX_MEMBERS = 50
MAX_CODE_ATTEMPTS = 20


class CohortNotFound(KeyError):
    pass


class CohortFull(Exception):
    pass


@dataclass(frozen=True)
class Cohort:
    id: str
    name: str
    join_code: str
    created_by: str
    members: tuple[str, ...]


def normalize_code(code: str) -> str:
    return "".join(code.split()).upper()


class CohortStore:
    """In memory, written through to the database (`db`) when one is given."""

    def __init__(self, db=None, clock: Callable[[], float] = time.time) -> None:
        self._lock = threading.Lock()
        self._db = db
        self._clock = clock
        loaded = db.load_cohorts() if db is not None else []
        self._by_id: dict[str, Cohort] = {c.id: c for c in loaded}
        self._id_by_code: dict[str, str] = {c.join_code: c.id for c in loaded}

    def create(self, name: str, creator: str) -> Cohort:
        with self._lock:
            cohort = Cohort(
                id=self._new_id(), name=name, join_code=self._new_code(), created_by=creator, members=(creator,),
            )
            self._persist(lambda db: db.save_cohort(cohort, self._clock()))
            self._save(cohort)
            self._id_by_code = {**self._id_by_code, cohort.join_code: cohort.id}
            return cohort

    def join(self, code: str, handle: str) -> Cohort:
        with self._lock:
            cohort_id = self._id_by_code.get(normalize_code(code))
            if cohort_id is None:
                raise CohortNotFound(code)
            cohort = self._by_id[cohort_id]
            if handle in cohort.members:
                return cohort  # joining twice is fine
            if len(cohort.members) >= MAX_MEMBERS:
                raise CohortFull(cohort_id)
            joined = replace(cohort, members=cohort.members + (handle,))
            self._persist(lambda db: db.add_cohort_member(cohort_id, handle, self._clock()))
            self._save(joined)
            return joined

    def get_for_member(self, cohort_id: str, handle: str) -> Cohort:
        """Non-members get CohortNotFound too, so a cohort's existence isn't revealed."""
        with self._lock:
            cohort = self._by_id.get(cohort_id)
            if cohort is None or handle not in cohort.members:
                raise CohortNotFound(cohort_id)
            return cohort

    def _persist(self, write: Callable) -> None:
        if self._db is None:
            return
        try:
            write(self._db)
        except sqlite3.Error:
            # Keep the demo going from memory; the failure is logged with its traceback.
            logger.exception("Could not save a cohort change")

    def _save(self, cohort: Cohort) -> None:
        self._by_id = {**self._by_id, cohort.id: cohort}

    def _new_id(self) -> str:
        while True:
            candidate = f"coh_{secrets.token_hex(4)}"
            if candidate not in self._by_id:
                return candidate

    def _new_code(self) -> str:
        for _ in range(MAX_CODE_ATTEMPTS):
            code = "".join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(JOIN_CODE_LENGTH))
            if code not in self._id_by_code:
                return code
        raise RuntimeError("could not generate a unique join code")
