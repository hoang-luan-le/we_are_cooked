# services/api/voice — AI

**Owner:** Luan

## Phase 0 checklist (first 30 min)
- [ ] Run `python check_gemini.py` → PASS (Gemini works through Deepgram, with function calling)
- [ ] Agree `packages/contracts/dana-voice.md` with Tung (messages, audio format, text fallback)
- [ ] Duy confirms the `/facts` shape in section 5 of that file
- [ ] Settle the 3 open questions at the bottom of that file
- [ ] Get the live API URL + demo incident ID from Duy

## P0
Deepgram relay at `WS /ws/voice?call=briefing|help|debrief`, Dana's three calls grounded on `/facts`, level prompts, help ladder, captions, text fallback.

**Gates:** Dana gives a correct, grounded answer about the live incident.
