"""Schema for scenario/scenario.json. Values live in the JSON; this only checks their shape."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

CLOCK_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")


class Metrics(_Frozen):
    error_rate: float = Field(ge=0, le=100)
    orders_per_min: int = Field(ge=0)
    p95_ms: int = Field(ge=0)


class RestartDip(Metrics):
    duration_s: float = Field(gt=0)


class MetricsSpec(_Frozen):
    baseline: Metrics
    at_page: Metrics
    broken: Metrics
    ramp_s: float = Field(gt=0)
    recovery_s: float = Field(gt=0)
    restart_dip: RestartDip


class TopicText(_Frozen):
    topic: str = Field(min_length=1)
    text: str = Field(min_length=1)


class Stakeholders(_Frozen):
    update_every_s: float = Field(gt=0)
    nudge_message: str = Field(min_length=1)


class FoundWhen(_Frozen):
    panels_opened: tuple[str, ...] = ()
    action: str | None = None
    status: str | None = None
    team_names_cause: bool = False

    @model_validator(mode="after")
    def _has_a_condition(self) -> "FoundWhen":
        if not (self.panels_opened or self.action or self.status or self.team_names_cause):
            raise ValueError("found_when needs at least one condition")
        return self


class LadderStep(_Frozen):
    topic: str = Field(min_length=1)
    source: str = Field(min_length=1)
    found_when: FoundWhen
    fact: str = Field(min_length=1)
    hint: str = Field(min_length=1)


class Clock(_Frozen):
    page_at: str = Field(pattern=CLOCK_PATTERN)


class Releases(_Frozen):
    bad: str
    bad_at: str = Field(pattern=CLOCK_PATTERN)
    good: str


class ScenarioSpec(_Frozen):
    """Everything except the answer key. Safe to read from any route; still sent field by field."""

    id: str = Field(min_length=1)
    incident_id: str = Field(min_length=1, pattern=r"^[a-z0-9_-]+$")
    clock: Clock
    panels: tuple[str, ...] = Field(min_length=1)
    releases: Releases
    metrics: MetricsSpec
    dana_knows: tuple[TopicText, ...]
    stakeholders: Stakeholders
    action_results: dict[str, str]
    help_ladder: tuple[LadderStep, ...] = Field(min_length=1)
    all_found_hint: str = Field(min_length=1)

    @model_validator(mode="after")
    def _ladder_uses_known_panels(self) -> "ScenarioSpec":
        unknown = {p for step in self.help_ladder for p in step.found_when.panels_opened} - set(self.panels)
        if unknown:
            raise ValueError(f"help_ladder uses unknown panels: {', '.join(sorted(unknown))}")
        return self


class CommunicationKeywords(_Frozen):
    impact: tuple[str, ...] = Field(min_length=1)
    cause: tuple[str, ...] = Field(min_length=1)
    action: tuple[str, ...] = Field(min_length=1)
    risk: tuple[str, ...] = Field(min_length=1)


class AnswerKey(_Frozen):
    """Server-side only. Never serialized to a client or to Dana/Gemini (CLAUDE.md hard rule 3)."""

    root_cause: str
    fix: str
    cause_keywords: tuple[str, ...] = Field(min_length=1)
    communication_keywords: CommunicationKeywords
