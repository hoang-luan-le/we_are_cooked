"""Incident state. Frozen: every change returns a new IncidentState via dataclasses.replace."""
from __future__ import annotations

from dataclasses import dataclass

LEVELS = ("explore", "practice", "challenge")
PHASES = ("paged", "investigating", "mitigating", "stabilized", "handed_off", "fixed", "debriefed")
ACTIONS = (
    "answer", "snooze", "open_panel", "share_finding", "status_update",
    "rollback", "restart", "scale", "restart_search", "deploy_fix",
)
OFF_SCRIPT_ACTIONS = ("restart", "scale", "restart_search")
# No chasing while the phone is still ringing (snoozing is never pressured, hard rule 7),
# nor once the night shift has handed off or the fix is out.
QUIET_PHASES = ("paged", "handed_off", "fixed", "debriefed")
# A debrief needs checkout to be safe first; resubmitting is allowed (no shame mechanics).
DEBRIEF_PHASES = ("stabilized", "handed_off", "fixed", "debriefed")


@dataclass(frozen=True)
class Note:
    """A shared finding or a status update."""

    by: str
    text: str
    at: float


@dataclass(frozen=True)
class PanelView:
    panel: str
    at: float


@dataclass(frozen=True)
class PullRequest:
    """Read from GitHub by PR verify (not built yet). The engine only reads it."""

    number: int
    merged: bool
    ci_passed: bool | None
    substantive_review: bool
    mentor_review: str | None = None

    @property
    def ready_to_deploy(self) -> bool:
        return self.merged and self.ci_passed is True


@dataclass(frozen=True)
class Debrief:
    by: str
    answer: str
    at: float


@dataclass(frozen=True)
class IncidentState:
    incident_id: str
    level: str
    paged_at: float
    last_contact_at: float
    phase: str = "paged"
    status: str = "broken"
    rollback_at: float | None = None
    restart_at: float | None = None
    panel_views: tuple[PanelView, ...] = ()
    findings: tuple[Note, ...] = ()
    status_updates: tuple[Note, ...] = ()
    actions_taken: tuple[str, ...] = ()
    hint_calls: int = 0
    pr: PullRequest | None = None
    debrief: Debrief | None = None

    @property
    def opened_panels(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(view.panel for view in self.panel_views))

    def opened(self, panel: str) -> bool:
        return any(view.panel == panel for view in self.panel_views)

    def opened_after(self, panel: str, moment: float) -> bool:
        return any(view.panel == panel and view.at >= moment for view in self.panel_views)

    def did(self, action: str) -> bool:
        return any(label.split(":", 1)[0] == action for label in self.actions_taken)

    @property
    def team_texts(self) -> tuple[str, ...]:
        return tuple(note.text for note in self.findings + self.status_updates)

    @property
    def loyalty_discounts(self) -> str:
        return "off" if self.status == "rolled_back" else "on"


def new_incident(incident_id: str, level: str, now: float) -> IncidentState:
    if level not in LEVELS:
        raise ValueError(f"level must be one of {', '.join(LEVELS)}")
    return IncidentState(incident_id=incident_id, level=level, paged_at=now, last_contact_at=now)
