"""Load and validate scenario/scenario.json (owned by BA2).

The answer key is parsed into its own object at load time. Routes only ever read
`Scenario.spec`; `Scenario.answer_key` is for server-side scoring (CLAUDE.md hard rule 3).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from scenario_models import AnswerKey, ScenarioSpec

ANSWER_KEY_FIELD = "answer_key"
MAX_REPORTED_ERRORS = 3


class ScenarioError(Exception):
    """The scenario file is missing or invalid. `reason` is safe to show in /health."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Scenario:
    spec: ScenarioSpec
    answer_key: AnswerKey

    @property
    def id(self) -> str:
        return self.spec.id


def load_scenario(path: Path) -> Scenario:
    try:
        raw_text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ScenarioError("scenario file not found") from exc
    except OSError as exc:
        raise ScenarioError("scenario file could not be read") from exc

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ScenarioError(f"scenario file is not valid JSON (line {exc.lineno})") from exc

    return parse_scenario(data)


def parse_scenario(data: Any) -> Scenario:
    if not isinstance(data, dict):
        raise ScenarioError("scenario must be a JSON object")
    if ANSWER_KEY_FIELD not in data:
        raise ScenarioError(f"scenario is missing required keys: {ANSWER_KEY_FIELD}")

    public = {key: value for key, value in data.items() if key != ANSWER_KEY_FIELD}
    try:
        spec = ScenarioSpec.model_validate(public)
    except ValidationError as exc:
        raise ScenarioError(f"scenario is invalid: {_summarize(exc)}") from exc
    try:
        answer_key = AnswerKey.model_validate(data[ANSWER_KEY_FIELD])
    except ValidationError as exc:
        # Field names only; never echo answer-key values into /health.
        fields = sorted({".".join(str(p) for p in err["loc"]) or "(root)" for err in exc.errors()})
        raise ScenarioError(f"scenario {ANSWER_KEY_FIELD} is invalid at: {', '.join(fields)}") from exc
    return Scenario(spec=spec, answer_key=answer_key)


def _summarize(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors()[:MAX_REPORTED_ERRORS]:
        where = ".".join(str(p) for p in err["loc"]) or "(root)"
        parts.append(f"{where}: {err['msg']}")
    extra = len(exc.errors()) - MAX_REPORTED_ERRORS
    if extra > 0:
        parts.append(f"and {extra} more")
    return "; ".join(parts)
