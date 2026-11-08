"""Writes one dashboard sample per second per incident into Tiger Data, off the request path.

Polls call sample(); at most one row per incident per second is queued, and a background thread
writes batches to the incident_metrics hypertable. Failures are logged and counted, never raised:
the dashboard keeps working from computed numbers.
"""
from __future__ import annotations

import logging
import queue
import threading

from dberrors import DB_ERRORS

logger = logging.getLogger("incident_lab.metrics")
MAX_QUEUE = 10_000
BATCH = 200


class MetricsRecorder:
    def __init__(self, db) -> None:
        self._db = db
        self._queue: queue.Queue = queue.Queue(maxsize=MAX_QUEUE)
        self._last_second: dict[str, int] = {}
        self._lock = threading.Lock()
        self.written = 0
        self.failures = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="metrics-recorder", daemon=True)
        self._thread.start()

    def sample(self, incident_id: str, now: float, metrics: dict) -> None:
        second = int(now)
        with self._lock:
            if self._last_second.get(incident_id) == second:
                return
            self._last_second = {**self._last_second, incident_id: second}
        row = (incident_id, float(second), metrics["error_rate"], metrics["orders_per_min"], metrics["p95_ms"])
        try:
            self._queue.put_nowait(row)
        except queue.Full:
            self.failures += 1

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                rows = [self._queue.get(timeout=0.5)]
            except queue.Empty:
                continue
            while len(rows) < BATCH:
                try:
                    rows.append(self._queue.get_nowait())
                except queue.Empty:
                    break
            try:
                self._db.record_metrics(rows)
                self.written += len(rows)
            except DB_ERRORS:
                self.failures += len(rows)
                logger.exception("Could not write %d metrics sample(s) to Tiger Data", len(rows))

    def flush(self, timeout_s: float = 5.0) -> None:
        """Wait until queued samples are written (used on shutdown and in checks)."""
        deadline = threading.Event()
        for _ in range(int(timeout_s * 20)):
            if self._queue.empty():
                break
            deadline.wait(0.05)
        deadline.wait(0.2)  # let the in-flight batch finish

    def close(self) -> None:
        self.flush()
        self._stop.set()
        self._thread.join(timeout=2)
