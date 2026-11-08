"""Response shapes for GET /api/incident/{id} and GET /api/incident/{id}/facts.

Types: packages/contracts/types.ts (IncidentState, DanaFacts). Neither view reads the answer key.
/facts goes to Dana/Gemini, so it carries only what the team has found plus `dana_knows`.
"""
from __future__ import annotations

from scenario_loader import Scenario

from .actions import allowed_actions
from .metrics import baseline_metrics, current_metrics, is_ringing, sim_clock
from .progress import found_steps, is_nudging, next_hint, stakeholder_message
from .rubric import facts_rubric
from .state import HANDOFF_PARTS, IncidentState, Note


def _clock(state: IncidentState, scenario: Scenario, moment: float) -> str:
    return sim_clock(scenario.spec.clock.page_at, moment - state.paged_at)


def _notes(state: IncidentState, scenario: Scenario, notes: tuple[Note, ...]) -> list[dict]:
    return [{"by": n.by, "text": n.text, "sim_clock": _clock(state, scenario, n.at)} for n in notes]


def _impact(state: IncidentState, scenario: Scenario, now: float) -> dict:
    metrics = scenario.spec.metrics
    return {**current_metrics(state, metrics, now), "baseline": baseline_metrics(metrics)}


def _pr(state: IncidentState) -> dict | None:
    if state.pr is None:
        return None
    pr = state.pr
    return {
        "number": pr.number,
        "merged": pr.merged,
        "ci_passed": pr.ci_passed,
        "substantive_review": pr.substantive_review,
        "mentor_review": pr.mentor_review,
        "url": pr.url,
        "head_sha": pr.head_sha,
        "ci": pr.ci,
        "review_count": len(pr.reviewers),  # GitHub logins stay off the page; only the mentor is named
    }


def handoff_view(state: IncidentState, scenario: Scenario) -> dict | None:
    handoff = state.handoff
    if handoff is None:
        return None
    rating = handoff.rating
    return {
        "by": handoff.by,
        "night_pair": list(handoff.night_pair),
        "morning_pair": list(handoff.morning_pair),
        "sim_clock": _clock(state, scenario, handoff.at),
        **{part: getattr(handoff, part) for part in HANDOFF_PARTS},
        "rating": None if rating is None else {
            "by": rating.by,
            "score": rating.score,
            "note": rating.note,
            "sim_clock": _clock(state, scenario, rating.at),
        },
    }


def state_view(state: IncidentState, scenario: Scenario, now: float) -> dict:
    return {
        "incident_id": state.incident_id,
        "level": state.level,
        "phase": state.phase,
        "status": state.status,
        "ringing": is_ringing(state, scenario.spec.metrics, now),
        "sim_clock": _clock(state, scenario, now),
        "metrics": _impact(state, scenario, now),
        "loyalty_discounts": state.loyalty_discounts,
        "unlocked": list(state.opened_panels),
        "findings": _notes(state, scenario, state.findings),
        "status_updates": _notes(state, scenario, state.status_updates),
        "actions_taken": list(state.actions_taken),
        "allowed_actions": list(allowed_actions(state)),
        "teammates": list(state.all_teammates),
        "hint_calls": state.hint_calls,
        "nudge": is_nudging(state, scenario, now),
        "stakeholder_message": stakeholder_message(state, scenario, now),
        "pr": _pr(state),
        "handoff": handoff_view(state, scenario),
        "rubric": facts_rubric(state, scenario),
    }


def facts_view(state: IncidentState, scenario: Scenario, now: float) -> dict:
    return {
        "incident_id": state.incident_id,
        "level": state.level,
        "phase": state.phase,
        "sim_clock": _clock(state, scenario, now),
        "impact": _impact(state, scenario, now),
        "dana_knows": [{"topic": item.topic, "text": item.text} for item in scenario.spec.dana_knows],
        "unlocked": list(state.opened_panels),
        "facts": [
            {"source": step.source, "topic": step.topic, "text": step.fact}
            for step in found_steps(state, scenario)
        ],
        "findings": _notes(state, scenario, state.findings),
        "next_hint": next_hint(state, scenario),
        "actions_taken": list(state.actions_taken),
        "hint_calls": state.hint_calls,
        "nudge": is_nudging(state, scenario, now),
        "stakeholder_message": stakeholder_message(state, scenario, now),
        "status": state.status,
        "handoff": handoff_view(state, scenario),
        "rubric": facts_rubric(state, scenario),
    }
