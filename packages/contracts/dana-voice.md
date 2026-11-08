# Dana voice interface (contract)

**Owners:** AI (Luan) ↔ Frontend (Tung), with Backend (Duy) for `/facts`.
**Status:** DRAFT for hour 1. Change only via a PR that all three approve.
TypeScript types: `dana.ts` in this folder.

## 1. Connect

```
ws(s)://<API>/ws/voice?call=<briefing|help|debrief>&incident_id=<id>&user=<handle>&level=<explore|practice|challenge>&mode=<voice|text>
```

- One WebSocket per call. The browser never talks to Deepgram or Gemini directly; keys stay on the server.
- `mode=text` is the **text fallback**: same socket and same messages, but no audio. Frontend switches to it if the mic is denied or voice fails.
- The server reads `level` and `incident_id` and loads Dana's prompt + tools. Frontend does nothing else to set her up.

## 2. Audio (voice mode only)

| Direction | Format |
|---|---|
| Browser → server | **Binary** frames, raw PCM 16-bit little-endian, mono, **24 000 Hz**, ~20–100 ms per frame |
| Server → browser | **Binary** frames, same format. Play in order. |

## 3. JSON messages: server → browser

| `type` | Fields | Frontend does |
|---|---|---|
| `ready` | `call`, `mode` | Show "Dana connected", start the mic |
| `caption` | `role` (`dana` \| `you`), `text` | Append to the captions panel. **Always shown** (accessibility) |
| `status` | `state` (`listening` \| `thinking` \| `speaking`) | Small indicator next to Dana |
| `user_started_speaking` | — | **Stop Dana's audio right away** (user interrupted her) |
| `dana_done_speaking` | — | Optional: enable the "Hang up" button highlight |
| `checking` | `what` (e.g. `"logs"`) | Optional: show "Dana is checking the logs…" |
| `call_ended` | `reason` (`done` \| `user_hung_up` \| `error`) | Close the call screen, go to the next step |
| `error` | `code`, `message`, `fallback` (`text` \| `none`) | If `fallback` is `text`, reconnect with `mode=text` |

## 4. JSON messages: browser → server

| `type` | Fields | When |
|---|---|---|
| `text` | `text` | Typed input. Works in **both** modes (typed input works everywhere) |
| `mute` | `on` (bool) | Mic button |
| `hang_up` | — | Hang-up button |

## 5. What Dana needs from Backend

Dana calls `GET /api/incident/{id}/facts` before every answer about the incident. Proposed shape (**Duy to confirm**):

```json
{
  "incident_id": "inc_2041",
  "level": "explore",
  "phase": "investigating",
  "sim_clock": "02:09",
  "impact": { "error_rate": 31.2, "orders_per_min": 290, "p95_ms": 1450 },
  "unlocked": ["dashboard", "logs"],
  "facts": [
    { "source": "dashboard", "text": "Error rate jumped from 0.4% to 31% around 01:50" },
    { "source": "logs", "text": "Failing requests are guest checkouts with KeyError: 'tier'" }
  ],
  "actions_taken": ["answer", "open_panel:logs"],
  "hint_calls": 1,
  "status": "broken",
  "handoff": null,
  "rubric": null
}
```

Rule: if a fact isn't in `facts`, Dana doesn't know it. The backend decides what's unlocked; Dana never sees the answer key.

For the debrief, Dana also needs the backend's rubric score (`rubric`, filled once `phase` is `fixed`). Gemini writes feedback on top of it; it never changes the score.

## 6. Open questions (settle in hour 1)

1. **2-minute silence chase:** who triggers it? Proposal: the backend adds `nudge: true` to incident state; the frontend rings Dana again (a short `help` call).
2. **Spoken handoff:** proposal: typed only for the demo (rule 5: no audio recording by default).
3. **"Explain this" / PR explanation:** in or out of P0? If in, it's a plain HTTP call (`POST /api/ai/explain`), not a voice call.
