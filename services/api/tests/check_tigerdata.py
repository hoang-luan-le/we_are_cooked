"""Live check against the real Tiger Data in DATABASE_URL (not part of test_smoke.py: needs the network).

    cd services/api
    python tests/check_tigerdata.py      # prints TIGER DATA OK; cleans up its own rows

Never prints the connection string.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))

import psycopg  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from config import Settings  # noqa: E402
from main import create_app  # noqa: E402

DUY = {"X-Demo-User": "duy"}
POLLS = 4


def main() -> int:
    settings = Settings.from_env()
    if not settings.database_url.startswith(("postgres://", "postgresql://")):
        print("DATABASE_URL is not a Postgres URL; nothing to check.")
        return 1
    incident_id = None
    try:
        with TestClient(create_app(settings)) as client:
            database = client.get("/health").json()["database"]
            print("health database:", database)
            assert database["kind"] == "tigerdata", "not connected to Tiger Data (fell back?)"
            incident_id = client.post("/api/incident/start", json={"teammates": []}, headers=DUY).json()["incident_id"]
            client.post(f"/api/incident/{incident_id}/action", json={"action": "answer", "idempotency_key": "live"},
                        headers=DUY)
            for _ in range(POLLS):
                client.get(f"/api/incident/{incident_id}")
                time.sleep(1.1)
            client.app.state.metrics_recorder.flush()
            history = client.get(f"/api/incident/{incident_id}/metrics/history",
                                 params={"window_s": 60, "step_s": 5}).json()
            from_tiger = [s for s in history["samples"] if s["source"] == "tigerdata"]
            print(f"history source: {history['source']} | {len(from_tiger)} bucket(s) read back with time_bucket")
            assert history["source"] == "tigerdata" and from_tiger
            recorder = client.app.state.metrics_recorder
            print(f"metrics rows written: {recorder.written} | failures: {recorder.failures}")
            assert recorder.written >= POLLS - 1 and recorder.failures == 0
        with TestClient(create_app(settings)) as client:  # a fresh process reads it all back
            state = client.get(f"/api/incident/{incident_id}").json()
            print("after restart:", state["phase"], state["actions_taken"], state["teammates"])
            assert state["actions_taken"] == ["answer"]
        print("TIGER DATA OK")
        return 0
    finally:
        if incident_id:
            with psycopg.connect(settings.database_url, connect_timeout=10, autocommit=True) as conn:
                conn.execute("DELETE FROM incident_metrics WHERE incident_id = %s", (incident_id,))
                conn.execute("DELETE FROM incidents WHERE id = %s", (incident_id,))
            print(f"cleaned up {incident_id}")


if __name__ == "__main__":
    sys.exit(main())
