"""Smoke tests. Run from services/api:  python tests/test_smoke.py  (must print ALL GOOD).

Also works with pytest:  python -m pytest
Uses the real scenario/scenario.json; expected values are read from it, not copied here.
"""
from __future__ import annotations

import itertools
import json
import sys
import tempfile
import traceback
from dataclasses import replace
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from fastapi.testclient import TestClient  # noqa: E402

from config import DEFAULT_SCENARIO_PATH, Settings  # noqa: E402
from engine.state import PullRequest  # noqa: E402
from main import create_app  # noqa: E402
from scenario_loader import ScenarioError, load_scenario  # noqa: E402

SCENARIO = load_scenario(DEFAULT_SCENARIO_PATH)
SPEC = SCENARIO.spec
INC = SPEC.incident_id
INTERNAL_KEY = "test-internal-key"
TEAM = {"X-Demo-User": "duy"}
RELAY = {"X-Internal-Key": INTERNAL_KEY}
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


class Harness:
    """A running app with a fake clock and helpers for the common calls."""

    _keys = itertools.count()

    def __init__(self, scenario_path: Path = DEFAULT_SCENARIO_PATH, auth0_domain: str = "") -> None:
        self.clock = FakeClock()
        settings = Settings(scenario_path=scenario_path, internal_key=INTERNAL_KEY, auth0_domain=auth0_domain)
        self.app = create_app(settings, clock=self.clock)
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

    def set_pr(self, **fields) -> None:
        """Stand-in for PR verify (GitHub), which is not built yet."""
        pr = PullRequest(**{"number": 7, "merged": True, "ci_passed": True, "substantive_review": True, **fields})
        self.app.state.runtime.store.change(INC, lambda s, now: (replace(s, pr=pr), None))

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
        h.set_pr()
        h.ok("deploy_fix")
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
        h.set_pr()
        h.ok("deploy_fix")
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


# ---------- demo reset and voice mount ----------

def test_demo_reset_restarts_from_the_page():
    with Harness() as h:
        h.night_shift()
        h.hint()
        state = h.client.post("/api/demo/reset", json={"level": "challenge"}, headers=TEAM).json()
        assert state["phase"] == "paged" and state["level"] == "challenge" and state["actions_taken"] == []
        assert h.facts()["hint_calls"] == 0
        assert h.client.post("/api/demo/reset", json={"level": "expert"}, headers=TEAM).status_code == 422


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
