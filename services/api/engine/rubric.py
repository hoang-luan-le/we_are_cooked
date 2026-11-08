"""Evidence-based rubric, 0/2/4 per criterion, out of 20. Scored from recorded actions only.

Gemini may add feedback on top; it never changes these numbers (CLAUDE.md hard rule 2).
Off-script actions (restart, scale, ...) are listed as evidence but never cost points (hard rule 7).
"""
from __future__ import annotations

from scenario_loader import Scenario

from .metrics import sim_clock
from .progress import mentions_any
from .state import OFF_SCRIPT_ACTIONS, IncidentState

FULL, PARTIAL, NONE = 4, 2, 0
OUT_OF = 20
COMMUNICATION_PARTS = ("impact", "cause", "action", "risk")
ACTION_CRITERIA = ("diagnosis", "mitigation", "validation", "collaboration")


def _yes(flag: bool) -> str:
    return "yes" if flag else "no"


def _score(reason: str, score: int, evidence) -> dict:
    return {"score": score, "reason": reason, "evidence": evidence}


def _named_cause(state: IncidentState, scenario: Scenario) -> bool:
    texts = state.team_texts + ((state.debrief.answer,) if state.debrief else ())
    return mentions_any(texts, scenario.answer_key.cause_keywords)


def _checked_recovery(state: IncidentState) -> bool:
    return state.rollback_at is not None and state.opened_after("dashboard", state.rollback_at)


def diagnosis(state: IncidentState, scenario: Scenario) -> dict:
    logs, deploys, named = state.opened("logs"), state.opened("deploys"), _named_cause(state, scenario)
    evidence = f"opened logs: {_yes(logs)} · opened deploys: {_yes(deploys)} · named the cause: {_yes(named)}"
    if logs and deploys and named:
        return _score("You checked the logs and the deploy history and named the cause.", FULL, evidence)
    if logs or deploys:
        return _score("You started on the evidence; naming the cause out loud is the next step.", PARTIAL, evidence)
    return _score("Next time, open the logs and the deploy history to find the cause.", NONE, evidence)


def mitigation(state: IncidentState, scenario: Scenario) -> dict:
    checked = _checked_recovery(state)
    tried = [a for a in OFF_SCRIPT_ACTIONS if state.did(a)]
    when = sim_clock(scenario.spec.clock.page_at, state.rollback_at - state.paged_at) if state.rollback_at else "never"
    evidence = f"rolled back at: {when} · checked recovery: {_yes(checked)} · also tried: {', '.join(tried) or 'nothing else'}"
    if state.rollback_at is not None and checked:
        return _score("You rolled back to stop the damage and checked that it worked.", FULL, evidence)
    if state.rollback_at is not None:
        return _score("You rolled back; next time check the dashboard to confirm it worked.", PARTIAL, evidence)
    return _score("Stopping the damage first, with a rollback, is the next skill to practise.", NONE, evidence)


def validation(state: IncidentState, scenario: Scenario) -> dict:
    checked = _checked_recovery(state)
    ci = state.pr.ci_passed if state.pr else None
    ci_text = "no PR yet" if state.pr is None else {True: "passing", False: "failing", None: "not run yet"}[ci]
    evidence = f"checked metrics: {_yes(checked)} · CI: {ci_text}"
    if checked and ci is True:
        return _score("You confirmed recovery on the dashboard and the fix passed CI.", FULL, evidence)
    if checked:
        return _score("You confirmed recovery on the dashboard; the fix still needs passing CI.", PARTIAL, evidence)
    if ci is True:
        return _score("The fix passed CI; next time also confirm recovery on the dashboard.", PARTIAL, evidence)
    return _score("Next time, confirm recovery on the dashboard and get the fix through CI.", NONE, evidence)


def collaboration(state: IncidentState, scenario: Scenario) -> dict:
    shared = len(state.findings)
    reviewed = bool(state.pr and state.pr.substantive_review)
    evidence = f"shared findings: {shared} · substantive teammate review: {_yes(reviewed)}"
    if shared and reviewed:
        return _score("You shared findings and got a teammate's real review on the PR.", FULL, evidence)
    if shared:
        return _score("You shared findings; the PR still needs a teammate's real review.", PARTIAL, evidence)
    if reviewed:
        return _score("Your PR got a real review; sharing findings during the night helps too.", PARTIAL, evidence)
    return _score("Next time, share what you find with your pair and ask for a real review.", NONE, evidence)


def communication(state: IncidentState, scenario: Scenario) -> dict:
    """Debrief answer plus the team's status updates, checked for impact · cause · action · risk."""
    keywords = scenario.answer_key.communication_keywords
    texts = tuple(note.text for note in state.status_updates) + ((state.debrief.answer,) if state.debrief else ())
    covered = {part: mentions_any(texts, getattr(keywords, part)) for part in COMMUNICATION_PARTS}
    hits = [part for part in COMMUNICATION_PARTS if covered[part]]
    missing = [part for part in COMMUNICATION_PARTS if not covered[part]]
    if not missing:
        return _score("Your update covered impact, cause, action and risk.", FULL, covered)
    if len(hits) >= 2:
        return _score(f"Your update covered {' and '.join(hits)}; add {' and '.join(missing)} next time.", PARTIAL, covered)
    return _score("Next time, cover impact, cause, action and risk.", NONE, covered)


ACTION_SCORERS = {
    "diagnosis": diagnosis,
    "mitigation": mitigation,
    "validation": validation,
    "collaboration": collaboration,
}


def build_rubric(state: IncidentState, scenario: Scenario) -> dict:
    """Full rubric once the debrief is in; before that, communication is pending."""
    scores = {name: scorer(state, scenario) for name, scorer in ACTION_SCORERS.items()}
    final = state.debrief is not None
    scores["communication"] = communication(state, scenario) if final else {"pending": True}
    ordered = {name: scores[name] for name in ("diagnosis", "mitigation", "validation", "communication", "collaboration")}
    total = sum(item.get("score", 0) for item in ordered.values())
    return {"rubric": ordered, "total": total, "out_of": OUT_OF, "final": final}


def facts_rubric(state: IncidentState, scenario: Scenario) -> dict | None:
    if state.debrief is None and state.phase not in ("fixed", "debriefed"):
        return None
    return build_rubric(state, scenario)
