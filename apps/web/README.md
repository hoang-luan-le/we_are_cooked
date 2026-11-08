# Incident Lab web

Tung owns this Next.js app. Night 2D opens from the landing page and runs a fictional ShopNorth incident with scripted Dana captions, checkout metrics, logs, deploy history, and simulated rollback.

## Run the development fixture

```sh
cd apps/web
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) and select **Start Night 2D**. The fixture is enabled in development. To preview the built fixture, run `npm run build` and `NIGHT_FIXTURES=1 npm start`. In PowerShell, set `$env:NIGHT_FIXTURES = "1"` before starting.

The offline briefing works without a relay. To try the optional Dana development relay, follow the [relay instructions](../../services/api/voice/README.md) and set `DANA_DEV_WS_BASE` to its WebSocket origin, such as `ws://localhost:8001`, before starting Next.js. Choose **Answer Dana by text** or **Answer Dana with voice** on the incoming call. The briefing labels the relay engine as Deepgram or scripted. If voice fails, the same briefing continues in relay text. Open `/night?fixture=1` to explicitly run the offline fixture.

## Connect the local demo API

Start the [team API](../../services/api/README.md) on loopback. Then run Next.js with `NIGHT_API_ORIGIN=http://127.0.0.1:8000` and bind Next.js to loopback as well.

```sh
NIGHT_API_ORIGIN=http://127.0.0.1:8000 npm run dev -- --hostname 127.0.0.1
```

The local API mode uses the shared `inc_demo` incident and `demo-a` member. Change the member with `NIGHT_DEMO_USER` if your backend demo team differs. The API supplies phase, allowed actions, metrics, and discounts. Log samples and deploy details are labeled scenario content until the backend serves them. Open `/night?fixture=1` to run the offline scenario separately.

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
