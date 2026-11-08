# Frontend guide: wiring the web app to the API

For Tung. Every shape is in [`types.ts`](types.ts); real responses are in
[`incident_state.example.json`](incident_state.example.json) and
[`dana_facts.example.json`](dana_facts.example.json). The API is frozen until the demo: fields won't
be renamed. If something blocks you, tell Duy.

## 1. Run the API on your laptop

```
cd services/api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000     # reads the repo-root .env; works with an empty .env
```

`GET http://localhost:8000/health` → `"status": "ok"`. Interactive docs: http://localhost:8000/docs.
In `.env`: `NEXT_PUBLIC_API_URL=http://localhost:8000`, `NEXT_PUBLIC_API_WS=ws://localhost:8000`.
CORS allows every origin while `CORS_ORIGINS` is empty.

## 2. One fetch helper for everything

```ts
const API = process.env.NEXT_PUBLIC_API_URL!;

export async function api<T>(path: string, handle: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Demo-User": handle, ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    // Engine rejections: { code, detail: "plain sentence" }  -> show detail, branch on code.
    // Input validation (422 from FastAPI): { detail: [ {loc, msg}, ... ] }  -> show "Please check the form."
    super(typeof body?.detail === "string" ? body.detail : "Please check the form and try again.");
  }
  get code(): string | undefined { return this.body?.code; }
}
```

- **Who am I:** demo mode uses `X-Demo-User: <handle>`. Handles: `duy, tung, luan, demo-a, demo-b`
  (`DEMO_TEAM`). Anyone else gets 403. Reads (`GET` incident, facts, panels, jobs) need no header.
- **Error codes** you'll meet: `answer_first`, `pr_not_ready`, `not_teammate`, `text_too_long`,
  `handoff_not_ready`, `night_pair_cannot_rate`, `debrief_not_ready`... full list: `ErrorCode` in
  `types.ts`. `detail` is always a sentence you can show as-is (no shame wording; rule 7).
- **Actions need an idempotency key:** one `crypto.randomUUID()` per click, reused if you retry the
  same click. A double click then counts once.

```ts
export function act(id: string, handle: string, action: ActionName, extra: { panel?: Panel; text?: string } = {}) {
  return api<ActionResponse>(`/api/incident/${id}/action`, handle, {
    method: "POST",
    body: JSON.stringify({ action, idempotency_key: crypto.randomUUID(), ...extra }),
  });
}
```

`ActionResponse.state` is the new `IncidentState`: render it right away instead of waiting for the
next poll.

## 3. The incident: poll one object

`GET /api/incident/{id}` → `IncidentState`, every 2–3 s on every laptop. Use `inc_demo` (always
exists; whole demo team are teammates), or create one with
`POST /api/incident/start {level, teammates}` → 201 `IncidentState`.

- **Enable buttons from `allowed_actions`**, not from your own phase logic. Example: `deploy_fix`
  appears there only once a merged PR with green CI is verified.
- **Start over:** `POST /api/demo/reset {"level": "explore" | "practice" | "challenge"}` resets
  `inc_demo` to the 2:04 page.

## 4. Screen by screen

### Call screen (2:04 a.m.)
- Ring while `state.ringing` is true. Buttons: `answer`, `snooze` (snooze never counts against
  anyone; the phone rings again 15 s later and errors climb a little).
- Dana's voice: open the WebSocket from `danaUrl()` in [`dana.ts`](dana.ts); protocol in
  [`dana-voice.md`](dana-voice.md). Captions always on.
- **Silence chase:** when `state.nudge` is true, show `state.stakeholder_message` and offer a
  "Call Dana" help call (`call=help`). Don't call `/hint` yourself: the relay does, so it counts once.

### Dashboard
- Live numbers: `state.metrics` (`error_rate` %, `orders_per_min`, `p95_ms`, plus `baseline`).
- Chart: `GET /api/incident/{id}/metrics/history?window_s=900&step_s=10` → `samples[]` (`sim_time`
  "HH:MM:SS") and `events[]` (bad release, paged, restart, rollback, fix). It reaches back before the
  page, so the 01:47 climb is visible. When `source` is `"tigerdata"`, show a small caption
  "Live data: Tiger Data" (sponsor proof): those samples come from the TimescaleDB hypertable that
  records every poll.
- `state.loyalty_discounts` is `"on" | "off"`: show it as **text** ("Loyalty discounts: OFF"), not
  only a colour.
- Opening a panel: send `act(id, me, "open_panel", { panel: "dashboard" })` once when it opens. This
  is what unlocks Dana's facts; the data GETs alone don't.

### Logs · Deploys · Runbook (each also sends `open_panel` with `logs` / `deploys` / `runbook`)
- `GET .../logs?limit=200&level=ERROR&q=guest` → `{ lines: LogLine[] }`, oldest first. Same second →
  same lines (deterministic). Filters are optional.
- `GET .../deploys` → `{ live_version, releases[] }`. Each release: `version, at, day, author, title,
  live, diff_source ("github" | "scenario"), files[{filename, patch}]`. `patch` is a unified-diff
  hunk: colour `+`/`-` lines **and** keep the `+`/`-` signs visible.
- `GET .../runbooks` → names; `GET .../runbooks/checkout-errors` → `{title, steps[]}`.

### Investigating and mitigating
- Share a finding: `act(..., "share_finding", { text })` (max 280). Status update to the VP:
  `act(..., "status_update", { text })` (max 500); it also clears the nudge.
- Mitigations: `rollback` (the right one), `restart`, `scale`, `restart_search` (they run and are
  recorded, never punished). After `rollback`: `phase` → `mitigating` → `stabilized` about 10 s later;
  watch the chart recover.

### Shift handoff: NIGHT PAIR / MORNING PAIR banners
- Banner: **NIGHT PAIR** while `phase` is `paged | investigating | mitigating | stabilized`;
  **MORNING PAIR** from `handed_off` on. For "you are…", check `me` in `state.handoff.night_pair` /
  `state.handoff.morning_pair`.
- Write (enabled from `stabilized`): `POST .../handoff`
  `{ what_happened, current_state, tried, risks, morning_pair: ["tung"] }` → `IncidentState`. The night
  pair can edit until it's rated.
- Rate (morning pair only): `POST .../handoff/rating { score: 1-5, note }` → `Handoff`. Shown in
  `state.handoff.rating`.

### Morning: PR → deploy
- Paste the PR link: `POST /api/pr/verify { incident_id, pr_url }` → `IncidentState` with `state.pr`:
  `merged, ci ("success" | "failure" | "pending" | "none"), review_count, mentor_review` (the mentor's
  GitHub name, show it: "Reviewed by mentor …"), `url`.
- Errors worth a friendly message: `pr_wrong_base`, `pr_not_a_fix`, `pr_too_old`,
  `github_unavailable` (offer a retry).
- Then `deploy_fix` appears in `allowed_actions` → `act(..., "deploy_fix")` → `fixed`, discounts ON.

### Debrief and score
- Dana's debrief call posts the answer for you. Show the score from `state.rubric`:
  `rubric.{diagnosis, mitigation, validation, communication, collaboration}` → `{score 0|2|4, reason,
  evidence}`; `total` / `out_of: 20`. Before the debrief, `communication` is `{ pending: true }`.
  `reason` is one sentence; show it under each score.
- Typed fallback: `POST /api/debrief { incident_id, answer }` (max 3000) with `X-Demo-User`.

### After: before/after check, jobs, network, evidence
- Check: `GET /api/checks?incident_id=...` → question + choices; `POST /api/checks
  { incident_id, stage: "before" | "after", choice, explanation }`. Ask "before" at the start, "after"
  once stable. Scores appear only when both are in (`improved` = after − before).
- Jobs: `GET /api/jobs` → `JobsSnapshot`. Always show **"Listings from Adzuna as of
  {fetched_at}"**. If `searches` is empty, show `message`; never fake listings.
- Connections: `GET /api/connections/pending` → who to answer about; `POST /api/connections
  { incident_id, to_user, work_again, note }`. Private: the reply never says what the other person
  answered.
- Network: `GET /api/network` → cards only where **both** said yes; `contact` appears only here.
- Profile: `GET /api/me`; `PATCH /api/me { contact?, github_login?, public_evidence? }`.
- Evidence: `GET /api/me/evidence` (your own), `GET /api/evidence/{handle}` (only if they set
  `public_evidence: true`; 404 otherwise).

### Cohort
- `POST /api/cohorts { name }` → 201 `Cohort` with `join_code`; `POST /api/cohorts/join
  { join_code }` (case and spaces don't matter); `GET /api/cohorts/{id}` → members (members only).

## 5. Rules the UI must keep (CLAUDE.md)
- Captions always on; keyboard works everywhere; labels never rely on colour alone.
- Handles only: never show real names or contact details outside a mutual network card.
- No timers that punish, no leaderboards; snooze, hints and breaks are never failures.
- ShopNorth is a fictional example company: keep the "(example)" labels.
