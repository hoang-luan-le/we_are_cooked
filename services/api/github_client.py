"""Read-only GitHub client: PR verify, release diffs. Never writes, never runs code.

- Only repos in PILOT_REPOS are read (allowlist). GITHUB_TOKEN is optional (public limits otherwise).
- Responses are cached for 15 s (design doc). Any failure raises GitHubUnavailable so callers can fall
  back (deploy diffs fall back to scenario.json; PR verify returns 502 and the demo uses a known PR).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

import httpx

import tls

logger = logging.getLogger("incident_lab.github")
API = "https://api.github.com"
CACHE_TTL_S = 15.0
TIMEOUT_S = 8.0
PR_URL = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/(\d+)/?$")
SUBSTANTIVE_BODY_CHARS = 40
REVIEW_STATES = ("APPROVED", "CHANGES_REQUESTED", "COMMENTED")
CI_OK = ("success", "neutral", "skipped")


class GitHubUnavailable(Exception):
    pass


class RepoNotAllowed(Exception):
    pass


@dataclass(frozen=True)
class Review:
    login: str
    state: str
    substantive: bool
    mentor: bool


@dataclass(frozen=True)
class PullInfo:
    repo: str
    number: int
    url: str
    author: str
    head_sha: str
    merged: bool
    ci: str                      # success | failure | pending | none
    reviews: tuple[Review, ...]
    base_ref: str = ""
    created_at: float = 0.0      # epoch seconds
    files: tuple[str, ...] = ()


def _epoch(iso: str | None) -> float:
    if not iso:
        return 0.0
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def parse_pr_url(url: str) -> tuple[str, int] | None:
    match = PR_URL.match(url.strip())
    return (match.group(1).lower(), int(match.group(2))) if match else None


def ci_conclusion(check_runs: list[dict], status_state: str | None) -> str:
    """All check runs finished OK -> success; any failed -> failure; still running -> pending."""
    if check_runs:
        if any(run.get("status") != "completed" for run in check_runs):
            return "pending"
        return "success" if all(run.get("conclusion") in CI_OK for run in check_runs) else "failure"
    return {"success": "success", "failure": "failure", "error": "failure", "pending": "pending"}.get(
        status_state or "", "none")


def summarize_reviews(raw: list[dict], comments: list[dict], author: str, mentors: tuple[str, ...]) -> tuple[Review, ...]:
    """One entry per reviewer (their latest review). Self-reviews don't count."""
    inline = {}
    for comment in comments:
        login = (comment.get("user") or {}).get("login", "").lower()
        inline[login] = inline.get(login, 0) + 1
    latest: dict[str, Review] = {}
    for review in raw:
        login = (review.get("user") or {}).get("login", "").lower()
        state = review.get("state", "")
        if not login or login == author.lower() or state not in REVIEW_STATES:
            continue
        body = (review.get("body") or "").strip()
        substantive = len(body) >= SUBSTANTIVE_BODY_CHARS or inline.get(login, 0) > 0
        earlier = latest.get(login)
        latest[login] = Review(login=login, state=state, mentor=login in mentors,
                               substantive=substantive or bool(earlier and earlier.substantive))
    return tuple(latest.values())


class GitHubClient:
    def __init__(self, *, token: str, allowlist: tuple[str, ...], mentors: tuple[str, ...],
                 transport: httpx.BaseTransport | None = None, clock: Callable[[], float] = time.monotonic) -> None:
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                   "User-Agent": "incident-lab"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._http = httpx.Client(base_url=API, headers=headers, timeout=TIMEOUT_S, transport=transport,
                                  verify=tls.verify())
        self.allowlist = tuple(repo.lower() for repo in allowlist)
        self.mentors = tuple(m.lower() for m in mentors)
        self._clock = clock
        self._cache: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def close(self) -> None:
        self._http.close()

    @property
    def pilot_repo(self) -> str | None:
        return self.allowlist[0] if self.allowlist else None

    def _get(self, path: str, params: dict | None = None) -> Any:
        key = f"{path}?{sorted((params or {}).items())}"
        now = self._clock()
        with self._lock:
            cached = self._cache.get(key)
            if cached and now - cached[0] < CACHE_TTL_S:
                return cached[1]
        try:
            response = self._http.get(path, params=params)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("GitHub read failed for %s: %s", path, exc)
            raise GitHubUnavailable(str(exc)) from exc
        with self._lock:
            self._cache = {**self._cache, key: (now, data)}
        return data

    def _check(self, repo: str) -> None:
        if repo.lower() not in self.allowlist:
            raise RepoNotAllowed(repo)

    def pull(self, repo: str, number: int) -> PullInfo:
        self._check(repo)
        pr = self._get(f"/repos/{repo}/pulls/{number}")
        sha = pr["head"]["sha"]
        author = (pr.get("user") or {}).get("login", "")
        runs = self._get(f"/repos/{repo}/commits/{sha}/check-runs", {"per_page": 100}).get("check_runs", [])
        status = None if runs else self._get(f"/repos/{repo}/commits/{sha}/status").get("state")
        reviews = self._get(f"/repos/{repo}/pulls/{number}/reviews", {"per_page": 100})
        comments = self._get(f"/repos/{repo}/pulls/{number}/comments", {"per_page": 100})
        files = self._get(f"/repos/{repo}/pulls/{number}/files", {"per_page": 100})
        return PullInfo(
            base_ref=(pr.get("base") or {}).get("ref", ""), created_at=_epoch(pr.get("created_at")),
            files=tuple(f.get("filename", "") for f in files),
            repo=repo, number=number, url=pr.get("html_url", f"https://github.com/{repo}/pull/{number}"),
            author=author.lower(), head_sha=sha, merged=bool(pr.get("merged")),
            ci=ci_conclusion(runs, status), reviews=summarize_reviews(reviews, comments, author, self.mentors),
        )

    def compare_files(self, repo: str, base: str, head: str) -> list[dict]:
        self._check(repo)
        data = self._get(f"/repos/{repo}/compare/{base}...{head}")
        return [{"filename": f["filename"], "patch": f.get("patch", "")} for f in data.get("files", [])]

    def release_diffs(self, scenario) -> dict[str, list[dict]] | None:
        """version -> files, comparing each release with the one before it. None if GitHub is unreachable."""
        repo = self.pilot_repo
        if repo is None:
            return None
        deploys = scenario.spec.deploys
        try:
            return {later.version: self.compare_files(repo, earlier.version, later.version)
                    for earlier, later in zip(deploys, deploys[1:])}
        except GitHubUnavailable:
            return None
