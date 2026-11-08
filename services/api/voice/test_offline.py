"""Offline checks, no keys needed.   cd services/api ;  python -m voice.test_offline"""
import asyncio
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from voice import dana, prompts
from voice.config import CALLS, LEVELS
from voice.dana import TOOLS_BY_CALL, build_settings, run_tool, summarize_debrief
from voice.dev_server import app
import voice.facts

voice.facts.DANA_FACTS = "fake"  # offline: never call a real backend, whatever .env says

LEAKS = ["tier", "keyerror", "guest", "loyalty", "pricing.py", ".get("]
EXTRAS = [{}, {"nudged": True, "hint": "Open the deploy history. What changed right before the errors started?"}]

# A real /api/debrief response from Duy's API (no PR yet).
DEBRIEF = {"rubric": {
    "diagnosis": {"score": 4, "reason": "You checked the logs and the deploy history and named the cause."},
    "mitigation": {"score": 4, "reason": "You rolled back to stop the damage and checked that it worked."},
    "validation": {"score": 2, "reason": "You confirmed recovery on the dashboard; the fix still needs passing CI."},
    "communication": {"score": 4, "reason": "Your update covered impact, cause, action and risk."},
    "collaboration": {"score": 2, "reason": "You shared findings; the PR still needs a teammate's real review."}},
    "total": 16, "out_of": 20, "final": True}


def ctx(call="debrief", incident_id="inc_x"):
    return SimpleNamespace(call=call, level="explore", incident_id=incident_id, user="luan", extra={})


def test_settings_and_no_leaks():
    for call in CALLS:
        for level in LEVELS:
            for extra in EXTRAS:
                s = build_settings(call, level, extra)
                json.dumps(s)
                assert s["agent"]["think"]["provider"]["type"] == "google"
                text = (s["agent"]["think"]["prompt"] + s["agent"]["greeting"]).lower()
                leaked = [w for w in LEAKS if w in text]
                assert not leaked, f"{call}/{level} prompt leaks the root cause: {leaked}"


def test_tools_per_call():
    names = {c: [t["name"] for t in TOOLS_BY_CALL[c]] for c in CALLS}
    assert names["debrief"] == ["get_incident_facts", "submit_update", "end_call"]
    assert "submit_update" not in names["briefing"] + names["help"]
    for tools in TOOLS_BY_CALL.values():
        for t in tools:  # Gemini rejects object schemas with empty properties
            assert t["parameters"]["properties"]


def test_help_prompt_uses_hint_and_nudge():
    p = prompts.build_prompt("help", "practice", extra=EXTRAS[1])
    assert "What changed right before" in p and "VP is asking" in p
    assert prompts.greeting("help", "practice", EXTRAS[1]) != prompts.greeting("help", "practice", {})
    assert "checklist" in prompts.build_prompt("help", "practice", extra={})  # no hint -> generic


def test_summarize_debrief_keeps_scores():
    s = summarize_debrief(DEBRIEF)
    assert s["strength"].startswith("You checked the logs")
    assert s["improve"].startswith("You confirmed recovery")  # first lowest in skill order
    assert (s["total"], s["out_of"]) == (16, 20)
    perfect = {"rubric": {k: {"score": 4, "reason": "r"} for k in dana.SKILL_ORDER}, "total": 20, "out_of": 20}
    assert "Nothing major" in summarize_debrief(perfect)["improve"]
    assert summarize_debrief({"rubric": {}}) == {"error": "no_scores"}


def test_tools():
    out, end = asyncio.run(run_tool("get_incident_facts", "{}", ctx(incident_id="inc_y")))
    assert json.loads(out)["incident_id"] == "inc_y" and not end
    _, end = asyncio.run(run_tool("end_call", {"reason": "x"}, ctx()))
    assert end
    out, _ = asyncio.run(run_tool("submit_update", {"answer": ""}, ctx()))
    assert json.loads(out)["error"] == "empty_answer"
    out, _ = asyncio.run(run_tool("submit_update", {"answer": "hi"}, ctx(call="help")))
    assert "Unknown tool" in json.loads(out)["error"]  # only the debrief call can submit
    out, _ = asyncio.run(run_tool("nope", "{}", ctx()))
    assert "error" in json.loads(out)


def _talk(client, url, typed):
    """Open a text-mode call, type each line, return every message received."""
    out = []
    with client.websocket_connect(url) as ws:
        for line in typed:
            while True:
                m = ws.receive_json(); out.append(m)
                if m.get("type") == "status" and m.get("state") == "listening":
                    break
            ws.send_json({"type": "text", "text": line})
        while True:
            m = ws.receive_json(); out.append(m)
            if m["type"] == "call_ended":
                return out


def _dana_lines(msgs):
    return [m["text"] for m in msgs if m.get("type") == "caption" and m["role"] == "dana"]


def test_bad_params():
    with TestClient(app).websocket_connect("/ws/voice?call=nope") as ws:
        assert ws.receive_json()["code"] == "bad_params"


def test_text_mode_falls_back_to_scripted_without_deepgram():
    import voice.relay as relay
    saved, relay.DEEPGRAM_API_KEY = relay.DEEPGRAM_API_KEY, ""
    try:
        msgs = _talk(TestClient(app), "/ws/voice?call=briefing&mode=text&level=practice",
                     ["what changed tonight?", "on it"])
    finally:
        relay.DEEPGRAM_API_KEY = saved
    assert msgs[0] == {"type": "ready", "call": "briefing", "mode": "text", "engine": "scripted"}
    lines = _dana_lines(msgs)
    assert "31 percent" in lines[1]                          # impact from /facts
    assert lines[2].startswith("Good question.") and "1:47" in lines[2]  # dana_knows, asked for
    assert msgs[-1] == {"type": "call_ended", "reason": "done"}
    assert not [w for w in LEAKS if w in " ".join(lines).lower()]


def test_scripted_help_and_debrief(monkeypatch=None):
    import voice.relay as relay
    import voice.text_mode as tm
    import voice.dana as d

    async def fake_hint(incident_id, user):
        return {"hint": "Open the dashboard.", "hint_calls": 1}

    async def fake_debrief(incident_id, user, answer):
        return DEBRIEF

    saved = (relay.DEEPGRAM_API_KEY, d.request_hint, tm.post_debrief)
    relay.DEEPGRAM_API_KEY, d.request_hint, tm.post_debrief = "", fake_hint, fake_debrief
    try:
        client = TestClient(app)
        lines = _dana_lines(_talk(client, "/ws/voice?call=help&mode=text", ["found nothing yet"]))
        assert any("Here's a hint: Open the dashboard." in l for l in lines)
        lines = _dana_lines(_talk(client, "/ws/voice?call=debrief&mode=text", ["We rolled back."]))
        assert any(l.startswith("What went well: You checked the logs") for l in lines)
    finally:
        relay.DEEPGRAM_API_KEY, d.request_hint, tm.post_debrief = saved


def test_no_gemini_anywhere():
    import pathlib
    for f in pathlib.Path(__file__).parent.glob("*.py"):
        if f.name in ("test_offline.py", "check_gemini.py"):
            continue
        assert "generativelanguage" not in f.read_text(encoding="utf-8"), f.name


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
    print("all offline checks passed")
