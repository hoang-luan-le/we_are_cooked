# services/api/voice — Dana (AI)

**Owner:** Luan · Contract: `packages/contracts/dana-voice.md`

## Run Dana on her own (Phase 1)
```powershell
cd F:\we_are_cooked\services\api
pip install -r voice\requirements.txt
python -m voice.test_offline              # no keys needed
uvicorn voice.dev_server:app --port 8001  # then open http://localhost:8001
```
Keys come from the repo-root `.env`. Dana only needs `DEEPGRAM_API_KEY` (no Gemini key: Gemini runs through Deepgram).
`DANA_FACTS=fake` (default) uses `fake_facts.json`; set it to the backend URL once Duy's API is up.

## Files
| File | What |
|---|---|
| `relay.py` | `WS /ws/voice`: browser ↔ Deepgram, translated to the contract's messages |
| `text_mode.py` | Text fallback: typed chat through Deepgram; if Deepgram is down, scripted Dana from the backend (no AI, no Gemini key) |
| `prompts.py` | Persona, grounding rules, level styles, per-call tasks, greetings |
| `dana.py` | Tools per call (`get_incident_facts`, `submit_update` in debrief, `end_call`), help-call setup, rubric summary, Deepgram Settings |
| `facts.py` | Backend client: `/facts`, `/hint`, `/debrief` (sends `X-Internal-Key`) |
| `dev_server.py` / `dev_page.html` | Standalone test server + reference browser client for Tung |
| `test_offline.py` | Checks settings, tools, and that **no prompt leaks the root cause** |
| `check_gemini.py` | Phase 0: Gemini through Deepgram, with function calling |

## For Duy: mount it in the backend
```python
from voice import router as dana_router
app.include_router(dana_router)
```
Then set `DANA_FACTS=http://localhost:8000` (or the deployed URL).

## Status
- [x] Phase 0: contract, Gemini check script
- [x] Phase 1: relay, briefing call, captions, typed input, barge-in, end_call, text fallback (Gemini direct)
- [x] `check_gemini.py` with the real key → PASS
- [x] Phase 2: help call (one `/hint` per call, nudge-aware), debrief (`submit_update` → `/api/debrief`, one line of feedback from the rubric reasons), real `/facts`
- [ ] Phase 3: React voice component with Tung, full path in the browser

## Run with the real backend (Phase 2+)
Root `.env`: `DANA_FACTS=http://localhost:8000`, `INTERNAL_KEY=<same as backend>`.
```powershell
cd F:\we_are_cooked\services\api
python -m uvicorn main:app --port 8000
```
Dana is at `ws://localhost:8000/ws/voice`. `POST /api/demo/reset {"level":"explore"}` restarts `inc_demo`.
