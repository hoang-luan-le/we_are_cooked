"""Offline checks, no keys needed.   cd services/api ;  python -m voice.test_offline"""
import asyncio
import json

from fastapi.testclient import TestClient

from voice import prompts
from voice.config import CALLS, LEVELS
from voice.dana import TOOLS, build_settings, run_tool
from voice.dev_server import app

LEAKS = ["tier", "keyerror", "guest", "loyalty", "pricing.py", ".get("]


def test_settings_and_no_leaks():
    for call in CALLS:
        for level in LEVELS:
            s = build_settings(call, level)
            json.dumps(s)
            assert s["agent"]["think"]["provider"]["type"] == "google"
            assert [f["name"] for f in s["agent"]["think"]["functions"]] == ["get_incident_facts", "end_call"]
            text = (s["agent"]["think"]["prompt"] + s["agent"]["greeting"]).lower()
            leaked = [w for w in LEAKS if w in text]
            assert not leaked, f"{call}/{level} prompt leaks the root cause: {leaked}"


def test_tool_schemas_have_properties():
    for t in TOOLS:  # Gemini rejects object schemas with empty properties
        assert t["parameters"]["properties"]


def test_tools():
    out, end = asyncio.run(run_tool("get_incident_facts", "{}", "inc_x"))
    assert json.loads(out)["incident_id"] == "inc_x" and not end
    _, end = asyncio.run(run_tool("end_call", {"reason": "x"}, "inc_x"))
    assert end
    out, _ = asyncio.run(run_tool("nope", "{}", "inc_x"))
    assert "error" in json.loads(out)


def test_socket_bad_params_and_missing_key():
    client = TestClient(app)
    with client.websocket_connect("/ws/voice?call=nope") as ws:
        assert ws.receive_json()["code"] == "bad_params"
    import voice.text_mode as tm
    saved, tm.GEMINI_API_KEY = tm.GEMINI_API_KEY, ""
    try:
        with client.websocket_connect("/ws/voice?call=briefing&mode=text") as ws:
            first = ws.receive_json()
            assert first["type"] == "error" and first["code"] == "no_gemini_key"
            assert ws.receive_json() == {"type": "call_ended", "reason": "error"}
    finally:
        tm.GEMINI_API_KEY = saved


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
    print("all offline checks passed")
