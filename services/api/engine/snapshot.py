"""IncidentState <-> JSON-safe dict, for the `incidents.snapshot` column.

Times are wall-clock seconds (time.time), so a snapshot still means something after a restart.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .state import Debrief, Handoff, HandoffRating, IncidentState, Note, PanelView, PullRequest

SNAPSHOT_VERSION = 1


class SnapshotError(ValueError):
    pass


def to_snapshot(state: IncidentState) -> dict[str, Any]:
    return {"v": SNAPSHOT_VERSION, **asdict(state)}


def from_snapshot(data: dict[str, Any]) -> IncidentState:
    if data.get("v") != SNAPSHOT_VERSION:
        raise SnapshotError(f"unsupported snapshot version {data.get('v')!r}")
    fields = {key: value for key, value in data.items() if key != "v"}
    try:
        return IncidentState(**{
            **fields,
            "panel_views": tuple(PanelView(**p) for p in fields.get("panel_views", ())),
            "findings": tuple(Note(**n) for n in fields.get("findings", ())),
            "status_updates": tuple(Note(**n) for n in fields.get("status_updates", ())),
            "actions_taken": tuple(fields.get("actions_taken", ())),
            "actors": tuple(fields.get("actors", ())),
            "teammates": tuple(fields.get("teammates", ())),
            "pr": _pr(fields.get("pr")),
            "debrief": Debrief(**fields["debrief"]) if fields.get("debrief") else None,
            "handoff": _handoff(fields.get("handoff")),
        })
    except (TypeError, KeyError) as exc:
        raise SnapshotError(f"snapshot does not match IncidentState: {exc}") from exc


def _pr(data: dict[str, Any] | None) -> PullRequest | None:
    if not data:
        return None
    return PullRequest(**{**data, "reviewers": tuple(data.get("reviewers", ()))})


def _handoff(data: dict[str, Any] | None) -> Handoff | None:
    if not data:
        return None
    rating = data.get("rating")
    return Handoff(**{
        **data,
        "night_pair": tuple(data["night_pair"]),
        "morning_pair": tuple(data.get("morning_pair", ())),
        "rating": HandoffRating(**rating) if rating else None,
    })
