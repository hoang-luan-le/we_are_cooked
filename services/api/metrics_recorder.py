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
        self.dropped = 0
        self._accepted = 0           # rows put on the queue; flush waits until each is written or failed
        self._done = threading.Condition()
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
            self.dropped += 1  # never accepted, so flush doesn't wait for it
            return
        with self._done:
            self._accepted += 1

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
                written, failed = len(rows), 0
            except DB_ERRORS:
                written, failed = 0, len(rows)
                logger.exception("Could not write %d metrics sample(s) to Tiger Data", len(rows))
            with self._done:
                self.written += written
                self.failures += failed
                self._done.notify_all()

    def flush(self, timeout_s: float = 5.0) -> bool:
        """Wait until every accepted sample is written (or failed). True if it finished in time."""
        with self._done:
            return self._done.wait_for(lambda: self.written + self.failures >= self._accepted, timeout=timeout_s)

    def close(self) -> None:
        self.flush()
        self._stop.set()
        self._thread.join(timeout=2)
