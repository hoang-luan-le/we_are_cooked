"""'Your incidents': which incidents a person is on, their role, and what is waiting on them.

Used by GET /api/me/incidents so the Morning pair sees "handed to you → Open" instead of copying links.
Only the caller's own incidents; no other people's details.
"""
from __future__ import annotations

from .state import IncidentState

NIGHT, MORNING, TEAMMATE = "night", "morning", "teammate"


def role_of(state: IncidentState, handle: str) -> str:
    handoff = state.handoff
    if handoff and handle in handoff.morning_pair:
        return MORNING
    if handoff and handle in handoff.night_pair:
        return NIGHT
    if handoff is None and handle in state.actors:
        return NIGHT
    return TEAMMATE


def _morning_step(state: IncidentState, handle: str) -> str | None:
    handoff = state.handoff
    if handoff and handoff.rating is None and handle not in handoff.night_pair:
        return "Read and rate the Night handoff"
    if state.status == "fixed":
        return "Debrief with Dana" if state.debrief is None else None
    if state.pr is None or not state.pr.merged:
        return "Fix the bug in VS Code and open a pull request"
    if state.pr.ci_passed is not True:
        return "Wait for CI to pass on your pull request"
    return "Deploy the verified fix"


def _night_step(state: IncidentState) -> str | None:
    if state.phase == "paged":
        return "Answer Dana's call"
    if state.phase in ("investigating", "mitigating"):
        return "Investigate and roll back" if state.status == "broken" else "Watch checkout recover"
    if state.phase == "stabilized" and state.handoff is None:
        return "Write the handoff for the Morning pair"
    return None


def next_step(state: IncidentState, handle: str) -> str | None:
    role = role_of(state, handle)
    if role == MORNING:
        return _morning_step(state, handle)
    if role == NIGHT:
        return _night_step(state)
    # A teammate who hasn't acted yet: only the opening call needs them.
    return "Answer Dana's call" if state.phase == "paged" else None


def my_incidents(states: list[IncidentState], handle: str) -> list[dict]:
    """Incidents this person may act on, newest first, with anything waiting on them first."""
    mine = [s for s in states if handle in s.all_teammates]
    rows = []
    for state in sorted(mine, key=lambda s: s.paged_at, reverse=True):
        step = next_step(state, handle)
        rows.append({
            "incident_id": state.incident_id, "level": state.level, "phase": state.phase, "status": state.status,
            "role": role_of(state, handle), "handoff_ready": state.handoff is not None,
            "next_step": step, "waiting_on_you": step is not None,
        })
    return sorted(rows, key=lambda r: not r["waiting_on_you"])  # stable: keeps newest-first within each group
