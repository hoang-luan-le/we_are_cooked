"""Phase 0 check: can Deepgram's Voice Agent use Gemini as Dana's brain, WITH function calling?

Run:
    pip install websockets
    set DEEPGRAM_API_KEY=...        (PowerShell: $env:DEEPGRAM_API_KEY="...")
    python check_gemini.py                     # default gemini-2.5-flash
    python check_gemini.py gemini-3.5-flash    # try another model

No mic needed: it sends a typed question and answers Dana's tool call with fake facts.
PASS = settings accepted + Dana called get_incident_facts + her answer used the fake number (31.2).
"""
import asyncio, json, os, sys

import websockets

URL = "wss://agent.deepgram.com/v1/agent/converse"
MODEL = sys.argv[1] if len(sys.argv) > 1 else "gemini-2.5-flash"
FAKE_FACTS = {"impact": {"error_rate": 31.2}, "facts": ["About a third of checkouts are failing"]}

SETTINGS = {
    "type": "Settings",
    "audio": {
        "input": {"encoding": "linear16", "sample_rate": 24000},
        "output": {"encoding": "linear16", "sample_rate": 24000, "container": "none"},
    },
    "agent": {
        "listen": {"provider": {"type": "deepgram", "model": "nova-3"}},
        "think": {
            "provider": {"type": "google", "model": MODEL},
            "prompt": (
                "You are Dana, an engineering manager. Answer in one short sentence. "
                "For ANY question about the incident, call get_incident_facts first and use only its result."
            ),
            "functions": [{
                "name": "get_incident_facts",
                "description": "Facts about the current incident that the learner has unlocked.",
                "parameters": {"type": "object", "properties": {"topic": {"type": "string", "description": "What was asked about."}}},
            }],
        },
        "speak": {"provider": {"type": "deepgram", "model": "aura-2-thalia-en"}},
    },
}


async def connect(key):
    headers = {"Authorization": f"Token {key}"}
    try:
        return await websockets.connect(URL, additional_headers=headers)
    except TypeError:  # older websockets versions
        return await websockets.connect(URL, extra_headers=headers)


async def main():
    key = os.environ.get("DEEPGRAM_API_KEY")
    if not key:
        sys.exit("Set DEEPGRAM_API_KEY first.")
    print(f"Model: google / {MODEL}")
    ok = {"settings": False, "function": False, "answer": False}
    audio_bytes = 0
    ws = await connect(key)
    await ws.send(json.dumps(SETTINGS))

    async def keepalive():
        while True:
            await asyncio.sleep(5)
            await ws.send(json.dumps({"type": "KeepAlive"}))
    ka = asyncio.create_task(keepalive())

    try:
        async with asyncio.timeout(40):
            async for raw in ws:
                if isinstance(raw, bytes):
                    audio_bytes += len(raw)
                    continue
                msg = json.loads(raw)
                t = msg.get("type")
                if t == "SettingsApplied":
                    ok["settings"] = True
                    print("OK  settings accepted")
                    await ws.send(json.dumps({"type": "InjectUserMessage",
                                              "content": "How bad is the error rate right now?"}))
                elif t == "FunctionCallRequest":
                    for f in msg.get("functions", []):
                        print(f"OK  Dana called {f.get('name')}")
                        ok["function"] = True
                        await ws.send(json.dumps({"type": "FunctionCallResponse", "id": f.get("id"),
                                                  "name": f.get("name"), "content": json.dumps(FAKE_FACTS)}))
                elif t == "ConversationText" and msg.get("role") == "assistant":
                    text = msg.get("content", "")
                    print(f"    Dana: {text}")
                    if "31" in text:
                        ok["answer"] = True
                elif t == "AgentAudioDone" and ok["answer"]:
                    break
                elif t in ("Error", "Warning"):
                    print(f"!!  {t}: {msg}")
                    if t == "Error":
                        break
    except TimeoutError:
        print("..  timed out after 40 s")
    finally:
        ka.cancel()
        await ws.close()

    print(f"    audio received: {audio_bytes // 1000} KB")
    print("PASS" if all(ok.values()) else f"FAIL {ok}")


asyncio.run(main())
