"""Profile, connections, network and evidence.

GET/PATCH /api/me · POST /api/connections · GET /api/connections/pending · GET /api/network
GET /api/evidence/{handle} (public: handles only, never contact details or GitHub logins)
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from accounts import HandleTaken
from auth import RELAY_ACTOR, Actor, require_member, require_signed_in
from engine.errors import conflict, invalid
from engine.my_incidents import my_incidents
from engine.rubric import facts_rubric
from engine.state import IncidentState
from network import UNSET, NetworkStore

from .deps import Runtime, get_runtime, translate_store_errors
from .incidents import HANDLE_PATTERN

GITHUB_LOGIN = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
MAX_CONTACT_CHARS = 120
MAX_NOTE_CHARS = 200
router = APIRouter(prefix="/api", tags=["network"])


def participants(state: IncidentState) -> tuple[str, ...]:
    """People who actually worked this incident: took an action or rated the handoff.

    Being named by someone else (as a teammate or morning pair) is not enough; you take part yourself.
    """
    rater = (state.handoff.rating.by,) if state.handoff and state.handoff.rating else ()
    return tuple(dict.fromkeys(state.actors + rater))


def get_network(request: Request) -> NetworkStore:
    return request.app.state.network


# ---------- profile ----------

class ProfilePatch(BaseModel):
    github_login: str | None = Field(default=None, max_length=39)
    contact: str | None = Field(default=None, max_length=MAX_CONTACT_CHARS)
    public_evidence: bool | None = None   # opt in to a public evidence page

    @field_validator("github_login")
    @classmethod
    def _login(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if not GITHUB_LOGIN.fullmatch(value.strip()):
            raise ValueError("not a GitHub login")
        return value.strip().lower()

    @field_validator("contact")
    @classmethod
    def _contact(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


def _me(store: NetworkStore, request: Request, handle: str) -> dict:
    profile = store.profile(handle)
    return {"handle": handle, "github_login": profile.github_login, "contact": profile.contact,
            "public_evidence": profile.public_evidence}


@router.get("/me")
def get_me(request: Request, actor: Actor = Depends(require_member), store: NetworkStore = Depends(get_network)):
    return _me(store, request, actor.handle)


@router.patch("/me")
def patch_me(body: ProfilePatch, request: Request, actor: Actor = Depends(require_member),
             store: NetworkStore = Depends(get_network)) -> dict:
    sent = body.model_fields_set
    store.update_profile(
        actor.handle,
        github_login=body.github_login if "github_login" in sent else UNSET,
        contact=body.contact if "contact" in sent else UNSET,
        public_evidence=bool(body.public_evidence) if "public_evidence" in sent else UNSET,
    )
    return _me(store, request, actor.handle)


class ClaimHandle(BaseModel):
    handle: str = Field(min_length=1, max_length=32)


@router.post("/me/handle")
def claim_handle(body: ClaimHandle, request: Request, actor: Actor = Depends(require_signed_in)) -> dict:
    """Auth0 mode: pick your pseudonymous handle once. Demo mode handles come from DEMO_TEAM."""
    if actor.internal or actor.auth_sub is None:
        raise conflict("not_signed_in", "Sign in with Auth0 to pick a handle.")
    if actor.handle:
        raise conflict("handle_already_set", f"Your handle is already {actor.handle}.")
    handle = body.handle.strip().lower()
    if not HANDLE_PATTERN.fullmatch(handle) or handle == RELAY_ACTOR:
        raise invalid("bad_handle", "Use 1-32 lowercase letters, digits, - or _. No real names needed.")
    try:
        request.app.state.accounts.claim(actor.auth_sub, handle)
    except HandleTaken:
        raise conflict("handle_taken", "That handle is taken. Try another.") from None
    return _me(request.app.state.network, request, handle)


# ---------- connections ----------

class ConnectionRequest(BaseModel):
    incident_id: str = Field(min_length=1, max_length=64)
    to_user: str = Field(min_length=1, max_length=32)
    work_again: bool
    note: str = Field(default="", max_length=MAX_NOTE_CHARS)


@router.post("/connections")
def post_connection(body: ConnectionRequest, actor: Actor = Depends(require_member),
                    rt: Runtime = Depends(get_runtime), store: NetworkStore = Depends(get_network)) -> dict:
    """Private answer. The response never says what the other person answered."""
    state, _ = translate_store_errors(lambda: rt.store.get(body.incident_id), body.incident_id)
    worked = participants(state)
    to_user = body.to_user.strip().lower()
    if actor.handle not in worked:
        raise conflict("not_participant", "You can only answer about people you worked an incident with.")
    if to_user == actor.handle or to_user not in worked:
        raise invalid("not_a_teammate", "Pick someone who worked this incident with you.")
    store.answer(body.incident_id, actor.handle, to_user, body.work_again, body.note.strip())
    return {"ok": True, "incident_id": body.incident_id, "to_user": to_user, "work_again": body.work_again}


@router.get("/connections/pending")
def pending_connections(actor: Actor = Depends(require_member), rt: Runtime = Depends(get_runtime),
                        store: NetworkStore = Depends(get_network)) -> dict:
    answered = store.answered(actor.handle)
    pending = [
        {"incident_id": state.incident_id, "handle": other}
        for state, _ in rt.store.all() if actor.handle in participants(state)
        for other in participants(state)
        if other != actor.handle and (state.incident_id, other) not in answered
    ]
    return {"pending": pending}


@router.get("/network")
def get_network_cards(actor: Actor = Depends(require_member), rt: Runtime = Depends(get_runtime),
                      store: NetworkStore = Depends(get_network)) -> dict:
    """Cards only where both said yes. Contact details appear only here."""
    cards = []
    for other, incident_id in store.mutual(actor.handle):
        try:
            state, _ = rt.store.get(incident_id)
        except KeyError:
            continue
        profile = store.profile(other)
        cards.append({
            "handle": other, "incident_id": incident_id,
            "basis": {"level": state.level, "phase": state.phase, "pr_url": state.pr.url if state.pr else None},
            "contact": profile.contact, "github_login": profile.github_login,
        })
    return {"cards": cards}


# ---------- evidence (public) ----------

def _role(state: IncidentState, handle: str) -> str:
    if state.handoff and handle in state.handoff.night_pair:
        return "night"
    if state.handoff and handle in state.handoff.morning_pair:
        return "morning"
    return "teammate"


def _incident_evidence(state: IncidentState, handle: str, rt: Runtime) -> dict:
    pr = state.pr
    return {
        "incident_id": state.incident_id, "level": state.level, "phase": state.phase, "status": state.status,
        "role": _role(state, handle),
        "findings_shared": sum(1 for note in state.findings if note.by == handle),
        "status_updates": sum(1 for note in state.status_updates if note.by == handle),
        "handoff_rating": state.handoff.rating.score if state.handoff and state.handoff.rating else None,
        "pr": None if pr is None else {"url": pr.url, "merged": pr.merged, "ci": pr.ci,
                                       "reviewers": len(pr.reviewers), "mentor_reviewed": pr.mentor_review is not None},
        "rubric": facts_rubric(state, rt.scenario),
    }


def _evidence(handle: str, rt: Runtime, store: NetworkStore) -> dict:
    incidents = [_incident_evidence(state, handle, rt) for state, _ in rt.store.all() if handle in participants(state)]
    if not incidents:
        raise HTTPException(status_code=404, detail="No evidence for that handle yet.")
    return {"handle": handle, "incidents": incidents, "connections": len(store.mutual(handle))}


@router.get("/me/incidents")
def get_my_incidents(actor: Actor = Depends(require_member), rt: Runtime = Depends(get_runtime)) -> dict:
    """Your incidents, your role in each, and what is waiting on you (e.g. a handoff handed to you)."""
    return {"incidents": my_incidents([state for state, _ in rt.store.all()], actor.handle)}


@router.get("/me/evidence")
def get_my_evidence(actor: Actor = Depends(require_member), rt: Runtime = Depends(get_runtime),
                    store: NetworkStore = Depends(get_network)) -> dict:
    """Your own record, whether or not you made it public."""
    return _evidence(actor.handle, rt, store)


@router.get("/evidence/{handle}")
def get_evidence(handle: str, rt: Runtime = Depends(get_runtime), store: NetworkStore = Depends(get_network)) -> dict:
    """Public only if that person opted in (PATCH /api/me {"public_evidence": true}); 404 otherwise."""
    handle = handle.strip().lower()
    if not store.profile(handle).public_evidence:
        raise HTTPException(status_code=404, detail="No public evidence for that handle.")
    return _evidence(handle, rt, store)
