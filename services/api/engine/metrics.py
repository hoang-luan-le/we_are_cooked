"""Dashboard numbers as a pure function of state and time. All curves come from scenario.json."""
from __future__ import annotations

from scenario_models import Metrics, MetricsSpec

from .state import IncidentState

SECONDS_PER_MINUTE = 60
MINUTES_PER_DAY = 24 * 60


def _blend(start: dict, end: dict, fraction: float) -> dict:
    f = min(1.0, max(0.0, fraction))
    return {key: start[key] + (end[key] - start[key]) * f for key in start}


def _values(metrics: Metrics) -> dict:
    return {"error_rate": metrics.error_rate, "orders_per_min": metrics.orders_per_min, "p95_ms": metrics.p95_ms}


def _broken_curve(spec: MetricsSpec, elapsed: float) -> dict:
    """At the page the numbers are `at_page`; they ramp to `broken` over `ramp_s`."""
    return _blend(_values(spec.at_page), _values(spec.broken), elapsed / spec.ramp_s)


def _rounded(values: dict) -> dict:
    return {
        "error_rate": round(values["error_rate"], 1),
        "orders_per_min": int(round(values["orders_per_min"])),
        "p95_ms": int(round(values["p95_ms"])),
    }


MAX_ERROR_RATE = 100.0


def _while_broken(state: IncidentState, spec: MetricsSpec, elapsed: float) -> dict:
    """The broken curve, plus the errors that climbed while the phone was snoozed."""
    values = _broken_curve(spec, elapsed)
    climbed = values["error_rate"] + state.snoozes * spec.snooze.error_rate_penalty
    return {**values, "error_rate": min(MAX_ERROR_RATE, climbed)}


def current_metrics(state: IncidentState, spec: MetricsSpec, now: float) -> dict:
    baseline = _values(spec.baseline)
    if state.status == "fixed":
        return _rounded(baseline)
    if state.status == "rolled_back" and state.rollback_at is not None:
        at_rollback = _while_broken(state, spec, state.rollback_at - state.paged_at)
        return _rounded(_blend(at_rollback, baseline, (now - state.rollback_at) / spec.recovery_s))
    if state.restart_at is not None and now - state.restart_at < spec.restart_dip.duration_s:
        return _rounded(_values(spec.restart_dip))
    return _rounded(_while_broken(state, spec, now - state.paged_at))


def is_ringing(state: IncidentState, spec: MetricsSpec, now: float) -> bool:
    """The phone rings while paged, except for ring_again_s after each snooze."""
    if state.phase != "paged":
        return False
    return state.snoozed_at is None or now - state.snoozed_at >= spec.snooze.ring_again_s


def baseline_metrics(spec: MetricsSpec) -> dict:
    return _rounded(_values(spec.baseline))


def sim_clock(page_at: str, elapsed_s: float) -> str:
    """Simulated wall clock: 1 real second = 1 simulated second, starting at the page."""
    hours, minutes = (int(part) for part in page_at.split(":"))
    total = (hours * SECONDS_PER_MINUTE + minutes + int(max(0.0, elapsed_s) // SECONDS_PER_MINUTE)) % MINUTES_PER_DAY
    return f"{total // SECONDS_PER_MINUTE:02d}:{total % SECONDS_PER_MINUTE:02d}"
