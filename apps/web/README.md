# Incident Lab web

Tung owns this Next.js app. Night 2D opens from the landing page and runs a fictional ShopNorth incident with scripted Dana captions, checkout metrics, logs, deploy history, and simulated rollback.

## Run the development fixture

```sh
cd apps/web
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) and select **Night** or **Morning**. Night opens the bedroom with exercise setup. Pick a level and start solo, or join the rehearsal cohort with `NIGHT24`. `NIGHT00` exercises the expired-code response. Morning opens the office. Team handoffs are available through the meeting when the team API is configured. The development entry fixture saves the exercise, briefing checkpoint, and rollback progress in this browser. A resumed open briefing restarts the scripted captions. The role and member list are scenario data. To preview the built fixture, run `npm run build` and `NIGHT_FIXTURES=1 npm start`. In PowerShell, set `$env:NIGHT_FIXTURES = "1"` before starting.

The offline briefing works without a relay. To try the optional Dana development relay, follow the [relay instructions](../../services/api/voice/README.md) and set `DANA_DEV_WS_BASE` to its WebSocket origin, such as `ws://localhost:8001`, before starting Next.js. Choose **Answer Dana by text** or **Answer Dana with voice** on the incoming call. The briefing labels the relay engine as Deepgram or scripted. If voice fails, the same briefing continues in relay text. Open `/night?fixture=1` to explicitly run the offline fixture.

## Connect the local demo API

Start the [team API](../../services/api/README.md) on loopback. Then run Next.js with `NIGHT_API_ORIGIN=http://127.0.0.1:8000` and bind Next.js to loopback as well.

```sh
NIGHT_API_ORIGIN=http://127.0.0.1:8000 npm run dev -- --hostname 127.0.0.1
```

Select **Open local API demo** on the entry screen to resume the configured incident. The local API mode uses the shared `inc_demo` incident and `demo-a` member. Change the member with `NIGHT_DEMO_USER` if your backend demo team differs. The API supplies phase, allowed actions, metrics, and discounts. Log samples and deploy details are labeled scenario content until the backend serves them. The shared demo stays available alongside the opt-in team entry flow. Open `/night?fixture=1` to run the stateless offline scenario separately.

## Connect the team entry API

Run the team backend at [`05ecda9`](https://github.com/hoang-luan-le/we_are_cooked/commit/05ecda9c55620412e1c2c6b8da648623dad8283d) or a compatible commit on loopback. Start the web app with both `NIGHT_API_ORIGIN=http://127.0.0.1:8000` and `NIGHT_TEAM_ENTRY=1`. Team entry lets the configured demo member start a solo incident, join an existing cohort, and start a new incident with up to three selected cohort members. The cohort and incident links are saved per demo member in this browser. Share an incident URL only with its selected teammates. They can open it from an app instance configured with their own demo handle.

The API currently returns teammate handles and incident IDs. Role assignment, invite expiry, account-level resume discovery, and snapshot revisions need a backend contract. The local team API mode requires a loopback backend and a demo identity. It is for local rehearsal.

## Verify

```sh
npx playwright install chromium
npm run build
npm run typecheck
npm run test:browser
```

Playwright starts the built app with the fixture enabled and intercepts the optional relay with contract-shaped test messages. Set `CHROMIUM_EXECUTABLE_PATH` to use a locally installed Chromium binary.

To verify the real API, start a separate local backend instance. The check resets its demo incident before it runs.

```sh
NIGHT_TEST_API_ORIGIN=http://127.0.0.1:8000 npm run test:browser -- tests/night-api.spec.ts
```

Run the opt-in team entry browser check against a separate team backend instance.

```sh
NIGHT_TEST_TEAM_ENTRY=1 NIGHT_TEST_API_ORIGIN=http://127.0.0.1:8000 npm run test:browser -- tests/team-entry.spec.ts
```

## Verify the shared Night board

Use the team backend at [`474623a`](https://github.com/hoang-luan-le/we_are_cooked/commit/474623ac2d5f6905714efc5012efe9c6066a320f) or a compatible commit with its Dana facts URL set to the same loopback server. Run the local relay without proxy settings if a configured SOCKS proxy prevents its loopback requests. Build Next.js, then start the second web identity in another terminal.

```sh
NIGHT_FIXTURES=1 NIGHT_TEAM_ENTRY=1 NIGHT_API_ORIGIN=http://127.0.0.1:8000 NIGHT_DEMO_USER=demo-b npm run start -- --hostname 127.0.0.1 --port 3212
```

Run the pair walkthrough from the first terminal. Playwright starts its own web instance as demo-a.

```sh
NIGHT_TEST_TEAM_ENTRY=1 NIGHT_TEST_API_ORIGIN=http://127.0.0.1:8000 NIGHT_TEST_RELAY_BASE=ws://127.0.0.1:8000 NIGHT_TEST_PEER_ORIGIN=http://127.0.0.1:3212 npm run test:browser -- tests/night-board.spec.ts
```

A Help call starts in relay text. The relay selects its engine and counts the hint. Stakeholder nudges appear between calls. Debrief becomes available when the incident reports a deployed fix.

Team incidents load logs, deploys, metric history, and runbooks through the Next.js demo bridge after the corresponding panels are unlocked. The bridge checks the configured demo member against the incident. The deploy panel labels whether the backend returned a GitHub diff or its scenario fallback. The main metrics read continues to follow the incident snapshot during recovery.

After recovery, the Night participants can save a four-part shift handoff. The other browser sees the note through its normal incident poll. The API controls who can save or edit it. The optional morning handles must already be known to the backend.

## Verify Morning and the after-incident flow

With team entry enabled, open the Night incident and save its four-part handoff after recovery. Select **Open Morning workspace**. A named Morning teammate can rate the handoff. Use a configured pilot-repo PR to verify CI, review and merge. The deploy action appears only when the backend allows it. The final rubric and mutual connection depend on the backend’s recorded debrief and private opt-in answers.

The browser rehearsal uses the actual local FastAPI and Dana relay with deterministic GitHub responses. From the repository root, use the API environment with the dependencies in `services/api/requirements.txt`.

```sh
DANA_FACTS=http://127.0.0.1:3214 DEEPGRAM_API_KEY= python -m uvicorn morning_api:app --app-dir apps/web/tests/fixtures --host 127.0.0.1 --port 3214
```

Build Next.js from `apps/web` and start the second browser identity in a separate terminal.

```sh
NIGHT_FIXTURES=1 NIGHT_TEAM_ENTRY=1 NIGHT_API_ORIGIN=http://127.0.0.1:3214 NIGHT_DEMO_USER=demo-b MORNING_GITHUB_FIXTURE=1 npm run start -- --hostname 127.0.0.1 --port 3212
```

Run the Morning rehearsal. Playwright starts the demo-a web instance. The Morning board marks fixture GitHub evidence during this run.

```sh
NIGHT_TEST_MORNING=1 NIGHT_TEST_TEAM_ENTRY=1 NIGHT_TEST_API_ORIGIN=http://127.0.0.1:3214 NIGHT_TEST_RELAY_BASE=ws://127.0.0.1:3214 NIGHT_TEST_PEER_ORIGIN=http://127.0.0.1:3212 npm run test:browser -- tests/morning.spec.ts
```
