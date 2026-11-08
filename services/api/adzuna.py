"""Save a job-listings snapshot from Adzuna before the demo, so /api/jobs works offline.

    cd services/api
    python adzuna.py            # needs ADZUNA_APP_ID and ADZUNA_APP_KEY in the root .env

The snapshot keeps its fetch date, and listings are real ones from Adzuna (never invented). If the
fetch fails, the previous snapshot is kept and the script exits non-zero.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

import tls

from config import API_DIR, REPO_ROOT, env
from scenario_loader import load_scenario

logger = logging.getLogger("incident_lab.adzuna")
ADZUNA_URL = "https://api.adzuna.com/v1/api/jobs/{country}/search/1"
COUNTRY = "ca"
RESULTS_PER_SEARCH = 10
TIMEOUT_S = 10.0
DEFAULT_SNAPSHOT_PATH = API_DIR / "data" / "jobs_snapshot.json"


class AdzunaError(Exception):
    pass


def _listing(raw: dict) -> dict:
    return {
        "title": raw.get("title", ""),
        "company": (raw.get("company") or {}).get("display_name", ""),
        "location": (raw.get("location") or {}).get("display_name", ""),
        "created": raw.get("created", ""),
        "url": raw.get("redirect_url", ""),
        "salary_min": raw.get("salary_min"),
        "salary_max": raw.get("salary_max"),
    }


def fetch_snapshot(app_id: str, app_key: str, searches: tuple[str, ...],
                   transport: httpx.BaseTransport | None = None, now: datetime | None = None) -> dict:
    if not app_id or not app_key:
        raise AdzunaError("ADZUNA_APP_ID and ADZUNA_APP_KEY are required")
    results = []
    with httpx.Client(timeout=TIMEOUT_S, transport=transport, verify=tls.verify()) as client:
        for what in searches:
            try:
                response = client.get(ADZUNA_URL.format(country=COUNTRY), params={
                    "app_id": app_id, "app_key": app_key, "what": what,
                    "results_per_page": RESULTS_PER_SEARCH, "content-type": "application/json",
                })
                response.raise_for_status()
                data = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise AdzunaError(f"Adzuna search '{what}' failed: {exc}") from exc
            results.append({"what": what, "count": data.get("count", 0),
                            "listings": [_listing(r) for r in data.get("results", [])]})
    fetched = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    return {"source": "Adzuna", "country": COUNTRY, "fetched_at": fetched, "searches": results}


def save_snapshot(snapshot: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)  # atomic: a half-written snapshot never replaces a good one


def load_snapshot(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        logger.exception("Job snapshot at %s is unreadable", path)
        return None


def main() -> int:
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / ".env")
    scenario = load_scenario(REPO_ROOT / "scenario" / "scenario.json")
    path = Path(env("JOBS_SNAPSHOT_PATH") or DEFAULT_SNAPSHOT_PATH)
    try:
        snapshot = fetch_snapshot(env("ADZUNA_APP_ID"),
                                  env("ADZUNA_APP_KEY"), scenario.spec.job_searches)
    except AdzunaError as exc:
        print(f"Not saved: {exc}. The previous snapshot (if any) is unchanged.", file=sys.stderr)
        return 1
    save_snapshot(snapshot, path)
    total = sum(len(s["listings"]) for s in snapshot["searches"])
    print(f"Saved {total} listings ({snapshot['fetched_at']}) to {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
