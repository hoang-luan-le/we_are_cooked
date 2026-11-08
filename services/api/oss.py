"""Save a snapshot of real open-source "good first issue" issues before the demo ("next real fix").

    cd services/api
    python oss.py            # uses GITHUB_TOKEN from the root .env if set (higher search limits)

Searches come from scenario.json `next_fix_searches` (the skills this incident practises). Only open,
unassigned issues; only title, repo, labels, link and dates are kept (no usernames). If the fetch
fails, the previous snapshot is kept and the script exits non-zero. Never invented.
"""
from __future__ import annotations

import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import httpx

import tls
from config import API_DIR, REPO_ROOT, env
from scenario_loader import load_scenario

logger = logging.getLogger("incident_lab.oss")
SEARCH_URL = "https://api.github.com/search/issues"
PER_SEARCH = 8
TIMEOUT_S = 10.0
PAUSE_BETWEEN_SEARCHES_S = 4.0   # GitHub's search API has a "secondary rate limit" for rapid queries
SLOW_DOWN_WAIT_S = 90.0          # if it still says slow down, wait this long and retry once
DEFAULT_SNAPSHOT_PATH = API_DIR / "data" / "next_fixes.json"
MAX_TITLE_CHARS = 200


class OssError(Exception):
    pass


def _repo(raw: dict) -> str:
    """'https://api.github.com/repos/owner/name' -> 'owner/name'."""
    return raw.get("repository_url", "").removeprefix("https://api.github.com/repos/")


def _issue(raw: dict) -> dict:
    return {
        "title": (raw.get("title") or "")[:MAX_TITLE_CHARS],
        "repo": _repo(raw),
        "url": raw.get("html_url", ""),
        "labels": [label.get("name", "") for label in raw.get("labels", [])][:6],
        "comments": raw.get("comments", 0),
        "created_at": raw.get("created_at", ""),
        "updated_at": raw.get("updated_at", ""),
    }


def _usable(raw: dict) -> bool:
    """Open issues nobody has taken, and not pull requests."""
    return (raw.get("state") == "open" and not raw.get("assignee") and not raw.get("assignees")
            and "pull_request" not in raw and raw.get("html_url", "").startswith("https://github.com/"))


def _slowed_down(response: httpx.Response) -> bool:
    return response.status_code in (403, 429) and (
        "secondary rate limit" in response.text.lower() or response.headers.get("retry-after") is not None)


def _search(client: httpx.Client, query: str, sleep: Callable[[float], None]) -> list[dict]:
    params = {"q": query, "sort": "updated", "order": "desc", "per_page": PER_SEARCH * 2}
    response = client.get(SEARCH_URL, params=params)
    if _slowed_down(response):
        wait = float(response.headers.get("retry-after") or SLOW_DOWN_WAIT_S)
        print(f"GitHub asked us to slow down; waiting {wait:.0f} s and retrying once...", file=sys.stderr)
        sleep(wait)
        response = client.get(SEARCH_URL, params=params)
    response.raise_for_status()
    return response.json().get("items", [])


def fetch_snapshot(searches: list[dict], token: str = "", transport: httpx.BaseTransport | None = None,
                   now: datetime | None = None, sleep: Callable[[float], None] = time.sleep) -> dict:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
               "User-Agent": "incident-lab"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    results = []
    with httpx.Client(timeout=TIMEOUT_S, transport=transport, headers=headers, verify=tls.verify()) as client:
        for index, search in enumerate(searches):
            if index:
                sleep(PAUSE_BETWEEN_SEARCHES_S)
            try:
                items = _search(client, search["query"], sleep)
            except (httpx.HTTPError, ValueError) as exc:
                raise OssError(f"GitHub search for '{search['skill']}' failed: {exc}") from exc
            issues = [_issue(item) for item in items if _usable(item)][:PER_SEARCH]
            results.append({"skill": search["skill"], "issues": issues})
    fetched = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    return {"source": "GitHub", "fetched_at": fetched, "searches": results}


def save_snapshot(snapshot: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)  # atomic


def load_snapshot(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        logger.exception("Next-fixes snapshot at %s is unreadable", path)
        return None


def main() -> int:
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / ".env")
    scenario = load_scenario(REPO_ROOT / "scenario" / "scenario.json")
    path = Path(env("NEXT_FIXES_SNAPSHOT_PATH") or DEFAULT_SNAPSHOT_PATH)
    searches = [{"skill": s.skill, "query": s.query} for s in scenario.spec.next_fix_searches]
    try:
        snapshot = fetch_snapshot(searches, env("GITHUB_TOKEN"))
    except OssError as exc:
        print(f"Not saved: {exc}. The previous snapshot (if any) is unchanged.", file=sys.stderr)
        return 1
    save_snapshot(snapshot, path)
    total = sum(len(s["issues"]) for s in snapshot["searches"])
    print(f"Saved {total} open issues ({snapshot['fetched_at']}) to {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
