"""WS /ws/voice: browser <-> this server <-> Deepgram (voice) or Gemini (text fallback).

Speaks the contract in packages/contracts/dana-voice.md. Keys never reach the browser.
"""
import asyncio
import json
import time
from dataclasses import dataclass

import websockets
from fastapi import APIRouter, WebSocket

from .config import CALLS, DEEPGRAM_AGENT_URL, DEEPGRAM_API_KEY, LEVELS, LOG_DIR
from .dana import CHECKING_LABEL, build_settings, run_tool
from .text_mode import text_call

router = APIRouter()
END_WAIT_S = 8  # after end_call, wait at most this long for Dana to finish speaking


@dataclass
class Ctx:
    call: str
    level: str
    mode: str
    incident_id: str
    user: str


class Link:
    """Safe sends to the browser + a per-call log file."""

    def __init__(self, ws: WebSocket, ctx: Ctx):
        self.ws, self.ctx = ws, ctx
        LOG_DIR.mkdir(exist_ok=True)
        self.path = LOG_DIR / f"{int(time.time())}-{ctx.incident_id}-{ctx.call}.jsonl"

    def log(self, event: str, **data):
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"t": round(time.time(), 3), "event": event, **data}) + "\n")

    async def send(self, **msg):
        try:
            await self.ws.send_text(json.dumps(msg))
        except Exception:  # noqa: BLE001  browser already gone
            pass

    async def send_audio(self, data: bytes):
        try:
            await self.ws.send_bytes(data)
        except Exception:  # noqa: BLE001
            pass


@router.websocket("/ws/voice")
async def dana_socket(ws: WebSocket):
    await ws.accept()
    q = ws.query_params
    ctx = Ctx(call=q.get("call", "briefing"), level=q.get("level", "explore"), mode=q.get("mode", "voice"),
              incident_id=q.get("incident_id", "inc_demo"), user=q.get("user", "anon"))
    link = Link(ws, ctx)
    if ctx.call not in CALLS or ctx.level not in LEVELS or ctx.mode not in ("voice", "text"):
        await link.send(type="error", code="bad_params",
                        message=f"call must be {CALLS}, level {LEVELS}, mode voice|text", fallback="none")
        await ws.close()
        return
    link.log("start", **ctx.__dict__)
    reason = "error"
    try:
        reason = await (voice_call(link) if ctx.mode == "voice" else text_call(link))
    finally:
        link.log("end", reason=reason)
        await link.send(type="call_ended", reason=reason)
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass


async def _connect_deepgram():
    headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}
    try:  # websockets >= 14
        return await websockets.connect(DEEPGRAM_AGENT_URL, additional_headers=headers, max_size=None, open_timeout=10)
    except TypeError:  # older websockets
        return await websockets.connect(DEEPGRAM_AGENT_URL, extra_headers=headers, max_size=None, open_timeout=10)


async def voice_call(link: Link) -> str:
    ctx = link.ctx
    if not DEEPGRAM_API_KEY:
        await link.send(type="error", code="no_deepgram_key", message="DEEPGRAM_API_KEY is missing.", fallback="text")
        return "error"
    try:
        dg = await _connect_deepgram()
    except Exception as e:  # noqa: BLE001
        link.log("deepgram_connect_failed", error=repr(e))
        await link.send(type="error", code="voice_unavailable", message="Couldn't reach the voice service.", fallback="text")
        return "error"

    await dg.send(json.dumps(build_settings(ctx.call, ctx.level)))
    muted = False
    result = {"reason": "error"}
    end_requested = asyncio.Event()
    finished_speaking = asyncio.Event()

    async def browser_to_dg():
        nonlocal muted
        while True:
            msg = await link.ws.receive()
            if msg["type"] == "websocket.disconnect":
                result["reason"] = "user_hung_up"
                return
            if msg.get("bytes") is not None:
                if not muted:
                    await dg.send(msg["bytes"])
            elif msg.get("text"):
                data = json.loads(msg["text"])
                kind = data.get("type")
                if kind == "text" and str(data.get("text", "")).strip():
                    link.log("user_typed", text=data["text"])
                    await dg.send(json.dumps({"type": "InjectUserMessage", "content": data["text"]}))
                elif kind == "mute":
                    muted = bool(data.get("on"))
                elif kind == "hang_up":
                    result["reason"] = "user_hung_up"
                    return

    async def handle_function(fn: dict):
        name = fn.get("name")
        if name in CHECKING_LABEL:
            await link.send(type="checking", what=CHECKING_LABEL[name])
        content, end = await run_tool(name, fn.get("arguments", "{}"), ctx.incident_id)
        link.log("tool", name=name, arguments=fn.get("arguments"), result=content[:500])
        await dg.send(json.dumps({"type": "FunctionCallResponse", "id": fn.get("id"), "name": name, "content": content}))
        if end:
            finished_speaking.clear()
            end_requested.set()

    async def dg_to_browser():
        async for raw in dg:
            if isinstance(raw, bytes):
                await link.send_audio(raw)
                continue
            d = json.loads(raw)
            kind = d.get("type")
            if kind == "SettingsApplied":
                await link.send(type="ready", call=ctx.call, mode="voice")
                await link.send(type="status", state="listening")
            elif kind == "ConversationText":
                role = "dana" if d.get("role") == "assistant" else "you"
                link.log("said", role=role, text=d.get("content"))
                await link.send(type="caption", role=role, text=d.get("content", ""))
            elif kind == "UserStartedSpeaking":
                await link.send(type="user_started_speaking")
            elif kind == "AgentThinking":
                await link.send(type="status", state="thinking")
            elif kind == "AgentStartedSpeaking":
                await link.send(type="status", state="speaking")
            elif kind == "AgentAudioDone":
                await link.send(type="dana_done_speaking")
                await link.send(type="status", state="listening")
                finished_speaking.set()
            elif kind == "FunctionCallRequest":
                for fn in d.get("functions", []):
                    if fn.get("client_side", True):
                        asyncio.create_task(handle_function(fn))
            elif kind == "Error":
                link.log("deepgram_error", detail=d)
                await link.send(type="error", code="voice_error",
                                message=str(d.get("description", "Voice error")), fallback="text")
                return
            elif kind == "Warning":
                link.log("deepgram_warning", detail=d)

    async def ender():
        await end_requested.wait()
        try:
            await asyncio.wait_for(finished_speaking.wait(), END_WAIT_S)
        except asyncio.TimeoutError:
            pass
        result["reason"] = "done"

    async def keepalive():
        while True:
            await asyncio.sleep(8)
            await dg.send(json.dumps({"type": "KeepAlive"}))

    tasks = [asyncio.create_task(c) for c in (browser_to_dg(), dg_to_browser(), ender(), keepalive())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            if not t.cancelled() and t.exception():
                link.log("stopped", error=repr(t.exception()))
                await link.send(type="error", code="voice_dropped", message="The call dropped.", fallback="text")
                result["reason"] = "error"
    finally:
        for t in tasks:
            t.cancel()
        await dg.close()
    return result["reason"]
