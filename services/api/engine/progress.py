"""What the team has found (help ladder), the next hint, and the stakeholder nudge."""
from __future__ import annotations

from scenario_loader import Scenario
from scenario_models import LadderStep

from .state import IncidentState


def mentions_any(texts: tuple[str, ...], keywords: tuple[str, ...]) -> bool:
    lowered = [text.lower() for text in texts]
    return any(keyword.lower() in text for text in lowered for keyword in keywords)


def is_found(step: LadderStep, state: IncidentState, scenario: Scenario) -> bool:
    when = step.found_when
    if not all(state.opened(panel) for panel in when.panels_opened):
        return False
    if when.action and not state.did(when.action):
        return False
    if when.status and state.status != when.status:
        return False
    if when.team_names_cause and not mentions_any(state.team_texts, scenario.answer_key.cause_keywords):
        return False
    return True


def found_steps(state: IncidentState, scenario: Scenario) -> tuple[LadderStep, ...]:
    return tuple(step for step in scenario.spec.help_ladder if is_found(step, state, scenario))


def next_hint(state: IncidentState, scenario: Scenario) -> dict:
    """The first help-ladder step not found yet. It repeats until the team actually does it."""
    for step in scenario.spec.help_ladder:
        if not is_found(step, state, scenario):
            return {"topic": step.topic, "hint": step.hint}
    return {"topic": None, "hint": scenario.spec.all_found_hint}


def is_nudging(state: IncidentState, scenario: Scenario, now: float) -> bool:
    """Dana chases an update after update_every_s of silence while checkout is broken.

    Not while the phone is still ringing (nobody has picked up yet), and not after the rollback.
    """
    if state.phase == "paged" or state.status != "broken":
        return False
    return now - state.last_contact_at >= scenario.spec.stakeholders.update_every_s


def stakeholder_message(state: IncidentState, scenario: Scenario, now: float) -> str | None:
    return scenario.spec.stakeholders.nudge_message if is_nudging(state, scenario, now) else None
