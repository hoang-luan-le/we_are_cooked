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
  The server picks the engine: typed chat through Deepgram, or, if Deepgram is down, **scripted Dana** (no AI: lines come from `/facts`, `/hint` and `/api/debrief`). `ready.engine` says which. No Gemini key is needed anywhere.
- The server reads `level` and `incident_id` and loads Dana's prompt + tools. Frontend does nothing else to set her up.

## 2. Audio (voice mode only)

| Direction | Format |
|---|---|
| Browser → server | **Binary** frames, raw PCM 16-bit little-endian, mono, **16 000 Hz**, ~100 ms per frame (the template's mic worklet does this) |
| Server → browser | **Binary** frames, PCM 16-bit LE, mono, **24 000 Hz**. Play in order, gapless. |

Working reference client: `services/api/voice/dev_page.html` (mic worklet, gapless playback, barge-in, text fallback). Port it into React.

## 3. JSON messages: server → browser

| `type` | Fields | Frontend does |
|---|---|---|
| `ready` | `call`, `mode`, `engine` (`deepgram` \| `scripted`) | Show "Dana connected", start the mic (voice mode) |
| `caption` | `role` (`dana` \| `you`), `text` | Append to the captions panel. **Always shown** (accessibility) |
| `status` | `state` (`listening` \| `thinking` \| `speaking`) | Small indicator next to Dana |
| `user_started_speaking` | — | **Stop Dana's audio right away** (user interrupted her) |
| `dana_done_speaking` | — | Optional: enable the "Hang up" button highlight |
| `checking` | `what` (e.g. `"logs"`) | Optional: show "Dana is checking the logs…" |
| `call_ended` | `reason` (`done` \| `user_hung_up` \| `error`) | Let queued audio finish playing, then close the call screen |
| `error` | `code`, `message`, `fallback` (`text` \| `none`) | If `fallback` is `text`, reconnect with `mode=text` |

## 4. JSON messages: browser → server

| `type` | Fields | When |
|---|---|---|
| `text` | `text` | Typed input. Works in **both** modes (typed input works everywhere) |
| `mute` | `on` (bool) | Mic button |
| `hang_up` | — | Hang-up button |

## 5. What Dana needs from Backend

Dana calls `GET /api/incident/{id}/facts` before every answer about the incident. **Confirmed by Backend.** Type: `DanaFacts` in `types.ts`. A real response at the 2:04 page is in `dana_facts.example.json`.

```json
{
  "incident_id": "inc_demo",
  "level": "explore",
  "phase": "investigating",
  "sim_clock": "02:09",
  "impact": { "error_rate": 31.2, "orders_per_min": 290, "p95_ms": 1450,
              "baseline": { "error_rate": 0.4, "orders_per_min": 420, "p95_ms": 380 } },
  "dana_knows": [
    { "topic": "changes tonight", "text": "The team shipped a release, v2.14.0, at 1:47 a.m. I don't know what was in it." }
  ],
  "unlocked": ["dashboard", "logs"],
  "facts": [
    { "source": "logs", "topic": "who_fails", "text": "The failing requests are guest checkouts (guest=true), all with KeyError: 'tier' in loyalty_percent." }
  ],
  "findings": [ { "by": "tung", "text": "Only guests fail", "sim_clock": "02:08" } ],
  "next_hint": { "topic": "deploy_diff", "hint": "Open the deploy history. What changed right before the errors started?" },
  "actions_taken": ["answer", "open_panel:dashboard", "open_panel:logs", "share_finding", "hint"],
  "hint_calls": 1,
  "nudge": false,
  "stakeholder_message": null,
  "status": "broken",
  "handoff": null,
  "rubric": null
}
```

- `dana_knows` = what Dana knows as the manager (from `scenario.json`, BA2 edits it there); she shares an item only when the learner asks about that topic. `facts` = what the learners have found. `findings` = what they typed to each other.
- Fact topics, in help-ladder order: `impact` (dashboard), `who_fails` (logs), `deploy_diff` (deploys), `runbook`, `mitigation` (rollback), `missing_field` (logs + deploys opened **and** the team names the cause in a finding or status update), `fix` (deployed). Rollback comes before `missing_field`: stop the damage first.
- `next_hint` = the first ladder step not found yet. It repeats until they do it. When everything is found, `topic` is `null` and the hint says to write it down for the morning shift.
- `nudge` / `stakeholder_message`: true after `stakeholders.update_every_s` (120 s) without a status update or a help call. Same field names in `GET /api/incident/{id}`.
- `rubric`: `null` until `phase` is `fixed`; then the four action scores with `communication: {"pending": true}`; full once the debrief is posted.
- Not in `/facts` on purpose: the loyalty-discount flag (its name gives the cause away before anyone has found it; it's in `GET /api/incident/{id}` for the dashboard, and the `mitigation` fact says discounts are off).

Rule: if it isn't in `dana_knows` or `facts`, Dana doesn't know it. The backend decides what's unlocked; Dana never sees the answer key. Fresh `/facts` and every hint contain none of the `LEAKS` words in `voice/test_offline.py` (checked in `tests/test_smoke.py`).

### 5a. Help calls: `POST /api/incident/{id}/hint`

The **relay** calls this once when a `call=help` call starts (no body). Returns `{"topic", "hint", "hint_calls"}`, adds 1 to `hint_calls` and clears the nudge. The frontend does **not** send anything extra for a help call, so it's counted once.

### 5b. Debrief score: `POST /api/debrief`

```json
{ "incident_id": "inc_demo", "answer": "their words to customers and the VP (max 3000 chars)" }
```

Returns `RubricResult & {answer}` (see `types.ts`): `rubric.{diagnosis|mitigation|validation|communication|collaboration}` each `{score: 0|2|4, reason, evidence}`, plus `total`, `out_of: 20`, `final`. `reason` is one short sentence Dana can read out loud. Gemini adds feedback on top; it never changes the numbers.

### 5c. Auth

- `GET` routes (`/facts`, state) need no auth.
- `/hint` and `/debrief` accept either header below. `/action` and `/api/demo/reset` accept **only** `X-Demo-User`: the relay key gets 403 there, so Dana can never take an incident action (hard rule 2).
  - `X-Internal-Key: $INTERNAL_KEY` (shared secret in the root `.env`). Use this from the relay; it keeps working when Auth0 is on.
  - `X-Demo-User: <handle>`, demo mode only (no `AUTH0_DOMAIN`), and only for handles in `DEMO_TEAM`. Anyone else gets 403.
- `/debrief` returns 409 until checkout is stable again (`phase` `stabilized` or later). Posting it again replaces the answer.

### 5d. Running it

The voice router is mounted in the backend app, so the API and `ws://…:8000/ws/voice` share one port: `cd services/api && uvicorn main:app --port 8000`. Set `DANA_FACTS=http://localhost:8000` in the root `.env`. Demo incident `inc_demo` exists at startup; `POST /api/demo/reset {"level":"explore"}` restarts it from the 2:04 page.

## 6. Open questions (settle in hour 1)

1. **2-minute silence chase:** *Settled (backend):* `nudge: true` + `stakeholder_message` in incident state and `/facts`; the frontend rings Dana again (a short `help` call), which clears it via `/hint`.
2. **Spoken handoff:** proposal: typed only for the demo (rule 5: no audio recording by default).
3. **"Explain this" / PR explanation:** in or out of P0? If in, it's a plain HTTP call (`POST /api/ai/explain`), not a voice call.
