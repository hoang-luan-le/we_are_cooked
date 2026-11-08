"""Dana's tools, per-call setup and the Deepgram Settings message."""
import json

from .config import DANA_MODEL, DANA_VOICE, INPUT_RATE, OUTPUT_RATE
from .facts import get_facts, post_debrief, request_hint
from .prompts import build_prompt, greeting


def _schema(name, description, props, required=None):
    params = {"type": "object", "properties": props}
    if required:
        params["required"] = required
    return {"name": name, "description": description, "parameters": params}


FACTS_TOOL = _schema(
    "get_incident_facts",
    "Get what is known about the incident right now: impact numbers, what the learner has found, "
    "and what you (Dana) know. Call this before saying anything about the incident.",
    {"topic": {"type": "string", "description": "What the learner asked about, e.g. 'impact' or 'changes tonight'."}})
END_TOOL = _schema(
    "end_call", "Hang up the phone. Use only right after you said a short goodbye.",
    {"reason": {"type": "string", "description": "Why the call ends, e.g. 'learner is investigating'."}})
SUBMIT_TOOL = _schema(
    "submit_update",
    "Submit the learner's update to customers and the VP, in their own words, to get their scorecard.",
    {"answer": {"type": "string", "description": "Everything the learner said to customers and the VP."}},
    required=["answer"])

TOOLS_BY_CALL = {
    "briefing": [FACTS_TOOL, END_TOOL],
    "help": [FACTS_TOOL, END_TOOL],
    "debrief": [FACTS_TOOL, SUBMIT_TOOL, END_TOOL],
}
TOOLS = [FACTS_TOOL, END_TOOL]  # kept for older imports
CHECKING_LABEL = {"get_incident_facts": "the dashboard", "submit_update": "your scorecard"}
SKILL_ORDER = ["diagnosis", "mitigation", "validation", "communication", "collaboration"]


async def prepare_call(ctx) -> dict:
    """Runs once before a call starts. Help calls: note the nudge, then take ONE hint (counts the call)."""
    extra: dict = {}
    if ctx.call == "help":
        facts = await get_facts(ctx.incident_id)
        extra["nudged"] = bool(facts.get("nudge"))
        hint = await request_hint(ctx.incident_id, ctx.user)
        extra["hint"] = hint.get("hint")
        extra["hint_error"] = hint.get("error")
    return extra


def build_settings(call: str, level: str, extra: dict | None = None) -> dict:
    return {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": INPUT_RATE},
            "output": {"encoding": "linear16", "sample_rate": OUTPUT_RATE, "container": "none"},
        },
        "agent": {
            "listen": {"provider": {"type": "deepgram", "model": "nova-3",
                                    "keyterms": ["Dana", "rollback", "roll back", "ShopNorth", "checkout", "deploy"]}},
            "think": {
                "provider": {"type": "google", "model": DANA_MODEL, "temperature": 0.6},
                "prompt": build_prompt(call, level, extra=extra),
                "functions": TOOLS_BY_CALL[call],
            },
            "speak": {"provider": {"type": "deepgram", "model": DANA_VOICE}},
            "greeting": greeting(call, level, extra),
        },
    }


def summarize_debrief(result: dict) -> dict:
    """Backend rubric -> what Dana needs for one line of feedback. Scores are never changed here."""
    rubric = result.get("rubric") or {}
    scored = [(k, rubric[k]) for k in SKILL_ORDER if isinstance(rubric.get(k), dict) and "score" in rubric[k]]
    if not scored:
        return {"error": "no_scores"}
    best = max(scored, key=lambda kv: kv[1]["score"])   # first highest, in skill order
    worst = min(scored, key=lambda kv: kv[1]["score"])  # first lowest
    out = {"strength": best[1].get("reason", ""), "total": result.get("total"), "out_of": result.get("out_of")}
    out["improve"] = worst[1].get("reason", "") if worst[1]["score"] < 4 else "Nothing major. Keep doing exactly this."
    return out


async def run_tool(name: str, arguments, ctx) -> tuple[str, bool]:
    """Returns (JSON string for the model, whether to end the call). Never raises."""
    try:
        args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
    except json.JSONDecodeError:
        args = {}
    if name == "get_incident_facts":
        return json.dumps(await get_facts(ctx.incident_id)), False
    if name == "end_call":
        return json.dumps({"ok": True, "reason": args.get("reason", "")}), True
    if name == "submit_update" and ctx.call == "debrief":
        answer = str(args.get("answer", "")).strip()
        if not answer:
            return json.dumps({"error": "empty_answer"}), False
        result = await post_debrief(ctx.incident_id, ctx.user, answer)
        if "error" in result:
            return json.dumps(result), False
        return json.dumps(summarize_debrief(result)), False
    return json.dumps({"error": f"Unknown tool {name}"}), False
