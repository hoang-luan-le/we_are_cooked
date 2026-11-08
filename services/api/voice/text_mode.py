"""Text mode: no mic, no audio, no direct Gemini key.

A) Typed chat with the same Dana, through Deepgram (relay.voice_call(text=True)).
B) If Deepgram is unavailable: scripted Dana. No AI at all; every line comes from the backend
   (/facts dana_knows + impact, /hint, /api/debrief reasons). She can't chat freely, but the
   briefing, the hint and the debrief score all still work. (Duy's design: "Gemini fails ->
   help ladder from scenario.json; rubric score still computed by scoring.py".)
"""
import json
import re

from .dana import summarize_debrief
from .facts import get_facts, post_debrief
from .prompts import NO_HINT, greeting

MAX_BRIEFING_TURNS = 4

# Learner words -> dana_knows topic (from scenario.json). Order = priority.
TOPIC_WORDS = [
    ("changes tonight", r"chang|deploy|releas|ship|update|new version|push"),
    ("other alerts", r"other|else|cpu|search"),
    ("alert", r"alert|page|paged|when did|start"),
    ("impact", r"how bad|impact|how many|customer|percent|error|fail|broken|down"),
]
ON_IT = r"\b(on it|look(ing)? into|investigat|check(ing)?|open(ing)?|i'?ll|let me|ok(ay)?|got it|will do)\b"

SAY = {
    "good_q": "Good question.",
    "unknown": "I don't know more than that. The dashboard, logs and deploy history are open for you.",
    "brief_bye": "Okay, go take a look. Call me any time if you get stuck.",
    "help_thanks": "Thanks for the update.",
    "help_bye": "Give that a try, and call me again if you're stuck.",
    "debrief_ask": "What would you tell our customers, and what would you tell the VP? Write it in one message.",
    "not_ready": "Checkout isn't stable yet, so let's do this once the damage is stopped.",
    "no_score": "Thanks. Your scorecard will be on your screen in a moment.",
    "debrief_bye": "Thanks for handling this. Get some sleep.",
}


async def text_call(link, voice_call) -> str:
    reason = await voice_call(link, text=True)  # option A
    if reason != "fallback":
        return reason
    link.log("scripted_fallback")
    return await scripted_call(link)


class _Chat:
    def __init__(self, link):
        self.link = link

    async def dana(self, text: str):
        await self.link.send(type="caption", role="dana", text=text)
        self.link.log("said", role="dana", text=text, engine="scripted")

    async def listen(self) -> str | None:
        """Next typed message, or None if the learner hung up."""
        await self.link.send(type="status", state="listening")
        while True:
            msg = await self.link.ws.receive()
            if msg["type"] == "websocket.disconnect":
                return None
            if not msg.get("text"):
                continue  # ignore stray audio
            data = json.loads(msg["text"])
            if data.get("type") == "hang_up":
                return None
            text = str(data.get("text", "")).strip() if data.get("type") == "text" else ""
            if text:
                await self.link.send(type="caption", role="you", text=text)
                self.link.log("said", role="you", text=text, engine="scripted")
                return text


def _impact_line(facts: dict) -> str | None:
    imp = facts.get("impact") or {}
    rate, base = imp.get("error_rate"), (imp.get("baseline") or {}).get("error_rate")
    if rate is None:
        return None
    line = f"Right now about {round(rate)} percent of checkouts are failing"
    return line + (f", when it's normally under {max(1, round(base))} percent." if base is not None else ".")


def _match_topic(text: str, knows: dict) -> str | None:
    low = text.lower()
    for topic, pattern in TOPIC_WORDS:
        if topic in knows and re.search(pattern, low):
            return topic
    return None


async def scripted_call(link) -> str:
    ctx, chat = link.ctx, _Chat(link)
    await link.send(type="ready", call=ctx.call, mode="text", engine="scripted")
    await chat.dana(greeting(ctx.call, ctx.level, ctx.extra))
    run = {"briefing": _briefing, "help": _help, "debrief": _debrief}[ctx.call]
    return await run(ctx, chat)


async def _briefing(ctx, chat) -> str:
    facts = await get_facts(ctx.incident_id)
    knows = {k["topic"]: k["text"] for k in facts.get("dana_knows", []) if "topic" in k}
    if line := _impact_line(facts):
        await chat.dana(line)
    told: set[str] = set()
    for _ in range(MAX_BRIEFING_TURNS):
        text = await chat.listen()
        if text is None:
            return "user_hung_up"
        topic = _match_topic(text, knows)
        if topic and topic not in told:
            told.add(topic)
            await chat.dana((SAY["good_q"] + " " if topic == "changes tonight" else "") + knows[topic])
        elif re.search(ON_IT, text.lower()):
            break
        else:
            await chat.dana(SAY["unknown"])
    await chat.dana(SAY["brief_bye"])
    return "done"


async def _help(ctx, chat) -> str:
    # The greeting already asks what they found (or, after a nudge, for a status update).
    if await chat.listen() is None:
        return "user_hung_up"
    thanks = SAY["help_thanks"] if ctx.extra.get("nudged") else "Thanks."
    hint = ctx.extra.get("hint")
    await chat.dana(f"{thanks} Here's a hint: {hint}" if hint else f"{thanks} {NO_HINT}")
    await chat.dana(SAY["help_bye"])
    return "done"


async def _debrief(ctx, chat) -> str:
    await chat.dana(SAY["debrief_ask"])
    answer = await chat.listen()
    if answer is None:
        return "user_hung_up"
    result = await post_debrief(ctx.incident_id, ctx.user, answer)
    if result.get("error") == "not_ready":
        await chat.dana(SAY["not_ready"])
        return "done"
    summary = summarize_debrief(result) if "error" not in result else {"error": result["error"]}
    if "error" in summary:
        await chat.dana(SAY["no_score"])
    else:
        await chat.dana(f"What went well: {summary['strength']} Next time: {summary['improve']}")
    await chat.dana(SAY["debrief_bye"])
    return "done"
