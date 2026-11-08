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


def _handoff_evidence(state: IncidentState) -> str:
    if state.handoff is None:
        return "not written"
    if state.handoff.rating is None:
        return "written, not rated yet"
    return f"rated {state.handoff.rating.score}/5"


def collaboration(state: IncidentState, scenario: Scenario) -> dict:
    """Shared findings + a handoff the morning pair rated clear + a substantive PR review."""
    shared = len(state.findings)
    clear_handoff = bool(state.handoff and state.handoff.rated_clear)
    reviewed = bool(state.pr and state.pr.substantive_review)
    evidence = (f"shared findings: {shared} · handoff: {_handoff_evidence(state)}"
                f" · substantive teammate review: {_yes(reviewed)}")
    pieces = (
        (bool(shared), "shared findings", "share findings"),
        (clear_handoff, "wrote a clear handoff", "a handoff the morning pair rates 4 or 5"),
        (reviewed, "got a teammate's real review", "a teammate's real review on the PR"),
    )
    done = [did for ok, did, _ in pieces if ok]
    todo = [need for ok, _, need in pieces if not ok]
    if not todo:
        return _score("You shared findings, wrote a clear handoff and got a teammate's real review.", FULL, evidence)
    if done:
        return _score(f"You {_join(done)}; still to do: {_join(todo)}.", PARTIAL, evidence)
    return _score("Next time, share findings, write a clear handoff and ask for a real review.", NONE, evidence)


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} and {items[-1]}"


def communication(state: IncidentState, scenario: Scenario) -> dict:
    """Debrief answer, status updates and handoff note, checked for impact · cause · action · risk."""
    keywords = scenario.answer_key.communication_keywords
    texts = (
        tuple(note.text for note in state.status_updates)
        + ((state.handoff.text,) if state.handoff else ())
        + ((state.debrief.answer,) if state.debrief else ())
    )
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
