"""Dana's tools and the Deepgram Settings message."""
import json

from .config import DANA_MODEL, DANA_VOICE, INPUT_RATE, OUTPUT_RATE
from .facts import get_facts
from .prompts import build_prompt, greeting


def _schema(name, description, props):
    params = {"type": "object", "properties": props}
    return {"name": name, "description": description, "parameters": params}


TOOLS = [
    _schema("get_incident_facts",
            "Get what is known about the incident right now: impact numbers, what the learner has found, "
            "and what you (Dana) know. Call this before saying anything about the incident.",
            {"topic": {"type": "string", "description": "What the learner asked about, e.g. 'impact' or 'changes tonight'."}}),
    _schema("end_call",
            "Hang up the phone. Use only right after you said a short goodbye.",
            {"reason": {"type": "string", "description": "Why the call ends, e.g. 'learner is investigating'."}}),
]

CHECKING_LABEL = {"get_incident_facts": "the dashboard"}


def build_settings(call: str, level: str) -> dict:
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
                "prompt": build_prompt(call, level),
                "functions": TOOLS,
            },
            "speak": {"provider": {"type": "deepgram", "model": DANA_VOICE}},
            "greeting": greeting(call, level),
        },
    }


async def run_tool(name: str, arguments, incident_id: str) -> tuple[str, bool]:
    """Returns (JSON string for the model, whether to end the call). Never raises."""
    try:
        args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
    except json.JSONDecodeError:
        args = {}
    if name == "get_incident_facts":
        return json.dumps(await get_facts(incident_id)), False
    if name == "end_call":
        return json.dumps({"ok": True, "reason": args.get("reason", "")}), True
    return json.dumps({"error": f"Unknown tool {name}"}), False
