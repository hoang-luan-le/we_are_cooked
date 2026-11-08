"""Who is calling. Writes (actions, hints, debrief, reset) need an actor; reads do not.

- X-Internal-Key: <INTERNAL_KEY>  -> the Dana relay (works with or without Auth0). Only accepted by
  `require_actor` routes (/hint, /debrief); `require_member` routes (actions, reset) refuse it, so
  the AI can never act on the incident (CLAUDE.md hard rule 2).
- X-Demo-User: <handle>          -> demo mode only, and only for handles in DEMO_TEAM.
- Auth0 bearer tokens: not built yet; until then, Auth0 mode accepts only the internal key.
"""
from __future__ import annotations

import hmac
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request

from config import Settings

RELAY_ACTOR = "dana-relay"


@dataclass(frozen=True)
class Actor:
    handle: str
    internal: bool = False


def require_actor(
    request: Request,
    x_internal_key: str | None = Header(default=None),
    x_demo_user: str | None = Header(default=None),
) -> Actor:
    settings: Settings = request.app.state.settings
    if x_internal_key is not None:
        given, expected = x_internal_key.encode("utf-8"), settings.internal_key.encode("utf-8")
        if expected and hmac.compare_digest(given, expected):
            return Actor(handle=RELAY_ACTOR, internal=True)
        raise HTTPException(status_code=403, detail="Invalid internal key.")
    if x_demo_user is not None:
        if not settings.demo_mode:
            raise HTTPException(status_code=401, detail="Sign in required.")
        handle = x_demo_user.strip().lower()
        if handle not in settings.demo_team:
            raise HTTPException(status_code=403, detail="That handle isn't on the demo team.")
        return Actor(handle=handle)
    raise HTTPException(status_code=401, detail="Sign in required.")


def require_member(actor: Actor = Depends(require_actor)) -> Actor:
    """A person on the team. The relay's internal key is refused here."""
    if actor.internal:
        raise HTTPException(status_code=403, detail="The relay key can't take incident actions.")
    return actor
