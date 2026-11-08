"""Shift handoff: the night pair writes a four-part note, the morning pair rates it 1-5.

Typed only (no audio recording by default, CLAUDE.md hard rule 6).
"""
from __future__ import annotations

from dataclasses import replace

from .errors import conflict, invalid
from .state import HANDOFF_PARTS, Handoff, HandoffRating, IncidentState

# Write once checkout is safe; the night pair may edit until the morning pair rates it.
WRITE_PHASES = ("stabilized", "handed_off")
# If the fix shipped before anyone wrote a handoff, a first note is still accepted (phase stays put).
LATE_WRITE_PHASES = ("fixed", "debriefed")


def write_handoff(
    state: IncidentState, *, actor: str, parts: dict[str, str], now: float, morning_pair: tuple[str, ...] = (),
) -> IncidentState:
    """The morning pair named here may act and is who rates the note (design doc, flow 3)."""
    current = state.handoff
    _check_can_write(state, current, actor)
    missing = [part for part in HANDOFF_PARTS if not parts.get(part, "").strip()]
    if missing:
        raise invalid("handoff_incomplete", f"The handoff needs all four parts; missing: {', '.join(missing)}.")

    night_pair = current.night_pair if current else state.actors
    handoff = Handoff(by=actor, night_pair=night_pair, at=now, morning_pair=morning_pair,
                      **{p: parts[p].strip() for p in HANDOFF_PARTS})
    phase = "handed_off" if state.phase in WRITE_PHASES else state.phase  # never move back from fixed
    first_write = ("handoff",) if current is None else ()
    # Editing replaces the morning pair; `teammates` itself never grows (see IncidentState.all_teammates).
    return replace(state, handoff=handoff, phase=phase, actions_taken=state.actions_taken + first_write)


def _check_can_write(state: IncidentState, current: Handoff | None, actor: str) -> None:
    late_first_write = current is None and state.phase in LATE_WRITE_PHASES
    if state.phase not in WRITE_PHASES and not late_first_write:
        raise conflict("handoff_not_ready", "Write the handoff once checkout is stable again (after the rollback).")
    if current is None:
        if actor not in state.actors:
            raise conflict("not_night_pair", "The handoff is written by the night pair, who worked the incident.")
        return
    if current.rating is not None:
        raise conflict("handoff_rated", "The morning pair already rated this handoff.")
    if actor not in current.night_pair:
        raise conflict("not_night_pair", "Only the night pair can edit their handoff.")


def rate_handoff(state: IncidentState, *, actor: str, score: int, note: str, now: float) -> IncidentState:
    if state.handoff is None:
        raise conflict("no_handoff", "There's no handoff to rate yet.")
    if actor in state.handoff.night_pair:
        raise conflict("night_pair_cannot_rate", "The morning pair rates the handoff, not the people who wrote it.")
    # One pair doing both shifts names no morning pair; then any other teammate may rate (design doc fallback).
    if state.handoff.morning_pair and actor not in state.handoff.morning_pair:
        raise conflict("not_morning_pair", "Only the morning pair named in the handoff can rate it.")
    rating = HandoffRating(by=actor, score=score, note=note.strip(), at=now)
    return replace(
        state,
        handoff=replace(state.handoff, rating=rating),
        actions_taken=state.actions_taken + ("handoff_rating",),
    )
