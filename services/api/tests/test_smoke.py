"""Smoke tests. Run from services/api:  python tests/test_smoke.py  (must print ALL GOOD).

Also works with pytest:  python -m pytest
Uses the real scenario/scenario.json; expected values are read from it, not copied here.
"""
from __future__ import annotations

import itertools
from contextlib import closing
import json
import os
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timezone
import traceback
from dataclasses import replace
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import adzuna  # noqa: E402
import jwt  # noqa: E402
from config import DEFAULT_DEMO_TEAM, DEFAULT_SCENARIO_PATH, Settings  # noqa: E402
from engine import panels  # noqa: E402
from engine.snapshot import from_snapshot, to_snapshot  # noqa: E402
from metrics_recorder import MetricsRecorder  # noqa: E402
from engine.state import PullRequest  # noqa: E402
from main import create_app  # noqa: E402
from scenario_loader import ScenarioError, load_scenario  # noqa: E402

SCENARIO = load_scenario(DEFAULT_SCENARIO_PATH)
SPEC = SCENARIO.spec
INC = SPEC.incident_id
INTERNAL_KEY = "test-internal-key"
TEAM = {"X-Demo-User": "duy"}          # night pair in these tests
MORNING = {"X-Demo-User": "tung"}      # morning pair
OTHER = {"X-Demo-User": "demo-a"}
RELAY = {"X-Internal-Key": INTERNAL_KEY}
HANDOFF = {
    "what_happened": "About a third of checkouts failed; v2.14.0 reads a loyalty tier guests do not have.",
    "current_state": "Rolled back to v2.13.9; errors are back to baseline.",
    "tried": "Restart did not help; rollback did.",
    "risks": "Discounts are off until a tested fix ships.",
}
# Same list as voice/test_offline.py: words that would give the root cause away.
LEAK_WORDS = ("tier", "keyerror", "guest", "loyalty", "pricing.py", ".get(")
EXAMPLE_ANSWER = (
    "About a third of checkouts failed, all guests, because v2.14.0 read a loyalty tier guests do not have. "
    "We rolled back to v2.13.9 and errors are back to normal. Discounts are off until the fix is tested."
)


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


PILOT = "shopnorth/shopnorth-checkout"
PR_URL = f"https://github.com/{PILOT}/pull/12"
GOOD_REVIEWS = [
    {"user": {"login": "tung-gh"}, "state": "APPROVED",
     "body": "Checked the guest path and the unknown-tier test; the guard tests cover free orders."},
    {"user": {"login": "Mentor-Ana"}, "state": "COMMENTED", "body": "Nice."},
]


class FakeGitHub:
    """Just enough of the GitHub REST API for PR verify and release diffs."""

    def __init__(self, *, merged=True, ci="success", reviews=None, comments=(), down=False, base="main",
                 created="2026-11-08T03:00:00Z", files=("checkout/pricing.py", "tests/test_pricing.py"), number=12):
        self.merged, self.ci, self.down, self.calls = merged, ci, down, 0
        self.base, self.created, self.files, self.number = base, created, list(files), number
        self.reviews = GOOD_REVIEWS if reviews is None else reviews
        self.comments = list(comments)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.down:
            return httpx.Response(503, json={"message": "down"})
        path, base = request.url.path, f"/repos/{PILOT}"
        if path == f"{base}/pulls/12/files":
            return httpx.Response(200, json=[{"filename": f} for f in self.files])
        if path == f"{base}/pulls/12":
            return httpx.Response(200, json={"merged": self.merged, "user": {"login": "duy-gh"},
                                             "head": {"sha": "abc123"}, "html_url": PR_URL,
                                             "base": {"ref": self.base}, "created_at": self.created,
                                             "number": self.number})
        if path == f"{base}/commits/abc123/check-runs":
            runs = [] if self.ci is None else [
                {"status": "in_progress" if self.ci == "pending" else "completed",
                 "conclusion": None if self.ci == "pending" else self.ci}]
            return httpx.Response(200, json={"check_runs": runs})
        if path == f"{base}/commits/abc123/status":
            return httpx.Response(200, json={"state": "pending"})
        if path == f"{base}/pulls/12/reviews":
            return httpx.Response(200, json=self.reviews)
        if path == f"{base}/pulls/12/comments":
            return httpx.Response(200, json=self.comments)
        if path.startswith(f"{base}/compare/"):
            return httpx.Response(200, json={"files": [{"filename": "checkout/pricing.py", "patch": "@@ real @@"}]})
        return httpx.Response(404, json={"message": "Not Found"})


AUTH0_DOMAIN = "incidentlab-test.example.auth0.com"
AUTH0_AUDIENCE = "https://api.incidentlab.example"


class FakeAuth0:
    """An Auth0 tenant: serves its JWKS and signs RS256 access tokens with a throwaway key."""

    def __init__(self):
        from cryptography.hazmat.primitives.asymmetric import rsa

        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.jwks_fetches = 0

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url) == f"https://{AUTH0_DOMAIN}/.well-known/jwks.json"
        self.jwks_fetches += 1
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        return httpx.Response(200, json={"keys": [{**jwk, "kid": "test-key", "use": "sig", "alg": "RS256"}]})

    def token(self, sub: str, *, key=None, audience: str = AUTH0_AUDIENCE, issuer: str = f"https://{AUTH0_DOMAIN}/",
              expires_in: int = 3600) -> dict:
        now = int(time.time())
        claims = {"sub": sub, "aud": audience, "iss": issuer, "iat": now, "exp": now + expires_in}
        token = jwt.encode(claims, key or self.key, algorithm="RS256", headers={"kid": "test-key"})
        return {"Authorization": f"Bearer {token}"}


class Harness:
    """A running app with a fake clock and helpers for the common calls."""

    _keys = itertools.count()

    def __init__(self, scenario_path: Path = DEFAULT_SCENARIO_PATH, auth0_domain: str = "",
                 sqlite_path: str = ":memory:", database_url: str = "", clock: FakeClock | None = None,
                 demo_team: tuple[str, ...] = DEFAULT_DEMO_TEAM, github: "FakeGitHub | None" = None,
                 jobs_path: Path | None = None, auth0: "FakeAuth0 | None" = None) -> None:
        self.clock = clock or FakeClock()
        if auth0 is not None:
            auth0_domain = AUTH0_DOMAIN
        settings = Settings(scenario_path=scenario_path, internal_key=INTERNAL_KEY, auth0_domain=auth0_domain,
                            auth0_audience=AUTH0_AUDIENCE,
                            sqlite_path=sqlite_path, database_url=database_url, demo_team=demo_team,
                            pilot_repos=(PILOT,) if github else (), mentor_github=("mentor-ana",),
                            jobs_snapshot_path=jobs_path or API_DIR / "tests" / "no-jobs-snapshot.json")
        transport = httpx.MockTransport(github.handle) if github else None
        self.app = create_app(settings, clock=self.clock, github_transport=transport,
                              auth0_transport=httpx.MockTransport(auth0.handle) if auth0 else None)
        self.client = TestClient(self.app)

    def __enter__(self) -> "Harness":
        self.client.__enter__()
        return self

    def __exit__(self, *exc) -> None:
        self.client.__exit__(*exc)

    def act(self, action: str, headers: dict | None = TEAM, key: str | None = None, **body):
        payload = {"action": action, "idempotency_key": key or f"k{next(self._keys)}", **body}
        return self.client.post(f"/api/incident/{INC}/action", json=payload, headers=headers)

    def ok(self, action: str, **body) -> dict:
        response = self.act(action, **body)
        assert response.status_code == 200, f"{action}: {response.status_code} {response.text}"
        return response.json()

    def facts(self) -> dict:
        return self.client.get(f"/api/incident/{INC}/facts").json()

    def state(self) -> dict:
        return self.client.get(f"/api/incident/{INC}").json()

    def hint(self, headers: dict = RELAY):
        return self.client.post(f"/api/incident/{INC}/hint", headers=headers)

    def set_pr(self, incident_id: str = INC, **fields) -> None:
        """Stand-in for PR verify (GitHub), which is not built yet."""
        pr = PullRequest(**{"number": 7, "merged": True, "ci_passed": True, "substantive_review": True, **fields})
        self.app.state.runtime.store.change(incident_id, lambda s, now: (replace(s, pr=pr), None))

    def hand_over(self, score: int = 5) -> None:
        """Night pair (duy) writes the handoff; morning pair (tung) rates it."""
        response = self.client.post(f"/api/incident/{INC}/handoff", json=HANDOFF, headers=TEAM)
        assert response.status_code == 200, response.text
        rating = self.client.post(f"/api/incident/{INC}/handoff/rating", json={"score": score}, headers=MORNING)
        assert rating.status_code == 200, rating.text

    def night_shift(self) -> None:
        """The happy path up to a stabilized checkout."""
        self.ok("answer")
        for panel in ("dashboard", "logs", "deploys"):
            self.ok("open_panel", panel=panel)
        self.ok("share_finding", text="Only guest checkouts fail with KeyError tier")
        self.ok("rollback")
        self.clock.advance(SPEC.metrics.recovery_s)
        self.ok("open_panel", panel="dashboard")


def _temp_scenario(content: str) -> Path:
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    with handle:
        handle.write(content)
    return Path(handle.name)


def _health_for(content: str):
    path = _temp_scenario(content)
    try:
        with Harness(scenario_path=path) as h:
            return h.client.get("/health")
    finally:
        path.unlink()


def _metrics(values) -> dict:
    return {"error_rate": values.error_rate, "orders_per_min": values.orders_per_min, "p95_ms": values.p95_ms}


# ---------- health and scenario loading ----------

def test_health_ok_with_real_scenario():
    with Harness() as h:
        response = h.client.get("/health")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["scenario"] == {"loaded": True, "id": SPEC.id}
    assert body["demo_incident"] == INC and body["demo_mode"] is True


def test_health_degraded_when_scenario_missing():
    with Harness(scenario_path=API_DIR / "tests" / "no-such-scenario.json") as h:
        response = h.client.get("/health")
        assert h.client.get(f"/api/incident/{INC}").status_code == 503
    assert response.status_code == 503
    assert response.json()["scenario"] == {"loaded": False, "error": "scenario file not found"}


def test_health_degraded_on_bad_json_or_schema():
    assert "not valid JSON" in _health_for("{ not json").json()["scenario"]["error"]
    assert "answer_key" in _health_for(json.dumps({"id": "x"})).json()["scenario"]["error"]
    broken = json.loads(DEFAULT_SCENARIO_PATH.read_text(encoding="utf-8"))
    broken["metrics"]["ramp_s"] = 0
    response = _health_for(json.dumps(broken))
    assert response.status_code == 503 and "metrics.ramp_s" in response.json()["scenario"]["error"]


def test_bad_answer_key_error_never_echoes_its_values():
    broken = json.loads(DEFAULT_SCENARIO_PATH.read_text(encoding="utf-8"))
    broken["answer_key"]["cause_keywords"] = "tier"
    error = _health_for(json.dumps(broken)).json()["scenario"]["error"]
    assert "cause_keywords" in error and "tier" not in error.replace("cause_keywords", "")


def test_loader_rejects_non_object():
    path = _temp_scenario("[]")
    try:
        load_scenario(path)
    except ScenarioError:
        pass
    else:
        raise AssertionError("expected ScenarioError")
    finally:
        path.unlink()


# ---------- grounding: what Dana can see ----------

def test_fresh_facts_match_the_page():
    with Harness() as h:
        facts = h.facts()
    assert facts["incident_id"] == INC and facts["phase"] == "paged" and facts["status"] == "broken"
    assert facts["sim_clock"] == SPEC.clock.page_at
    assert facts["impact"] == {**_metrics(SPEC.metrics.at_page), "baseline": _metrics(SPEC.metrics.baseline)}
    assert facts["dana_knows"] == [{"topic": d.topic, "text": d.text} for d in SPEC.dana_knows]
    assert facts["next_hint"] == {"topic": SPEC.help_ladder[0].topic, "hint": SPEC.help_ladder[0].hint}
    assert facts["unlocked"] == [] and facts["facts"] == [] and facts["findings"] == []
    assert facts["hint_calls"] == 0 and facts["nudge"] is False and facts["stakeholder_message"] is None
    assert facts["handoff"] is None and facts["rubric"] is None


def test_fresh_facts_and_all_hints_give_nothing_away():
    with Harness() as h:
        fresh = json.dumps(h.facts()).lower()
        state = json.dumps(h.state()).lower()
    leaked = [w for w in LEAK_WORDS if w in fresh]
    assert not leaked, f"fresh /facts leaks {leaked}"
    texts = [step.hint for step in SPEC.help_ladder] + [SPEC.all_found_hint]
    leaky_hints = [t for t in texts if any(w in t.lower() for w in LEAK_WORDS)]
    assert not leaky_hints, f"hints leak the cause: {leaky_hints}"
    for secret in (SCENARIO.answer_key.root_cause, SCENARIO.answer_key.fix, "answer_key", "cause_keywords"):
        assert secret.lower() not in fresh and secret.lower() not in state


def test_facts_fill_in_as_panels_open():
    with Harness() as h:
        h.ok("answer")
        h.ok("open_panel", panel="logs")
        facts = h.facts()
    assert facts["unlocked"] == ["logs"]
    assert [f["topic"] for f in facts["facts"]] == ["who_fails"]
    assert facts["facts"][0]["source"] == "logs"
    assert facts["next_hint"]["topic"] == "impact"


def test_missing_field_needs_the_team_to_name_the_cause():
    with Harness() as h:
        h.ok("answer")
        h.ok("open_panel", panel="logs")
        h.ok("open_panel", panel="deploys")
        assert "missing_field" not in [f["topic"] for f in h.facts()["facts"]]
        h.ok("share_finding", text="The new code reads the profile tier")
        assert "missing_field" in [f["topic"] for f in h.facts()["facts"]]


# ---------- actions ----------

def test_writes_need_a_known_actor():
    with Harness() as h:
        assert h.act("answer", headers=None).status_code == 401
        assert h.act("answer", headers={"X-Demo-User": "stranger"}).status_code == 403
        assert h.act("answer", headers={"X-Internal-Key": "wrong"}).status_code == 403
        non_ascii = {"X-Internal-Key": "clé".encode("latin-1")}
        assert h.act("answer", headers=non_ascii).status_code == 403  # 403, not a 500
        assert h.act("answer").status_code == 200
        assert h.hint(headers={}).status_code == 401
        assert h.client.post("/api/demo/reset", json={}).status_code == 401
        assert h.client.get(f"/api/incident/{INC}/facts").status_code == 200  # reads stay open


def test_relay_key_can_ask_for_hints_but_never_act():
    """Hard rule 2: the AI talks; it never rolls back, deploys or writes findings."""
    with Harness() as h:
        h.ok("answer")
        for action, extra in (("rollback", {}), ("share_finding", {"text": "tier"}), ("deploy_fix", {})):
            assert h.act(action, headers=RELAY, **extra).status_code == 403, action
        assert h.client.post("/api/demo/reset", json={}, headers=RELAY).status_code == 403
        assert h.hint(headers=RELAY).status_code == 200
        assert h.state()["actions_taken"] == ["answer", "hint"]


def test_demo_user_is_refused_once_auth0_is_on():
    with Harness(auth0_domain="example.auth0.com") as h:
        assert h.act("answer").status_code == 401
        assert h.hint(headers=RELAY).status_code == 200


def test_only_answer_or_snooze_while_paged():
    with Harness() as h:
        response = h.act("open_panel", panel="logs")
        assert response.status_code == 409 and "Answer the call" in response.json()["detail"]
        h.ok("snooze")
        assert h.state()["phase"] == "paged"
        h.ok("answer")
        assert h.state()["phase"] == "investigating"


def test_rejections_carry_a_code_for_the_ui():
    with Harness() as h:
        assert h.act("rollback").json()["code"] == "answer_first"
        h.ok("answer")
        assert h.act("deploy_fix").json() == {"code": "pr_not_ready",
                                               "detail": "deploy_fix needs a merged PR with passing CI."}
        assert h.act("open_panel", key="dup", panel="logs").status_code == 200
        assert h.act("scale", key="dup").json()["code"] == "idempotency_conflict"
        assert h.act("share_finding", text="x" * 281).json()["code"] == "text_too_long"
        assert h.act("share_finding", text="x" * 280).status_code == 200
        assert h.act("status_update", text="x" * 500).status_code == 200
        assert h.act("status_update", text="x" * 501).status_code == 422
        debrief = h.client.post("/api/debrief", json={"incident_id": INC, "answer": "hi"}, headers=TEAM)
        assert debrief.json()["code"] == "debrief_not_ready"


def test_bad_action_input_is_rejected():
    with Harness() as h:
        h.ok("answer")
        assert h.act("dance").status_code == 422
        assert h.act("open_panel", panel="kitchen").status_code == 422
        assert h.act("share_finding", text="   ").status_code == 422
        assert h.act("status_update", text="x" * 2001).status_code == 422
        assert h.client.get("/api/incident/nope/facts").status_code == 404


def test_idempotency_key_applies_once():
    with Harness() as h:
        first = h.act("answer", key="same")
        second = h.act("answer", key="same")
        assert first.status_code == second.status_code == 200 and first.json() == second.json()
        assert h.state()["actions_taken"] == ["answer"]
        assert h.act("snooze", key="same").status_code == 409


def test_reused_key_with_different_text_or_person_is_a_conflict():
    with Harness() as h:
        h.ok("answer")
        assert h.act("share_finding", key="f", text="A").status_code == 200
        assert h.act("share_finding", key="f", text="B tier").status_code == 409
        assert h.act("share_finding", key="f", text="A", headers={"X-Demo-User": "tung"}).status_code == 409
        assert [f["text"] for f in h.state()["findings"]] == ["A"]


def test_impact_ramps_up_then_recovers_after_rollback():
    with Harness() as h:
        h.ok("answer")
        h.clock.advance(SPEC.metrics.ramp_s)
        assert h.facts()["impact"]["error_rate"] == SPEC.metrics.broken.error_rate
        state = h.ok("rollback")["state"]
        assert state["status"] == "rolled_back" and state["loyalty_discounts"] == "off"
        assert state["phase"] == "mitigating"
        h.clock.advance(SPEC.metrics.recovery_s / 2)
        midway = h.facts()["impact"]["error_rate"]
        assert SPEC.metrics.baseline.error_rate < midway < SPEC.metrics.broken.error_rate
        h.clock.advance(SPEC.metrics.recovery_s / 2)
        after = h.state()
        assert after["phase"] == "stabilized"
        assert after["metrics"]["error_rate"] == SPEC.metrics.baseline.error_rate
        assert h.act("rollback").status_code == 409


def test_restart_dips_then_errors_return_and_scale_does_nothing():
    with Harness() as h:
        h.ok("answer")
        h.clock.advance(SPEC.metrics.ramp_s)
        h.ok("restart")
        assert h.facts()["impact"]["error_rate"] == SPEC.metrics.restart_dip.error_rate
        h.clock.advance(SPEC.metrics.restart_dip.duration_s)
        assert h.facts()["impact"]["error_rate"] == SPEC.metrics.broken.error_rate
        h.ok("scale")
        h.ok("restart_search")
        state = h.state()
        assert state["metrics"]["error_rate"] == SPEC.metrics.broken.error_rate and state["status"] == "broken"


def test_deploy_fix_needs_merged_pr_with_passing_ci():
    with Harness() as h:
        h.night_shift()
        response = h.act("deploy_fix")
        assert response.status_code == 409 and "merged PR" in response.json()["detail"]
        h.set_pr(ci_passed=False)
        assert h.act("deploy_fix").status_code == 409
        h.set_pr()
        state = h.ok("deploy_fix")["state"]
        assert state["status"] == "fixed" and state["phase"] == "fixed" and state["loyalty_discounts"] == "on"


# ---------- help calls and the silence chase ----------

def test_hint_counts_and_repeats_until_done():
    with Harness() as h:
        h.ok("answer")
        first, second = h.hint().json(), h.hint().json()
        assert first == {"topic": "impact", "hint": SPEC.help_ladder[0].hint, "hint_calls": 1}
        assert second["hint"] == first["hint"] and second["hint_calls"] == 2
        h.ok("open_panel", panel="dashboard")
        assert h.hint().json()["topic"] == "who_fails"
        assert h.facts()["hint_calls"] == 3


def test_all_found_hint_after_everything():
    with Harness() as h:
        h.night_shift()
        h.ok("open_panel", panel="runbook")
        h.set_pr()
        h.ok("deploy_fix")
        assert h.hint().json() == {"topic": None, "hint": SPEC.all_found_hint, "hint_calls": 1}


def test_nudge_after_silence_cleared_by_update_or_hint():
    every = SPEC.stakeholders.update_every_s
    with Harness() as h:
        h.ok("answer")
        h.clock.advance(every - 1)
        assert h.state()["nudge"] is False
        h.clock.advance(2)
        state, facts = h.state(), h.facts()
        assert state["nudge"] is True and facts["nudge"] is True
        assert state["stakeholder_message"] == facts["stakeholder_message"] == SPEC.stakeholders.nudge_message
        h.ok("status_update", text="Checkout errors, rolling back soon")
        assert h.state()["nudge"] is False
        h.clock.advance(every)
        assert h.facts()["nudge"] is True
        h.hint()
        assert h.facts()["nudge"] is False


def test_snooze_rings_again_later_and_errors_climb():
    snooze = SPEC.metrics.snooze
    with Harness() as h:
        assert h.state()["ringing"] is True
        before = h.facts()["impact"]["error_rate"]
        h.ok("snooze")
        state = h.state()
        assert state["ringing"] is False
        assert state["metrics"]["error_rate"] == round(before + snooze.error_rate_penalty, 1)
        h.clock.advance(snooze.ring_again_s)
        assert h.state()["ringing"] is True
        h.ok("answer")
        assert h.state()["ringing"] is False


def test_nudge_stops_once_rolled_back():
    with Harness() as h:
        h.ok("answer")
        h.ok("rollback")
        h.clock.advance(SPEC.stakeholders.update_every_s * 3)
        assert h.state()["nudge"] is False


def test_no_nudge_while_the_phone_is_still_ringing():
    every = SPEC.stakeholders.update_every_s
    with Harness() as h:
        h.clock.advance(every * 3)
        h.ok("snooze")
        assert h.state()["nudge"] is False
        h.ok("answer")  # the timer starts when they pick up
        assert h.state()["nudge"] is False
        h.clock.advance(every)
        assert h.state()["nudge"] is True


# ---------- rubric and debrief ----------

def test_facts_rubric_pending_communication_once_fixed():
    with Harness() as h:
        h.night_shift()
        assert h.facts()["rubric"] is None
        h.hand_over()
        h.set_pr()
        h.ok("deploy_fix", headers=MORNING)
        rubric = h.facts()["rubric"]
    assert rubric["final"] is False and rubric["rubric"]["communication"] == {"pending": True}
    assert {k: v["score"] for k, v in rubric["rubric"].items() if k != "communication"} == {
        "diagnosis": 4, "mitigation": 4, "validation": 4, "collaboration": 4,
    }


def test_debrief_without_pr_scores_16():
    with Harness() as h:
        h.night_shift()
        response = h.client.post("/api/debrief", json={"incident_id": INC, "answer": EXAMPLE_ANSWER}, headers=RELAY)
        assert response.status_code == 200, response.text
        body = response.json()
        assert h.facts()["rubric"]["final"] is True
    scores = {k: v["score"] for k, v in body["rubric"].items()}
    assert scores == {"diagnosis": 4, "mitigation": 4, "validation": 2, "communication": 4, "collaboration": 2}
    assert body["total"] == 16 and body["out_of"] == 20 and body["final"] is True
    assert body["answer"] == EXAMPLE_ANSWER
    assert body["rubric"]["communication"]["evidence"] == {"impact": True, "cause": True, "action": True, "risk": True}
    assert body["rubric"]["validation"]["evidence"] == "checked metrics: yes · CI: no PR yet"
    assert all(v["reason"].endswith(".") and len(v["reason"]) < 120 for v in body["rubric"].values())


def test_full_run_scores_20_and_phase_debriefed():
    with Harness() as h:
        h.night_shift()
        h.hand_over()
        h.set_pr()
        h.ok("deploy_fix", headers=MORNING)
        body = h.client.post("/api/debrief", json={"incident_id": INC, "answer": EXAMPLE_ANSWER}, headers=TEAM).json()
        assert body["total"] == 20
        assert h.state()["phase"] == "debriefed"


def test_off_script_actions_never_cost_points():
    with Harness() as h:
        h.ok("answer")
        h.ok("restart")
        h.ok("scale")
        for panel in ("dashboard", "logs", "deploys"):
            h.ok("open_panel", panel=panel)
        h.ok("rollback")
        h.clock.advance(SPEC.metrics.recovery_s)
        h.ok("open_panel", panel="dashboard")
        body = h.client.post("/api/debrief", json={"incident_id": INC, "answer": EXAMPLE_ANSWER}, headers=TEAM).json()
    mitigation = body["rubric"]["mitigation"]
    assert mitigation["score"] == 4 and "restart, scale" in mitigation["evidence"]


def test_debrief_input_is_validated():
    with Harness() as h:
        post = lambda body, headers=RELAY: h.client.post("/api/debrief", json=body, headers=headers)  # noqa: E731
        assert post({"incident_id": INC, "answer": "   "}).status_code == 422
        assert post({"incident_id": INC, "answer": "x" * 3001}).status_code == 422
        assert post({"incident_id": "nope", "answer": "hi"}).status_code == 404
        assert post({"incident_id": INC, "answer": "hi"}, headers={}).status_code == 401
        stuffed = {"incident_id": INC, "answer": "checkout customer tier rolled back risk"}
        response = post(stuffed)
        assert response.status_code == 409 and "stable" in response.json()["detail"]  # not before stabilized
        assert h.facts()["rubric"] is None


def test_debrief_can_be_resubmitted_once_stable():
    with Harness() as h:
        h.night_shift()
        first = h.client.post("/api/debrief", json={"incident_id": INC, "answer": "It broke."}, headers=RELAY)
        second = h.client.post("/api/debrief", json={"incident_id": INC, "answer": EXAMPLE_ANSWER}, headers=RELAY)
        assert first.status_code == second.status_code == 200
        assert second.json()["rubric"]["communication"]["score"] == 4


# ---------- shift handoff ----------

def _post_handoff(h: Harness, body: dict = HANDOFF, headers: dict = TEAM):
    return h.client.post(f"/api/incident/{INC}/handoff", json=body, headers=headers)


def _rate(h: Harness, score: int = 5, headers: dict = MORNING, note: str = ""):
    return h.client.post(f"/api/incident/{INC}/handoff/rating", json={"score": score, "note": note},
                         headers=headers)


def test_handoff_waits_until_checkout_is_stable():
    with Harness() as h:
        h.ok("answer")
        assert h.client.get(f"/api/incident/{INC}/handoff").status_code == 404
        response = _post_handoff(h)
        assert response.status_code == 409 and "stable" in response.json()["detail"]
        h.ok("rollback")
        assert _post_handoff(h).status_code == 409  # still recovering
        h.clock.advance(SPEC.metrics.recovery_s)
        assert _post_handoff(h).status_code == 200


def test_handoff_moves_to_morning_pair_and_reaches_dana():
    with Harness() as h:
        h.night_shift()
        state = _post_handoff(h).json()
        assert state["phase"] == "handed_off" and state["handoff"]["night_pair"] == ["duy"]
        h.clock.advance(SPEC.stakeholders.update_every_s * 2)
        facts = h.facts()
        assert facts["nudge"] is False  # the night shift is over
        assert facts["handoff"]["tried"] == HANDOFF["tried"] and facts["handoff"]["rating"] is None
        assert h.client.get(f"/api/incident/{INC}/handoff").json() == facts["handoff"]
        h.set_pr()
        assert h.ok("deploy_fix", headers=MORNING)["state"]["phase"] == "fixed"


def test_handoff_input_is_validated():
    with Harness() as h:
        h.night_shift()
        assert _post_handoff(h, {**HANDOFF, "risks": "   "}).status_code == 422
        assert _post_handoff(h, {k: v for k, v in HANDOFF.items() if k != "tried"}).status_code == 422
        assert _post_handoff(h, {**HANDOFF, "what_happened": "x" * 1001}).status_code == 422
        assert _post_handoff(h, headers=RELAY).status_code == 403
        assert _post_handoff(h, headers={}).status_code == 401


def test_only_the_morning_pair_rates_and_rating_locks_the_note():
    with Harness() as h:
        h.night_shift()
        assert _rate(h).status_code == 409  # nothing to rate yet
        _post_handoff(h)
        assert _post_handoff(h, {**HANDOFF, "risks": "Edited by a stranger"}, headers=OTHER).status_code == 409
        assert _post_handoff(h, {**HANDOFF, "risks": "Watch the error rate."}).status_code == 200  # night pair edits
        own = _rate(h, headers=TEAM)
        assert own.status_code == 409 and "morning pair" in own.json()["detail"]
        assert _rate(h, score=6).status_code == 422 and _rate(h, score=0).status_code == 422
        assert _rate(h, note="two\nlines").status_code == 422
        rated = _rate(h, score=3, note="Which tests cover guests?").json()
        assert rated["rating"]["by"] == "tung" and rated["rating"]["score"] == 3
        assert rated["rating"]["note"] == "Which tests cover guests?"
        assert rated["risks"] == "Watch the error rate."
        assert _post_handoff(h).status_code == 409  # rated -> locked


def test_only_someone_who_worked_the_incident_writes_the_first_note():
    with Harness() as h:
        h.night_shift()
        response = _post_handoff(h, headers=MORNING)  # tung never acted
        assert response.status_code == 409 and "night pair" in response.json()["detail"]
        assert h.state()["handoff"] is None
        _post_handoff(h)
        _post_handoff(h, {**HANDOFF, "risks": "Watch errors."})  # an edit
        assert h.state()["actions_taken"].count("handoff") == 1


def test_handoff_can_still_be_written_if_the_fix_shipped_first():
    with Harness() as h:
        h.night_shift()
        h.set_pr()
        h.ok("deploy_fix")
        state = _post_handoff(h).json()
        assert state["phase"] == "fixed" and state["handoff"]["night_pair"] == ["duy"]  # no phase regression
        assert _rate(h).status_code == 200


def test_collaboration_needs_a_handoff_rated_clear():
    with Harness() as h:
        h.night_shift()
        h.hand_over(score=3)
        h.set_pr()
        h.ok("deploy_fix", headers=MORNING)
        body = h.client.post("/api/debrief", json={"incident_id": INC, "answer": "Fixed."}, headers=RELAY).json()
    collaboration = body["rubric"]["collaboration"]
    assert collaboration["score"] == 2 and "handoff: rated 3/5" in collaboration["evidence"]
    assert "still to do: a handoff the morning pair rates 4 or 5" in collaboration["reason"]
    # The four-part handoff alone covers communication, even with a one-word debrief.
    assert body["rubric"]["communication"]["score"] == 4


# ---------- cohorts ----------

def _create_cohort(h: Harness, name: str = "Night Owls (example)", headers: dict = TEAM):
    return h.client.post("/api/cohorts", json={"name": name}, headers=headers)


def test_create_and_join_a_cohort():
    with Harness() as h:
        created = _create_cohort(h)
        assert created.status_code == 201, created.text
        cohort = created.json()
        code = cohort["join_code"]
        assert len(code) == 6 and not set(code) & set("0O1IL")
        assert cohort["members"] == [{"handle": "duy"}] and cohort["created_by"] == "duy"
        typed = f" {code[:3].lower()} {code[3:].lower()} "  # people type codes loosely
        joined = h.client.post("/api/cohorts/join", json={"join_code": typed}, headers=MORNING)
        assert joined.status_code == 200, joined.text
        again = h.client.post("/api/cohorts/join", json={"join_code": code}, headers=MORNING).json()
        assert [m["handle"] for m in again["members"]] == ["duy", "tung"]
        listed = h.client.get(f"/api/cohorts/{cohort['id']}", headers=MORNING).json()
        assert listed["members"] == again["members"]


def test_cohorts_are_members_only():
    with Harness() as h:
        cohort = _create_cohort(h).json()
        assert h.client.get(f"/api/cohorts/{cohort['id']}", headers=OTHER).status_code == 404
        assert h.client.get(f"/api/cohorts/{cohort['id']}").status_code == 401
        assert h.client.get("/api/cohorts/coh_nope", headers=TEAM).status_code == 404
        assert h.client.post("/api/cohorts/join", json={"join_code": "ZZZZZZ"}, headers=OTHER).status_code == 404
        assert h.client.post("/api/cohorts/join", json={"join_code": "AB CDE"}, headers=OTHER).status_code == 422
        assert _create_cohort(h, headers=RELAY).status_code == 403
        assert _create_cohort(h, name="   ").status_code == 422
        assert _create_cohort(h, name="x" * 61).status_code == 422


def test_cohorts_work_even_without_a_scenario():
    with Harness(scenario_path=API_DIR / "tests" / "no-such-scenario.json") as h:
        assert _create_cohort(h).status_code == 201


# ---------- panels ----------

def _logs(h: Harness, **params):
    return h.client.get(f"/api/incident/{INC}/logs", params=params).json()["lines"]


def test_logs_show_guest_failures_until_the_rollback():
    with Harness() as h:
        h.ok("answer")
        h.clock.advance(60)
        lines = _logs(h)
        assert len(lines) == 200 and lines == _logs(h)  # deterministic
        errors = [line for line in lines if line["level"] == "ERROR"]
        assert errors and all("KeyError: 'tier'" in e["message"] and "guest=true" in e["message"] for e in errors)
        assert 0.15 < len(errors) / len([x for x in lines if x["service"] == "checkout"]) < 0.5
        assert any(line["service"] == "search-service" for line in lines)  # the red herring
        assert all(line["level"] == "ERROR" for line in _logs(h, level="ERROR", limit=20))
        assert all("tier=gold" in line["message"] for line in _logs(h, q="tier=gold", limit=10))
        h.ok("rollback")
        h.clock.advance(60)
        newest = _logs(h, limit=40)
        assert newest and not any(line["level"] == "ERROR" for line in newest)
        assert h.client.get(f"/api/incident/{INC}/logs", params={"limit": 201}).status_code == 422


def test_deploys_show_the_diff_and_the_live_version():
    with Harness() as h:
        deploys = h.client.get(f"/api/incident/{INC}/deploys").json()
        assert deploys["live_version"] == SPEC.releases.bad
        bad = next(r for r in deploys["releases"] if r["version"] == SPEC.releases.bad)
        assert bad["live"] and bad["diff_source"] == "scenario" and bad["at"] == SPEC.releases.bad_at
        assert 'customer.profile["tier"]' in bad["files"][0]["patch"]
        h.ok("answer")
        h.ok("rollback")
        assert h.client.get(f"/api/incident/{INC}/deploys").json()["live_version"] == SPEC.releases.good
        h.set_pr()
        h.ok("deploy_fix")
        assert h.client.get(f"/api/incident/{INC}/deploys").json()["live_version"] == SPEC.fix_version


def test_runbooks():
    with Harness() as h:
        index = h.client.get(f"/api/incident/{INC}/runbooks").json()["runbooks"]
        assert index and index[0]["name"] in SPEC.runbooks
        book = h.client.get(f"/api/incident/{INC}/runbooks/{index[0]['name']}").json()
        assert book["steps"] == list(SPEC.runbooks[index[0]["name"]].steps)
        assert h.client.get(f"/api/incident/{INC}/runbooks/nope").status_code == 404


def test_metrics_history_reaches_back_to_the_bad_release_and_shows_recovery():
    with Harness() as h:
        h.ok("answer")
        h.clock.advance(120)
        h.ok("rollback")
        h.clock.advance(60)
        history = h.client.get(f"/api/incident/{INC}/metrics/history",
                               params={"window_s": 1800, "step_s": 10}).json()
    samples = history["samples"]
    assert samples[0]["error_rate"] == SPEC.metrics.baseline.error_rate  # before 01:47
    assert max(s["error_rate"] for s in samples) >= SPEC.metrics.at_page.error_rate
    assert samples[-1]["error_rate"] == SPEC.metrics.baseline.error_rate  # recovered
    labels = [e["label"] for e in history["events"]]
    assert labels == [f"bad release {SPEC.releases.bad}", "paged", "rollback"]
    assert history["events"][0]["sim_time"] == f"{SPEC.releases.bad_at}:00"


# ---------- GitHub: PR verify and real diffs ----------

def _verify(h: Harness, url: str = PR_URL, headers: dict = MORNING):
    return h.client.post("/api/pr/verify", json={"incident_id": INC, "pr_url": url}, headers=headers)


def test_verified_pr_unlocks_deploy_fix_and_scores():
    with Harness(github=FakeGitHub()) as h:
        h.night_shift()
        h.hand_over()
        response = _verify(h)
        assert response.status_code == 200, response.text
        pr = response.json()["pr"]
        assert pr["merged"] and pr["ci"] == "success" and pr["ci_passed"] is True
        assert pr["substantive_review"] is True and pr["mentor_review"] == "mentor-ana"
        assert pr["review_count"] == 2 and "author" not in pr and "reviewers" not in pr
        assert "tung-gh" not in response.text and "duy-gh" not in response.text  # only the mentor is named
        assert "deploy_fix" in response.json()["allowed_actions"]
        h.ok("deploy_fix", headers=MORNING)
        body = h.client.post("/api/debrief", json={"incident_id": INC, "answer": EXAMPLE_ANSWER}, headers=RELAY).json()
        assert body["total"] == 20
        assert h.client.get("/health").json()["pilot_repo"] == PILOT


def test_pr_not_ready_until_merged_and_green():
    cases = (({"merged": False}, True), ({"ci": "failure"}, False), ({"ci": "pending"}, None), ({"ci": None}, None))
    for kwargs, ci_passed in cases:
        with Harness(github=FakeGitHub(**kwargs)) as h:
            h.ok("answer")
            pr = _verify(h).json()["pr"]
            assert pr["ci_passed"] is ci_passed, kwargs
            assert h.act("deploy_fix").json()["code"] == "pr_not_ready"


def test_only_real_reviews_by_someone_else_count():
    short = [{"user": {"login": "tung-gh"}, "state": "APPROVED", "body": "LGTM"},
             {"user": {"login": "duy-gh"}, "state": "COMMENTED", "body": "x" * 100}]  # self-review
    with Harness(github=FakeGitHub(reviews=short)) as h:
        assert _verify(h).json()["pr"]["substantive_review"] is False
    inline = [{"user": {"login": "tung-gh"}, "body": "This line still reads the profile tier"}]
    with Harness(github=FakeGitHub(reviews=short, comments=inline)) as h:
        assert _verify(h).json()["pr"]["substantive_review"] is True


def test_pr_verify_refuses_other_repos_and_handles_github_down():
    with Harness(github=FakeGitHub()) as h:
        assert _verify(h, "https://github.com/someone/else/pull/1").json()["code"] == "repo_not_allowed"
        assert _verify(h, "not a url").json()["code"] == "bad_pr_url"
        assert _verify(h, headers=RELAY).status_code == 403
        incident_id = _start(h, []).json()["incident_id"]
        outsider = h.client.post("/api/pr/verify", json={"incident_id": incident_id, "pr_url": PR_URL},
                                 headers=MORNING)
        assert outsider.json()["code"] == "not_teammate"
    with Harness(github=FakeGitHub(down=True)) as h:
        response = _verify(h)
        assert response.status_code == 502 and response.json()["code"] == "github_unavailable"
    with Harness() as h:  # PILOT_REPOS empty
        assert _verify(h).json()["code"] == "github_off"


def test_only_a_fix_for_this_incident_unlocks_deploy():
    cases = (({"base": "release"}, "pr_wrong_base"), ({"files": ("README.md", "docs/howto.md")}, "pr_not_a_fix"),
             ({"created": "1970-01-01T00:00:00Z"}, "pr_too_old"))  # opened before this incident's page
    for kwargs, code in cases:
        with Harness(github=FakeGitHub(**kwargs)) as h:
            h.ok("answer")
            response = _verify(h)
            assert response.status_code == 422 and response.json()["code"] == code, kwargs
            assert h.state()["pr"] is None


def test_a_merged_fix_cannot_be_swapped_for_another_pr():
    with Harness(github=FakeGitHub()) as h:
        h.ok("answer")
        _verify(h)
        h.app.state.runtime.store.change(INC, lambda s, now: (replace(s, pr=replace(s.pr, number=99)), None))
        response = _verify(h)
        assert response.status_code == 409 and response.json()["code"] == "pr_already_linked"


def test_github_reads_are_cached():
    github = FakeGitHub()
    with Harness(github=github) as h:
        _verify(h)
        calls = github.calls
        _verify(h)
        assert github.calls == calls


def _bad_release(h: Harness) -> dict:
    releases = h.client.get(f"/api/incident/{INC}/deploys").json()["releases"]
    return next(r for r in releases if r["version"] == SPEC.releases.bad)


def test_deploys_use_the_real_diff_from_github_with_offline_fallback():
    with Harness(github=FakeGitHub()) as h:
        bad = _bad_release(h)
        assert bad["diff_source"] == "github" and bad["files"][0]["patch"] == "@@ real @@"
    with Harness(github=FakeGitHub(down=True)) as h:
        bad = _bad_release(h)
        assert bad["diff_source"] == "scenario" and 'profile["tier"]' in bad["files"][0]["patch"]


# ---------- profile, connections, network, evidence ----------

def _two_shifts(h: Harness) -> None:
    """duy works the night; tung, named as the morning pair, takes part by rating the handoff."""
    h.night_shift()
    _post_handoff(h, {**HANDOFF, "morning_pair": ["tung"]})
    _rate(h)


def _connect(h: Harness, headers: dict, to_user: str, yes: bool = True):
    return h.client.post("/api/connections", headers=headers,
                         json={"incident_id": INC, "to_user": to_user, "work_again": yes})


def test_profile_get_and_patch():
    with Harness() as h:
        assert h.client.get("/api/me", headers=TEAM).json() == {
            "handle": "duy", "github_login": None, "contact": None, "public_evidence": False}
        me = h.client.patch("/api/me", json={"github_login": "Mentor-Ana", "contact": " duy@example.com "},
                            headers=TEAM).json()
        assert me["github_login"] == "mentor-ana" and me["contact"] == "duy@example.com"
        assert "is_mentor" not in me  # an unverified login must not make anyone look like a mentor
        assert h.client.patch("/api/me", json={"contact": None}, headers=TEAM).json()["github_login"] == "mentor-ana"
        assert h.client.get("/api/me", headers=TEAM).json()["contact"] is None
        assert h.client.patch("/api/me", json={"github_login": "bad login!"}, headers=TEAM).status_code == 422
        assert h.client.get("/api/me", headers=RELAY).status_code == 403


def test_contact_shows_only_after_a_mutual_yes():
    with Harness() as h:
        _two_shifts(h)
        h.client.patch("/api/me", json={"contact": "tung@example.com"}, headers=MORNING)
        assert h.client.get("/api/connections/pending", headers=TEAM).json()["pending"] == [
            {"incident_id": INC, "handle": "tung"}]
        answer = _connect(h, TEAM, "tung").json()
        assert answer == {"ok": True, "incident_id": INC, "to_user": "tung", "work_again": True}
        assert h.client.get("/api/network", headers=TEAM).json()["cards"] == []      # one-sided: nothing
        assert h.client.get("/api/network", headers=MORNING).json()["cards"] == []   # and tung can't tell
        assert h.client.get("/api/connections/pending", headers=TEAM).json()["pending"] == []
        _connect(h, MORNING, "duy")
        card = h.client.get("/api/network", headers=TEAM).json()["cards"][0]
        assert card["handle"] == "tung" and card["contact"] == "tung@example.com" and card["incident_id"] == INC
        _connect(h, MORNING, "duy", yes=False)  # changed their mind
        assert h.client.get("/api/network", headers=TEAM).json()["cards"] == []


def test_only_people_who_worked_together_can_answer():
    with Harness() as h:
        _two_shifts(h)
        assert _connect(h, OTHER, "duy").json()["code"] == "not_participant"   # demo-a never worked it
        assert _connect(h, TEAM, "demo-a").json()["code"] == "not_a_teammate"
        assert _connect(h, TEAM, "duy").json()["code"] == "not_a_teammate"     # yourself
        assert _connect(h, RELAY, "duy").status_code == 403


def test_being_named_is_not_taking_part():
    """Naming someone as the morning pair doesn't drag them into connections or evidence."""
    with Harness() as h:
        h.night_shift()
        _post_handoff(h, {**HANDOFF, "morning_pair": ["tung"]})
        assert _connect(h, TEAM, "tung").json()["code"] == "not_a_teammate"
        assert h.client.get("/api/me/evidence", headers=MORNING).status_code == 404
        _rate(h)  # tung takes part
        assert _connect(h, TEAM, "tung").status_code == 200


def test_evidence_is_public_but_never_shows_contact_details():
    with Harness(github=FakeGitHub()) as h:
        _two_shifts(h)
        h.client.patch("/api/me", json={"contact": "duy@example.com", "github_login": "duy-gh"}, headers=TEAM)
        _verify(h)
        h.ok("deploy_fix", headers=MORNING)
        h.client.post("/api/debrief", json={"incident_id": INC, "answer": EXAMPLE_ANSWER}, headers=RELAY)
        assert h.client.get("/api/evidence/duy").status_code == 404  # private until opted in
        assert h.client.get("/api/me/evidence", headers=TEAM).status_code == 200  # but visible to yourself
        h.client.patch("/api/me", json={"public_evidence": True}, headers=TEAM)
        response = h.client.get("/api/evidence/duy")
        assert response.status_code == 200
        record = response.json()["incidents"][0]
        assert record["role"] == "night" and record["findings_shared"] == 1 and record["handoff_rating"] == 5
        assert record["pr"]["ci"] == "success" and record["pr"]["mentor_reviewed"] is True
        assert record["rubric"]["total"] == 20
        assert "duy@example.com" not in response.text and "duy-gh" not in response.text
        assert h.client.get("/api/me/evidence", headers=MORNING).json()["incidents"][0]["role"] == "morning"
        assert h.client.get("/api/evidence/nobody").status_code == 404


def test_profiles_and_answers_survive_a_restart():
    path, clock = _db_path(), FakeClock()
    try:
        with Harness(sqlite_path=path, clock=clock) as h:
            _two_shifts(h)
            h.client.patch("/api/me", json={"contact": "tung@example.com"}, headers=MORNING)
            _connect(h, TEAM, "tung")
            _connect(h, MORNING, "duy")
        with Harness(sqlite_path=path, clock=clock) as h:
            assert h.client.get("/api/network", headers=TEAM).json()["cards"][0]["contact"] == "tung@example.com"
    finally:
        Path(path).unlink(missing_ok=True)


# ---------- jobs snapshot and before/after check ----------

def _fake_adzuna(request: httpx.Request) -> httpx.Response:
    if request.url.params.get("app_key") != "k":
        return httpx.Response(401, json={"error": "bad key"})
    return httpx.Response(200, json={"count": 42, "results": [{
        "title": f"Junior {request.url.params['what']}", "company": {"display_name": "Example Employer"},
        "location": {"display_name": "Calgary, Alberta"}, "created": "2026-11-01T10:00:00Z",
        "redirect_url": "https://www.adzuna.ca/details/1", "salary_min": 60000, "salary_max": 75000}]})


def test_jobs_come_from_a_saved_snapshot_never_invented():
    with Harness() as h:
        empty = h.client.get("/api/jobs").json()
        assert empty["searches"] == [] and empty["fetched_at"] is None and "adzuna.py" in empty["message"]
    snapshot = adzuna.fetch_snapshot("id", "k", SPEC.job_searches, transport=httpx.MockTransport(_fake_adzuna),
                                     now=datetime(2026, 11, 7, 20, 0, tzinfo=timezone.utc))
    assert snapshot["fetched_at"] == "2026-11-07T20:00:00+00:00" and snapshot["source"] == "Adzuna"
    assert [s["what"] for s in snapshot["searches"]] == list(SPEC.job_searches)
    path = Path(_db_path()).with_suffix(".json")
    try:
        adzuna.save_snapshot(snapshot, path)
        with Harness(jobs_path=path) as h:
            jobs = h.client.get("/api/jobs").json()
        assert jobs["fetched_at"] == snapshot["fetched_at"]
        assert jobs["searches"][0]["listings"][0]["company"] == "Example Employer"
    finally:
        path.unlink(missing_ok=True)
    for app_id, key in (("id", "wrong"), ("", "")):
        try:
            adzuna.fetch_snapshot(app_id, key, ("x",), transport=httpx.MockTransport(_fake_adzuna))
        except adzuna.AdzunaError:
            pass
        else:
            raise AssertionError("expected AdzunaError")


def _check(h: Harness, stage: str, choice: str, headers: dict = TEAM):
    return h.client.post("/api/checks", headers=headers,
                         json={"incident_id": INC, "stage": stage, "choice": choice, "explanation": "Because."})


def test_before_after_check_shows_scores_only_at_the_end():
    with Harness() as h:
        before = _check(h, "before", "c").json()
        assert before["before"] == {"choice": "c", "explanation": "Because."} and before["improved"] is None
        assert "score" not in json.dumps(before) and "check_scores" not in json.dumps(before)
        assert _check(h, "after", "a").json()["code"] == "check_not_ready"  # checkout still broken
        h.night_shift()
        done = _check(h, "after", "a").json()
        assert done["before"]["score"] == 0 and done["after"]["score"] == 4 and done["improved"] == 4
        assert _check(h, "before", "a").json()["code"] == "check_closed"
        assert h.client.get("/api/checks", params={"incident_id": INC}, headers=TEAM).json()["improved"] == 4
        assert _check(h, "before", "z", headers=MORNING).json()["code"] == "unknown_choice"
        incident_id = _start(h, []).json()["incident_id"]
        outsider = h.client.post("/api/checks", headers=MORNING,
                                 json={"incident_id": incident_id, "stage": "before", "choice": "a"})
        assert outsider.json()["code"] == "not_teammate"


# ---------- Auth0 sign-in ----------

def test_auth0_users_claim_a_handle_then_work_normally():
    tenant = FakeAuth0()
    maya, sam = tenant.token("google-oauth2|111"), tenant.token("github|222")
    with Harness(auth0=tenant) as h:
        assert h.client.get("/api/me", headers=maya).json()["code"] == "handle_required"
        claimed = h.client.post("/api/me/handle", json={"handle": "Maya-Demo"}, headers=maya)
        assert claimed.status_code == 200 and claimed.json()["handle"] == "maya-demo"
        assert h.client.get("/api/me", headers=maya).json()["handle"] == "maya-demo"
        assert h.client.post("/api/me/handle", json={"handle": "maya-demo"}, headers=sam).json()["code"] == "handle_taken"
        assert h.client.post("/api/me/handle", json={"handle": "x"}, headers=maya).json()["code"] == "handle_already_set"
        assert h.client.post("/api/me/handle", json={"handle": "Real Name"}, headers=sam).json()["code"] == "bad_handle"
        assert h.client.post("/api/me/handle", json={"handle": "dana-relay"}, headers=sam).json()["code"] == "bad_handle"
        assert h.client.post("/api/me/handle", json={"handle": "sam"}, headers=RELAY).json()["code"] == "not_signed_in"
        start = lambda team: h.client.post("/api/incident/start", json={"teammates": team}, headers=maya)  # noqa: E731
        assert start(["sam"]).json()["code"] == "unknown_handle"   # sam hasn't claimed a handle yet
        h.client.post("/api/me/handle", json={"handle": "sam"}, headers=sam)
        incident = start(["sam"]).json()
        assert incident["teammates"] == ["maya-demo", "sam"]
        assert "google-oauth2" not in json.dumps(incident)  # the Auth0 subject is never shown
        answer = {"action": "answer", "idempotency_key": "a1"}
        assert h.client.post(f"/api/incident/{incident['incident_id']}/action", json=answer,
                             headers=sam).status_code == 200


def test_auth0_rejects_bad_tokens_and_the_demo_header():
    from cryptography.hazmat.primitives.asymmetric import rsa

    tenant = FakeAuth0()
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    bad = [tenant.token("u", expires_in=-60), tenant.token("u", audience="https://other.example"),
           tenant.token("u", issuer="https://evil.example/"), tenant.token("u", key=other_key),
           {"Authorization": "Bearer not-a-jwt"}, {"Authorization": "Basic abc"}, {}, TEAM]
    with Harness(auth0=tenant) as h:
        for headers in bad:
            assert h.client.get("/api/me", headers=headers).status_code == 401, headers
        good = tenant.token("u")
        h.client.get("/api/me", headers=good)
        h.client.get("/api/me", headers=good)
        assert tenant.jwks_fetches == 1  # signing keys are cached


def test_unknown_key_ids_cannot_hammer_auth0():
    tenant = FakeAuth0()
    with Harness(auth0=tenant) as h:
        h.client.get("/api/me", headers=tenant.token("u"))
        forged = jwt.encode({"sub": "u", "aud": AUTH0_AUDIENCE, "iss": f"https://{AUTH0_DOMAIN}/",
                             "iat": int(time.time()), "exp": int(time.time()) + 60},
                            tenant.key, algorithm="RS256", headers={"kid": "unknown-kid"})
        for _ in range(5):
            assert h.client.get("/api/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
        assert tenant.jwks_fetches == 1  # unknown kids don't trigger refetches within 30 s


def test_auth0_handles_survive_a_restart():
    tenant, path = FakeAuth0(), _db_path()
    try:
        with Harness(auth0=tenant, sqlite_path=path) as h:
            h.client.post("/api/me/handle", json={"handle": "maya-demo"}, headers=tenant.token("google-oauth2|1"))
        with Harness(auth0=tenant, sqlite_path=path) as h:
            assert h.client.get("/api/me", headers=tenant.token("google-oauth2|1")).json()["handle"] == "maya-demo"
    finally:
        Path(path).unlink(missing_ok=True)


# ---------- Tiger Data: metrics hypertable (offline: a fake database) ----------

class FakeMetricsDB:
    def __init__(self):
        self.rows = []

    def record_metrics(self, rows):
        self.rows.extend(rows)


def test_history_uses_tigerdata_buckets_where_recorded():
    with Harness() as h:
        h.ok("answer")
        h.clock.advance(60)
        state, now = h.app.state.runtime.store.get(INC)
        step = 10
        recorded = int(now // step) * step  # the bucket holding "now"
        stored = {recorded: {"error_rate": 12.34, "orders_per_min": 333.4, "p95_ms": 999.6}}
        history = panels.metrics_history(state, SCENARIO, now, window_s=120, step_s=step, stored=stored)
    assert history["source"] == "tigerdata"
    last = history["samples"][-1]
    assert last["source"] == "tigerdata" and last["error_rate"] == 12.3 and last["p95_ms"] == 1000
    assert all(s["source"] == "computed" for s in history["samples"][:-2])  # gaps fall back to the curve
    plain = panels.metrics_history(state, SCENARIO, now, window_s=120, step_s=step)
    assert plain["source"] == "computed"


def test_recorder_writes_one_sample_per_second_off_the_request_path():
    db = FakeMetricsDB()
    recorder = MetricsRecorder(db)
    try:
        metrics = {"error_rate": 27.1, "orders_per_min": 307, "p95_ms": 1291}
        for now in (1000.1, 1000.5, 1000.9, 1001.2, 1001.3):  # two distinct seconds
            recorder.sample(INC, now, metrics)
        recorder.flush()
    finally:
        recorder.close()
    assert [row[1] for row in db.rows] == [1000.0, 1001.0] and recorder.written == 2


# ---------- starting incidents and teammates ----------

def _start(h: Harness, teammates: list[str], headers: dict = TEAM, level: str = "practice"):
    return h.client.post("/api/incident/start", json={"level": level, "teammates": teammates}, headers=headers)


def _act_on(h: Harness, incident_id: str, action: str, headers: dict = TEAM, **body):
    payload = {"action": action, "idempotency_key": f"k{next(Harness._keys)}", **body}
    return h.client.post(f"/api/incident/{incident_id}/action", json=payload, headers=headers)


def test_start_an_incident_with_teammates():
    with Harness() as h:
        response = _start(h, [" Luan "])
        assert response.status_code == 201, response.text
        state = response.json()
        assert state["incident_id"].startswith("inc_") and state["incident_id"] != INC
        assert state["teammates"] == ["duy", "luan"] and state["phase"] == "paged" and state["level"] == "practice"
        assert _start(h, ["stranger"]).json()["code"] == "unknown_handle"
        assert _start(h, [], headers=RELAY).status_code == 403
        assert _start(h, [], headers={}).status_code == 401
        assert _start(h, ["tung", "luan", "demo-a", "demo-b"]).status_code == 422  # more than 3 others


def test_only_teammates_act_but_anyone_can_read():
    with Harness() as h:
        incident_id = _start(h, ["luan"]).json()["incident_id"]
        outsider = _act_on(h, incident_id, "answer", headers=MORNING)
        assert outsider.status_code == 403 and outsider.json()["code"] == "not_teammate"
        assert h.client.post(f"/api/incident/{incident_id}/hint", headers=MORNING).status_code == 403
        assert h.client.post(f"/api/incident/{incident_id}/hint", headers=RELAY).status_code == 200
        assert _act_on(h, incident_id, "answer", headers={"X-Demo-User": "luan"}).status_code == 200
        assert h.client.get(f"/api/incident/{incident_id}/facts").status_code == 200


def test_morning_pair_joins_at_handoff():
    with Harness() as h:
        incident_id = _start(h, []).json()["incident_id"]
        for action, extra in (("answer", {}), ("open_panel", {"panel": "logs"}), ("rollback", {})):
            assert _act_on(h, incident_id, action, **extra).status_code == 200
        h.clock.advance(SPEC.metrics.recovery_s)
        rate = lambda headers: h.client.post(  # noqa: E731
            f"/api/incident/{incident_id}/handoff/rating", json={"score": 5}, headers=headers)
        assert _act_on(h, incident_id, "open_panel", headers=MORNING, panel="logs").status_code == 403
        note = {**HANDOFF, "morning_pair": ["tung", "Demo-A"]}
        state = h.client.post(f"/api/incident/{incident_id}/handoff", json=note, headers=TEAM).json()
        assert state["teammates"] == ["duy", "tung", "demo-a"] and state["handoff"]["night_pair"] == ["duy"]
        assert rate({"X-Demo-User": "luan"}).json()["code"] == "not_teammate"
        assert rate(MORNING).status_code == 200
        h.set_pr(incident_id)
        assert _act_on(h, incident_id, "deploy_fix", headers=MORNING).status_code == 200
        bad = {**HANDOFF, "morning_pair": ["nobody"]}
        assert h.client.post(f"/api/incident/{incident_id}/handoff", json=bad, headers=TEAM).status_code == 422


def test_only_the_named_morning_pair_rates():
    with Harness() as h:
        h.night_shift()
        _post_handoff(h, {**HANDOFF, "morning_pair": ["tung"]})
        other = _rate(h, headers=OTHER)  # demo-a: a teammate on inc_demo, but not the morning pair
        assert other.status_code == 409 and other.json()["code"] == "not_morning_pair"
        assert _rate(h).status_code == 200


def test_editing_the_handoff_replaces_the_morning_pair():
    with Harness() as h:
        incident_id = _start(h, []).json()["incident_id"]
        for action in ("answer", "rollback"):
            _act_on(h, incident_id, action)
        h.clock.advance(SPEC.metrics.recovery_s)
        post = lambda pair: h.client.post(  # noqa: E731
            f"/api/incident/{incident_id}/handoff", json={**HANDOFF, "morning_pair": pair}, headers=TEAM)
        assert post(["tung"]).json()["teammates"] == ["duy", "tung"]
        state = post(["demo-a"]).json()
        assert state["teammates"] == ["duy", "demo-a"] and state["handoff"]["morning_pair"] == ["demo-a"]
        assert _act_on(h, incident_id, "open_panel", headers=MORNING, panel="logs").json()["code"] == "not_teammate"
        assert post(["<b>tung</b>"]).json()["code"] == "unknown_handle"


def test_outsiders_learn_nothing_about_handles_from_the_handoff():
    with Harness() as h:
        incident_id = _start(h, []).json()["incident_id"]
        response = h.client.post(f"/api/incident/{incident_id}/handoff",
                                 json={**HANDOFF, "morning_pair": ["nobody"]}, headers=MORNING)
        assert response.status_code == 403 and response.json()["code"] == "not_teammate"


# ---------- persistence ----------

def _db_path() -> str:
    handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    handle.close()
    return handle.name


def test_everything_survives_a_restart():
    path, clock = _db_path(), FakeClock()
    try:
        with Harness(sqlite_path=path, clock=clock) as h:
            h.night_shift()
            h.hand_over()
            started = _start(h, ["luan"]).json()["incident_id"]
            cohort = _create_cohort(h).json()
            h.client.post("/api/cohorts/join", json={"join_code": cohort["join_code"]}, headers=MORNING)
            before = h.state()
        with Harness(sqlite_path=path, clock=clock) as h:  # same database, new process
            after = h.state()
            assert after == before  # inc_demo was loaded, not recreated
            assert h.client.get(f"/api/incident/{started}").json()["teammates"] == ["duy", "luan"]
            members = h.client.get(f"/api/cohorts/{cohort['id']}", headers=MORNING).json()["members"]
            assert members == [{"handle": "duy"}, {"handle": "tung"}]
            joined = h.client.post("/api/cohorts/join", json={"join_code": cohort["join_code"]}, headers=OTHER)
            assert joined.status_code == 200
            assert h.client.get("/health").json()["database"] == {"kind": "sqlite", "persistent": True,
                                                                  "save_failures": 0}
    finally:
        Path(path).unlink(missing_ok=True)


def test_snapshot_round_trip_keeps_every_field():
    with Harness() as h:
        h.night_shift()
        h.hand_over()
        h.set_pr()
        h.ok("deploy_fix", headers=MORNING)
        h.client.post("/api/debrief", json={"incident_id": INC, "answer": EXAMPLE_ANSWER}, headers=RELAY)
        state, _ = h.app.state.runtime.store.get(INC)
    assert from_snapshot(json.loads(json.dumps(to_snapshot(state)))) == state


def test_a_bad_saved_incident_is_skipped_not_fatal():
    path = _db_path()
    try:
        with Harness(sqlite_path=path):
            pass
        with closing(sqlite3.connect(path)) as conn, conn:
            conn.execute("INSERT INTO incidents VALUES ('inc_bad', 'explore', '[]', '{\"v\": 99}', 0)")
            conn.execute("INSERT INTO incidents VALUES ('inc_junk', 'explore', '[]', 'not json', 0)")
        with Harness(sqlite_path=path) as h:
            assert h.client.get("/health").status_code == 200
            assert h.client.get("/api/incident/inc_bad").status_code == 404
            assert h.state()["phase"] == "paged"
    finally:
        Path(path).unlink(missing_ok=True)


def test_unopenable_database_runs_from_memory():
    folder = tempfile.mkdtemp()  # a directory can't be opened as a database file
    try:
        with Harness(sqlite_path=folder) as h:
            health = h.client.get("/health").json()
            assert health["status"] == "ok" and health["database"]["persistent"] is False
            h.ok("answer")
    finally:
        Path(folder).rmdir()


def test_restart_refreshes_demo_teammates_but_keeps_progress():
    path, clock = _db_path(), FakeClock()
    try:
        with Harness(sqlite_path=path, clock=clock) as h:
            h.ok("answer")
        with Harness(sqlite_path=path, clock=clock, demo_team=("duy", "maya-demo")) as h:
            state = h.state()
            assert state["teammates"] == ["duy", "maya-demo"] and state["actions_taken"] == ["answer"]
    finally:
        Path(path).unlink(missing_ok=True)


def test_database_url_choices_fall_back_to_sqlite():
    path = _db_path()
    try:
        with Harness(database_url=f"sqlite:///{path}") as h:
            _create_cohort(h)
        with closing(sqlite3.connect(path)) as conn, conn:
            assert conn.execute("SELECT COUNT(*) FROM cohorts").fetchone()[0] == 1
        with Harness(database_url="postgres://user:pw@tiger.example/db") as h:  # not supported yet
            assert h.client.get("/health").json()["database"]["kind"] == "sqlite"
    finally:
        Path(path).unlink(missing_ok=True)


def test_a_comment_in_env_is_not_a_value():
    """`NAME=   # note` must not turn on Auth0 or point paths at the note."""
    names = ("AUTH0_DOMAIN", "SCENARIO_PATH", "CORS_ORIGINS")
    saved = {n: os.environ.get(n) for n in names}
    try:
        for name in names:
            os.environ[name] = "# empty = something"
        settings = Settings.from_env()
        assert settings.demo_mode and settings.scenario_path == DEFAULT_SCENARIO_PATH and settings.cors_origins == ()
    finally:
        for name, value in saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


# ---------- demo reset and voice mount ----------

def test_demo_reset_restarts_from_the_page():
    with Harness() as h:
        h.night_shift()
        h.hint()
        state = h.client.post("/api/demo/reset", json={"level": "challenge"}, headers=TEAM).json()
        assert state["phase"] == "paged" and state["level"] == "challenge" and state["actions_taken"] == []
        assert h.facts()["hint_calls"] == 0
        assert h.client.post("/api/demo/reset", json={"level": "expert"}, headers=TEAM).status_code == 422


def _preflight(h: Harness, origin: str):
    return h.client.options(f"/api/incident/{INC}/action", headers={
        "Origin": origin, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-demo-user",
    })


def test_cors_lets_the_web_app_call_the_api():
    with Harness() as h:  # CORS_ORIGINS empty: dev mode, any origin
        assert _preflight(h, "http://localhost:3000").headers.get("access-control-allow-origin") == "*"
    clock = FakeClock()
    settings = Settings(internal_key=INTERNAL_KEY, cors_origins=("https://incidentlab.example",))
    with TestClient(create_app(settings, clock=clock)) as client:
        h = type("H", (), {"client": client})()
        allowed = _preflight(h, "https://incidentlab.example")
        assert allowed.status_code == 200
        assert allowed.headers.get("access-control-allow-origin") == "https://incidentlab.example"
        assert "access-control-allow-origin" not in _preflight(h, "https://evil.example").headers


def test_voice_socket_is_mounted_on_the_same_app():
    with Harness() as h:
        with h.client.websocket_connect("/ws/voice?call=nope") as ws:
            message = json.loads(ws.receive_text())
    assert message["type"] == "error" and message["code"] == "bad_params"


def _run_all() -> int:
    tests = [(name, fn) for name, fn in globals().items() if name.startswith("test_") and callable(fn)]
    failures = 0
    for name, fn in tests:
        try:
            fn()
        except Exception:  # report every failure, then exit non-zero
            failures += 1
            print(f"FAIL  {name}")
            traceback.print_exc()
        else:
            print(f"ok    {name}")
    if failures:
        print(f"{failures} of {len(tests)} FAILED")
        return 1
    print("ALL GOOD")
    return 0


if __name__ == "__main__":
    sys.exit(_run_all())
