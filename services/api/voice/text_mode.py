"""Text fallback: same Dana (prompt + tools), talking to Gemini directly, no Deepgram.

Works when the mic is denied or the voice service is down.
"""
import json

import httpx

from .config import GEMINI_API_KEY, GEMINI_TEXT_MODEL
from .dana import CHECKING_LABEL, TOOLS, run_tool
from .prompts import build_prompt, greeting

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_TOOL_ROUNDS = 4
SORRY = "Sorry, I lost my connection for a second. Can you say that again?"


async def text_call(link) -> str:
    ctx = link.ctx
    if not GEMINI_API_KEY:
        await link.send(type="error", code="no_gemini_key", message="GEMINI_API_KEY is missing.", fallback="none")
        return "error"
    system = build_prompt(ctx.call, ctx.level, text_mode=True)
    contents: list[dict] = []
    await link.send(type="ready", call=ctx.call, mode="text")
    await link.send(type="caption", role="dana", text=greeting(ctx.call, ctx.level))
    await link.send(type="status", state="listening")

    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            msg = await link.ws.receive()
            if msg["type"] == "websocket.disconnect":
                return "user_hung_up"
            if not msg.get("text"):
                continue  # ignore stray audio in text mode
            data = json.loads(msg["text"])
            if data.get("type") == "hang_up":
                return "user_hung_up"
            if data.get("type") != "text" or not str(data.get("text", "")).strip():
                continue
            await link.send(type="caption", role="you", text=data["text"])
            link.log("said", role="you", text=data["text"])
            contents.append({"role": "user", "parts": [{"text": data["text"]}]})
            await link.send(type="status", state="thinking")
            reply, ended = await _turn(client, system, contents, link)
            await link.send(type="caption", role="dana", text=reply)
            link.log("said", role="dana", text=reply)
            await link.send(type="dana_done_speaking")
            await link.send(type="status", state="listening")
            if ended:
                return "done"


async def _turn(client, system, contents, link) -> tuple[str, bool]:
    ended = False
    body_tools = [{"functionDeclarations": TOOLS}]
    for _ in range(MAX_TOOL_ROUNDS):
        try:
            r = await client.post(
                GEMINI_URL.format(model=GEMINI_TEXT_MODEL),
                headers={"x-goog-api-key": GEMINI_API_KEY},
                json={"systemInstruction": {"parts": [{"text": system}]}, "contents": contents,
                      "tools": body_tools, "generationConfig": {"temperature": 0.6}},
            )
            r.raise_for_status()
            content = r.json()["candidates"][0]["content"]
        except Exception as e:  # noqa: BLE001
            link.log("gemini_error", error=repr(e))
            return SORRY, ended
        contents.append(content)  # keep the model turn as-is (thought signatures included)
        parts = content.get("parts", [])
        text = "".join(p["text"] for p in parts if "text" in p and not p.get("thought")).strip()
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        if not calls:
            return text or SORRY, ended
        responses = []
        for c in calls:
            if c.get("name") in CHECKING_LABEL:
                await link.send(type="checking", what=CHECKING_LABEL[c["name"]])
            out, end = await run_tool(c.get("name"), c.get("args", {}), link.ctx.incident_id)
            link.log("tool", name=c.get("name"), arguments=c.get("args"), result=out[:500])
            ended = ended or end
            fr = {"name": c.get("name"), "response": {"result": json.loads(out)}}
            if c.get("id"):
                fr["id"] = c["id"]
            responses.append({"functionResponse": fr})
        contents.append({"role": "user", "parts": responses})
        if ended and text:
            return text, True
    return SORRY, ended
