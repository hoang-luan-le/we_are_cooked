"""POST /action handlers. Each returns a new state; rejected actions raise ActionRejected."""
from __future__ import annotations

from dataclasses import replace
from typing import Callable

from scenario_loader import Scenario

from .errors import ActionRejected, conflict, invalid
from .progress import next_hint
from .state import ACTIONS, DEBRIEF_PHASES, Debrief, IncidentState, Note, PanelView

# Design doc, security and privacy: findings 280, updates 500 characters.
TEXT_LIMITS = {"share_finding": 280, "status_update": 500}
MAX_TEXT_CHARS = max(TEXT_LIMITS.values())
WORKING_ACTIONS = (
    "open_panel", "share_finding", "status_update", "rollback", "restart", "scale", "restart_search", "deploy_fix",
)
AFTER_FIX_ACTIONS = ("open_panel", "share_finding", "status_update")

__all__ = ["ActionRejected", "apply_action", "allowed_actions", "settle", "request_hint", "record_debrief"]


def settle(state: IncidentState, scenario: Scenario, now: float) -> IncidentState:
    """Apply time-based transitions: the rollback finishes recovering after recovery_s."""
    recovered = state.rollback_at is not None and now - state.rollback_at >= scenario.spec.metrics.recovery_s
    if state.phase == "mitigating" and recovered:
        return replace(state, phase="stabilized")
    return state


def allowed_actions(state: IncidentState) -> tuple[str, ...]:
    if state.phase == "paged":
        return ("answer", "snooze")
    if state.phase in ("fixed", "debriefed"):
        return AFTER_FIX_ACTIONS
    allowed = []
    for action in WORKING_ACTIONS:
        if action == "rollback" and state.status != "broken":
            continue
        if action == "deploy_fix" and not (state.pr and state.pr.ready_to_deploy):
            continue
        allowed.append(action)
    return tuple(allowed)


def _why_not(state: IncidentState, action: str) -> ActionRejected:
    if state.phase == "paged":
        return conflict("answer_first", "Answer the call first.")
    if action == "rollback" and state.status != "broken":
        return conflict("already_rolled_back", "Already rolled back.")
    if action == "deploy_fix" and state.phase not in ("fixed", "debriefed"):
        return conflict("pr_not_ready", "deploy_fix needs a merged PR with passing CI.")
    return conflict("not_allowed_now", f"'{action}' isn't available in phase '{state.phase}'.")


def _record(state: IncidentState, label: str, **changes) -> IncidentState:
    return replace(state, actions_taken=state.actions_taken + (label,), **changes)


def _required_text(text: str | None, action: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        raise invalid("text_required", f"'{action}' needs some text.")
    limit = TEXT_LIMITS[action]
    if len(cleaned) > limit:
        raise invalid("text_too_long", f"Keep it under {limit} characters.")
    return cleaned


def _answer(state, scenario, actor, now, panel, text):
    # The stakeholder timer starts when they pick up, not when the phone first rang.
    return _record(state, "answer", phase="investigating", last_contact_at=now)


def _snooze(state, scenario, actor, now, panel, text):
    # Rings again after ring_again_s; errors climb meanwhile (metrics.py). Never scored (hard rule 7).
    return _record(state, "snooze", snoozed_at=now, snoozes=state.snoozes + 1)


def _open_panel(state, scenario, actor, now, panel, text):
    if panel not in scenario.spec.panels:
        raise invalid("unknown_panel", f"panel must be one of {', '.join(scenario.spec.panels)}")
    return _record(state, f"open_panel:{panel}", panel_views=state.panel_views + (PanelView(panel, now),))


def _share_finding(state, scenario, actor, now, panel, text):
    note = Note(by=actor, text=_required_text(text, "share_finding"), at=now)
    return _record(state, "share_finding", findings=state.findings + (note,))


def _status_update(state, scenario, actor, now, panel, text):
    note = Note(by=actor, text=_required_text(text, "status_update"), at=now)
    return _record(state, "status_update", status_updates=state.status_updates + (note,), last_contact_at=now)


def _rollback(state, scenario, actor, now, panel, text):
    return _record(state, "rollback", status="rolled_back", rollback_at=now, phase="mitigating", restart_at=None)


def _restart(state, scenario, actor, now, panel, text):
    return _record(state, "restart", restart_at=now)


def _no_effect(action: str) -> Callable:
    def handler(state, scenario, actor, now, panel, text):
        return _record(state, action)
    return handler


def _deploy_fix(state, scenario, actor, now, panel, text):
    return _record(state, "deploy_fix", status="fixed", phase="fixed")


HANDLERS: dict[str, Callable] = {
    "answer": _answer,
    "snooze": _snooze,
    "open_panel": _open_panel,
    "share_finding": _share_finding,
    "status_update": _status_update,
    "rollback": _rollback,
    "restart": _restart,
    "scale": _no_effect("scale"),
    "restart_search": _no_effect("restart_search"),
    "deploy_fix": _deploy_fix,
}
assert set(HANDLERS) == set(ACTIONS), "every contract action needs a handler"


def apply_action(
    state: IncidentState,
    scenario: Scenario,
    *,
    action: str,
    actor: str,
    now: float,
    panel: str | None = None,
    text: str | None = None,
) -> tuple[IncidentState, str]:
    if action not in HANDLERS:
        raise invalid("unknown_action", f"Unknown action '{action}'.")
    if action not in allowed_actions(state):
        raise _why_not(state, action)
    new_state = HANDLERS[action](state, scenario, actor, now, panel, text)
    if actor not in new_state.actors:
        new_state = replace(new_state, actors=new_state.actors + (actor,))
    return new_state, scenario.spec.action_results.get(action, "Done.")


def request_hint(state: IncidentState, scenario: Scenario, now: float) -> tuple[IncidentState, dict]:
    """A help call: counts once, resets the stakeholder timer, returns the next ladder hint."""
    hint = next_hint(state, scenario)
    new_state = replace(
        state,
        hint_calls=state.hint_calls + 1,
        last_contact_at=now,
        actions_taken=state.actions_taken + ("hint",),
    )
    return new_state, hint


def record_debrief(state: IncidentState, *, actor: str, answer: str, now: float) -> IncidentState:
    if state.phase not in DEBRIEF_PHASES:
        raise conflict("debrief_not_ready", "The debrief opens once checkout is stable again.")
    phase = "debriefed" if state.phase == "fixed" else state.phase
    return replace(state, debrief=Debrief(by=actor, answer=answer, at=now), phase=phase)
