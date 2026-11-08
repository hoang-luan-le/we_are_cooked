"""Who is calling. Writes need an actor; reads do not.

- X-Internal-Key: <INTERNAL_KEY>  -> the Dana relay (works with or without Auth0). Only accepted by
  `require_actor` routes (/hint, /debrief); `require_member` routes refuse it, so the AI can never
  act on the incident (CLAUDE.md hard rule 2).
- Demo mode (no AUTH0_DOMAIN): X-Demo-User: <handle>, only for handles in DEMO_TEAM.
- Auth0 mode: Authorization: Bearer <access token>, verified against the tenant's keys. A signed-in
  person without a handle yet may only claim one (POST /api/me/handle); everything else answers
  403 handle_required.
"""
from __future__ import annotations

import hmac
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request

from accounts import InvalidToken
from config import Settings
from engine.errors import ActionRejected

RELAY_ACTOR = "dana-relay"
BEARER = "bearer "


@dataclass(frozen=True)
class Actor:
    handle: str                # "" = signed in with Auth0 but no handle claimed yet
    internal: bool = False
    auth_sub: str | None = None


def _relay(settings: Settings, key: str) -> Actor:
    given, expected = key.encode("utf-8"), settings.internal_key.encode("utf-8")
    if expected and hmac.compare_digest(given, expected):
        return Actor(handle=RELAY_ACTOR, internal=True)
    raise HTTPException(status_code=403, detail="Invalid internal key.")


def _signed_in(request: Request, authorization: str | None) -> Actor:
    if not authorization or not authorization.lower().startswith(BEARER):
        raise HTTPException(status_code=401, detail="Sign in required.")
    try:
        claims = request.app.state.auth0.verify(authorization[len(BEARER):].strip())
    except InvalidToken:
        raise HTTPException(status_code=401, detail="Your sign-in has expired or is invalid.") from None
    sub = claims["sub"]
    return Actor(handle=request.app.state.accounts.handle_for(sub) or "", auth_sub=sub)


def require_signed_in(
    request: Request,
    x_internal_key: str | None = Header(default=None),
    x_demo_user: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Actor:
    """Any authenticated caller, including an Auth0 user who hasn't claimed a handle yet."""
    settings: Settings = request.app.state.settings
    if x_internal_key is not None:
        return _relay(settings, x_internal_key)
    if not settings.demo_mode:
        return _signed_in(request, authorization)
    if x_demo_user is not None:
        handle = x_demo_user.strip().lower()
        if handle not in settings.demo_team:
            raise HTTPException(status_code=403, detail="That handle isn't on the demo team.")
        return Actor(handle=handle)
    raise HTTPException(status_code=401, detail="Sign in required.")


def require_actor(actor: Actor = Depends(require_signed_in)) -> Actor:
    """Someone with a handle (or the relay)."""
    if not actor.internal and not actor.handle:
        raise ActionRejected(403, "handle_required", "Pick a handle first (POST /api/me/handle).")
    return actor


def require_member(actor: Actor = Depends(require_actor)) -> Actor:
    """A person on the team. The relay's internal key is refused here."""
    if actor.internal:
        raise HTTPException(status_code=403, detail="The relay key can't take incident actions.")
    return actor


def is_known_handle(request: Request, handle: str) -> bool:
    """Demo mode knows the demo team; Auth0 mode knows handles people have claimed."""
    settings: Settings = request.app.state.settings
    if settings.demo_mode:
        return handle in settings.demo_team
    return request.app.state.accounts.has_handle(handle)
