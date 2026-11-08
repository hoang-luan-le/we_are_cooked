"""Investigation panels: logs, deploy history, runbooks, metrics history.

Everything is a pure function of the incident state, the scenario and time, so rehearsals repeat
exactly (design doc: deterministic engine). Logs are generated per simulated second from a seed;
nothing is stored and nothing grows over the night.
"""
from __future__ import annotations

import hashlib
import random
from typing import Iterator

from scenario_loader import Scenario

from .metrics import metrics_at, minutes_between, sim_time
from .state import IncidentState

MAX_LOG_LINES = 200
MAX_LOG_SCAN_S = 900          # how far back a filtered log query looks
MAX_HISTORY_WINDOW_S = 3600
MIN_HISTORY_STEP_S = 5
LEVELS = ("INFO", "WARN", "ERROR")


def bad_release_lead_s(scenario: Scenario) -> float:
    """Seconds between the bad release and the page (01:47 -> 02:04 = 1020 s)."""
    return minutes_between(scenario.spec.releases.bad_at, scenario.spec.clock.page_at) * 60.0


# ---------- logs ----------

def _rng(incident_id: str, second: int, index: int) -> random.Random:
    seed = hashlib.sha256(f"{incident_id}:{second}:{index}".encode()).hexdigest()
    return random.Random(int(seed[:16], 16))


def _bad_code_live(state: IncidentState, scenario: Scenario, t: float) -> bool:
    """The v2.14.0 code path runs from the bad release until the rollback or the fix."""
    if t < state.paged_at - bad_release_lead_s(scenario):
        return False
    if state.rollback_at is not None and t >= state.rollback_at:
        return False
    return not (state.fixed_at is not None and t >= state.fixed_at)


def _guest_fails(state: IncidentState, scenario: Scenario, t: float, rng: random.Random) -> bool:
    if not _bad_code_live(state, scenario, t):
        return False
    metrics = scenario.spec.metrics
    if state.restart_at is not None and state.restart_at <= t < state.restart_at + metrics.restart_dip.duration_s:
        # A restart briefly clears stuck workers: most guest requests get through, then errors return.
        share = scenario.spec.logs.guest_share * 100
        return rng.random() < metrics.restart_dip.error_rate / share
    return True


def _lines_for_second(state: IncidentState, scenario: Scenario, second: int) -> Iterator[dict]:
    logs = scenario.spec.logs
    t = state.paged_at + second
    clock = sim_time(scenario.spec.clock.page_at, second)
    for index in range(logs.requests_per_second):
        rng = _rng(state.incident_id, second, index)
        order = f"o{rng.randrange(10**6):06d}"
        total = f"{rng.randrange(1500, 18000) / 100:.2f}"
        if rng.random() < logs.guest_share:
            if _guest_fails(state, scenario, t, rng):
                yield {"time": clock, "level": "ERROR", "service": "checkout",
                       "message": logs.error_line.format(order=order)}
            else:
                yield {"time": clock, "level": "INFO", "service": "checkout",
                       "message": logs.guest_ok_line.format(order=order, total=total)}
        else:
            tier = logs.tiers[rng.randrange(len(logs.tiers))]
            customer = f"c{rng.randrange(10**5):05d}"
            yield {"time": clock, "level": "INFO", "service": "checkout",
                   "message": logs.member_line.format(order=order, customer=customer, tier=tier, total=total)}
    if second % logs.noise_every_s == 0:
        yield {"time": clock, "level": "WARN", "service": "search-service", "message": logs.noise_line}


def recent_logs(
    state: IncidentState, scenario: Scenario, now: float, *, limit: int = MAX_LOG_LINES,
    level: str | None = None, query: str | None = None,
) -> list[dict]:
    """The newest `limit` matching lines up to now, oldest first."""
    limit = max(1, min(limit, MAX_LOG_LINES))
    needle = query.lower() if query else None
    newest_second = int((now - state.paged_at) // 1)
    picked: list[dict] = []
    for second in range(newest_second, newest_second - MAX_LOG_SCAN_S, -1):
        lines = [
            line for line in _lines_for_second(state, scenario, second)
            if (level is None or line["level"] == level) and (needle is None or needle in line["message"].lower())
        ]
        picked = lines + picked
        if len(picked) >= limit:
            break
    return picked[-limit:]


# ---------- deploys and runbooks ----------

def live_version(state: IncidentState, scenario: Scenario) -> str:
    if state.status == "fixed":
        return scenario.spec.fix_version
    if state.status == "rolled_back":
        return scenario.spec.releases.good
    return scenario.spec.releases.bad


def deploy_history(state: IncidentState, scenario: Scenario, diffs: dict[str, list[dict]] | None = None) -> dict:
    """Releases with their diffs. `diffs` (version -> files) comes from GitHub when it's reachable."""
    live = live_version(state, scenario)
    releases = []
    for deploy in scenario.spec.deploys:
        files = (diffs or {}).get(deploy.version)
        releases.append({
            "version": deploy.version, "at": deploy.at, "day": deploy.day, "author": deploy.author,
            "title": deploy.title, "live": deploy.version == live,
            "diff_source": "github" if files is not None else "scenario",
            "files": files if files is not None else [{"filename": f.filename, "patch": f.patch} for f in deploy.files],
        })
    return {"live_version": live, "releases": releases}


def runbook_index(scenario: Scenario) -> list[dict]:
    return [{"name": name, "title": book.title} for name, book in scenario.spec.runbooks.items()]


def runbook(scenario: Scenario, name: str) -> dict | None:
    book = scenario.spec.runbooks.get(name)
    return None if book is None else {"name": name, "title": book.title, "steps": list(book.steps)}


# ---------- metrics history ----------

def history_window(now: float, window_s: int, step_s: int) -> tuple[float, int, int]:
    """(start, window_s, step_s) after clamping; shared by the route (Tiger Data query) and the engine."""
    step_s = max(step_s, MIN_HISTORY_STEP_S)
    window_s = max(step_s, min(window_s, MAX_HISTORY_WINDOW_S))
    return now - window_s, window_s, step_s


def _rounded(values: dict) -> dict:
    return {"error_rate": round(values["error_rate"], 1), "orders_per_min": int(round(values["orders_per_min"])),
            "p95_ms": int(round(values["p95_ms"]))}


def metrics_history(state: IncidentState, scenario: Scenario, now: float, *, window_s: int, step_s: int,
                    stored: dict[int, dict] | None = None) -> dict:
    """Chart samples over the last `window_s` seconds (may reach back before the page) and events.

    `stored`: Tiger Data time_bucket averages keyed by bucket start (epoch seconds). A sample uses the
    stored bucket when one exists from this run (after the page); otherwise the computed curve.
    """
    start, window_s, step_s = history_window(now, window_s, step_s)
    lead = bad_release_lead_s(scenario)
    page_at = scenario.spec.clock.page_at
    stored = stored or {}
    samples = []
    t = start
    while t <= now:
        # `stored` already holds only this run's samples (the query starts at the page), so any bucket counts,
        # including one that straddles the page.
        bucket = stored.get(int(t // step_s) * step_s)
        if bucket is not None:
            values, source = _rounded(bucket), "tigerdata"
        else:
            values, source = metrics_at(state, scenario.spec.metrics, t, bad_release_lead_s=lead), "computed"
        samples.append({"sim_time": sim_time(page_at, t - state.paged_at), **values, "source": source})
        t += step_s
    events = [("bad release " + scenario.spec.releases.bad, state.paged_at - lead), ("paged", state.paged_at),
              ("restart", state.restart_at), ("rollback", state.rollback_at), ("fix deployed", state.fixed_at)]
    return {
        "source": "tigerdata" if any(s["source"] == "tigerdata" for s in samples) else "computed",
        "samples": samples,
        "events": [{"label": label, "sim_time": sim_time(page_at, at - state.paged_at)}
                   for label, at in events if at is not None and now - window_s <= at <= now],
        "baseline": metrics_at(state, scenario.spec.metrics, state.paged_at - lead - 1, bad_release_lead_s=lead),
    }
