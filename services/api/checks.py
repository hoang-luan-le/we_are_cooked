"""Before/after check answers, one per person, incident and stage. Written through to the database."""
from __future__ import annotations

import logging
import threading
import time
from dberrors import DB_ERRORS
from typing import Callable

logger = logging.getLogger("incident_lab.checks")


class CheckStore:
    def __init__(self, db=None, clock: Callable[[], float] = time.time) -> None:
        self._db = db
        self._clock = clock
        self._lock = threading.Lock()
        rows = db.load_checks() if db is not None else []
        self._answers = {(h, i, s): {"choice": c, "explanation": e, "score": sc} for h, i, s, c, e, sc in rows}

    def answers(self, handle: str, incident_id: str) -> dict[str, dict]:
        with self._lock:
            return {s: dict(a) for (h, i, s), a in self._answers.items() if h == handle and i == incident_id}

    def save(self, handle: str, incident_id: str, stage: str, choice: str, explanation: str, score: int) -> None:
        with self._lock:
            if self._db is not None:
                try:
                    self._db.save_check(handle, incident_id, stage, choice, explanation, score, self._clock())
                except DB_ERRORS:
                    logger.exception("Could not save a check answer")
            entry = {"choice": choice, "explanation": explanation, "score": score}
            self._answers = {**self._answers, (handle, incident_id, stage): entry}
