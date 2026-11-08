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
    """Read from GitHub by POST /api/pr/verify. The engine only reads it; GitHub owns the truth."""

    number: int
    merged: bool
    ci_passed: bool | None           # None = CI still running or not found
    substantive_review: bool         # a non-author review with real content
    mentor_review: str | None = None  # GitHub login of the mentor who reviewed
    url: str = ""
    author: str = ""
    head_sha: str = ""
    ci: str = "none"                 # success | failure | pending | none
    reviewers: tuple[str, ...] = ()

    @property
    def ready_to_deploy(self) -> bool:
        return self.merged and self.ci_passed is True


@dataclass(frozen=True)
class Debrief:
    by: str
    answer: str
    at: float


# What happened · current state · what was tried · what is still risky (design doc, flow 3).
HANDOFF_PARTS = ("what_happened", "current_state", "tried", "risks")
RATING_MIN, RATING_MAX = 1, 5
CLEAR_RATING = 4      # 4-5 counts as a clear handoff for the Collaboration score


@dataclass(frozen=True)
class HandoffRating:
    by: str
    score: int            # RATING_MIN..RATING_MAX
    note: str             # one line
    at: float


@dataclass(frozen=True)
class Handoff:
    """The night pair's four-part note for the morning pair."""

    by: str
    night_pair: tuple[str, ...]
    at: float
    what_happened: str
    current_state: str
    tried: str
    risks: str
    morning_pair: tuple[str, ...] = ()   # named by the night pair; they join and rate
    rating: HandoffRating | None = None

    @property
    def text(self) -> str:
        return " ".join((self.what_happened, self.current_state, self.tried, self.risks))

    @property
    def rated_clear(self) -> bool:
        return self.rating is not None and self.rating.score >= CLEAR_RATING


@dataclass(frozen=True)
class IncidentState:
    incident_id: str
    level: str
    paged_at: float
    last_contact_at: float
    phase: str = "paged"
    status: str = "broken"
    rollback_at: float | None = None
    fixed_at: float | None = None
    restart_at: float | None = None
    snoozed_at: float | None = None
    snoozes: int = 0
    panel_views: tuple[PanelView, ...] = ()
    findings: tuple[Note, ...] = ()
    status_updates: tuple[Note, ...] = ()
    actions_taken: tuple[str, ...] = ()
    hint_calls: int = 0
    pr: PullRequest | None = None
    debrief: Debrief | None = None
    handoff: Handoff | None = None
    actors: tuple[str, ...] = ()        # everyone who took an incident action, in order
    teammates: tuple[str, ...] = ()     # set at start; the handoff's morning pair is added on top

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
        handoff = (self.handoff.text,) if self.handoff else ()
        return tuple(note.text for note in self.findings + self.status_updates) + handoff

    @property
    def all_teammates(self) -> tuple[str, ...]:
        """Who may act: the starting teammates plus the morning pair named in the handoff."""
        morning = self.handoff.morning_pair if self.handoff else ()
        return tuple(dict.fromkeys(self.teammates + morning))

    @property
    def loyalty_discounts(self) -> str:
        return "off" if self.status == "rolled_back" else "on"


def new_incident(incident_id: str, level: str, now: float, teammates: tuple[str, ...]) -> IncidentState:
    if level not in LEVELS:
        raise ValueError(f"level must be one of {', '.join(LEVELS)}")
    if not teammates:
        raise ValueError("an incident needs at least one teammate")
    return IncidentState(
        incident_id=incident_id, level=level, paged_at=now, last_contact_at=now,
        teammates=tuple(dict.fromkeys(teammates)),
    )
