# services/api/voice — Dana (AI)

**Owner:** Luan · Contract: `packages/contracts/dana-voice.md`

## Run Dana on her own (Phase 1)
```powershell
cd F:\we_are_cooked\services\api
pip install -r voice\requirements.txt
python -m voice.test_offline              # no keys needed
uvicorn voice.dev_server:app --port 8001  # then open http://localhost:8001
```
Keys come from the repo-root `.env` (`DEEPGRAM_API_KEY`, `GEMINI_API_KEY` for the text fallback).
`DANA_FACTS=fake` (default) uses `fake_facts.json`; set it to the backend URL once Duy's API is up.

## Files
| File | What |
|---|---|
| `relay.py` | `WS /ws/voice`: browser ↔ Deepgram, translated to the contract's messages |
| `text_mode.py` | Text fallback: same prompt + tools, Gemini direct, no Deepgram |
| `prompts.py` | Persona, grounding rules, level styles, per-call tasks, greetings |
| `dana.py` | Tools (`get_incident_facts`, `end_call`) + Deepgram Settings |
| `facts.py` | Reads `/api/incident/{id}/facts` (or the fake file) |
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
- [ ] Run `check_gemini.py` with the real key → PASS
- [ ] Phase 2: help ladder + debrief with the backend rubric, real `/facts`
