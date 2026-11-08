"""POST /api/pr/verify: read a pilot-repo PR from GitHub and record it on the incident.

GitHub owns code, tests and merges (hard rule 1); we only read. A merged PR with passing CI
unlocks deploy_fix. The GitHub call happens outside the store lock, then the result is recorded.
"""
from __future__ import annotations

from dataclasses import replace

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from auth import Actor, require_member
from engine.errors import ActionRejected, invalid
from engine.state import PullRequest
from engine.views import state_view
from github_client import GitHubClient, GitHubUnavailable, PullInfo, RepoNotAllowed, parse_pr_url

from .deps import Runtime, get_runtime, require_teammate, translate_store_errors

router = APIRouter(prefix="/api/pr", tags=["pr"])


class VerifyRequest(BaseModel):
    incident_id: str = Field(min_length=1, max_length=64)
    pr_url: str = Field(min_length=1, max_length=300)


def to_pull_request(info: PullInfo) -> PullRequest:
    mentor = next((r.login for r in info.reviews if r.mentor), None)
    return PullRequest(
        number=info.number, merged=info.merged,
        ci_passed={"success": True, "failure": False}.get(info.ci),
        substantive_review=any(r.substantive for r in info.reviews),
        mentor_review=mentor, url=info.url, author=info.author, head_sha=info.head_sha, ci=info.ci,
        reviewers=tuple(r.login for r in info.reviews),
    )


def _read_pull(github: GitHubClient | None, pr_url: str) -> PullInfo:
    if github is None:
        raise ActionRejected(503, "github_off", "GitHub isn't configured (PILOT_REPOS is empty).")
    parsed = parse_pr_url(pr_url)
    if parsed is None:
        raise invalid("bad_pr_url", "Use a link like https://github.com/<owner>/<repo>/pull/<number>.")
    repo, number = parsed
    try:
        return github.pull(repo, number)
    except RepoNotAllowed:
        raise invalid("repo_not_allowed", f"Only the pilot repo can be used: {', '.join(github.allowlist)}.") from None
    except GitHubUnavailable:
        raise ActionRejected(502, "github_unavailable", "Couldn't reach GitHub. Try again in a moment.") from None


@router.post("/verify")
def verify_pr(
    body: VerifyRequest, request: Request, actor: Actor = Depends(require_member), rt: Runtime = Depends(get_runtime),
) -> dict:
    state, _ = translate_store_errors(lambda: rt.store.get(body.incident_id), body.incident_id)
    require_teammate(state, actor)  # check before calling GitHub
    pull = to_pull_request(_read_pull(getattr(request.app.state, "github", None), body.pr_url))

    def change(current, now):
        require_teammate(current, actor)
        new_state = replace(current, pr=pull, actions_taken=current.actions_taken + ("pr_verify",))
        return new_state, state_view(new_state, rt.scenario, now)

    return translate_store_errors(lambda: rt.store.change(body.incident_id, change), body.incident_id)
