STATUS: BLOCKED
COMMAND_ID: 03-NIGHT-BOARD-01

# Phase 03 Shared Night board and typed handoff

The local team walkthrough is ready to review. The backend contract still lacks per-member Night roles and monotonic snapshot revisions. The work builds on the [earlier Phase 03 slice](https://github.com/thanhtungnguyen-dev/we_are_cooked/blob/2b0a4415a762ff582a05fec9a9cff72876bba7ef/reports/codex.md) and the [Phase 01 and 02 quality follow-up](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/febc0817fdefdd83611e1f10b905e97e699b09a6). The branch synced [fork main at 8989acd](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/8989acd317fa517fe547f7ad8136684f834b313f), which includes [Duy’s P0 backend at 474623a](https://github.com/hoang-luan-le/we_are_cooked/commit/474623ac2d5f6905714efc5012efe9c6066a320f).

## A. Full-stack and React

- [Night panels](../apps/web/app/night/night-panels.tsx) request server-filtered logs, release diffs, runbooks and a metric history window through the [same-origin panel bridge](../apps/web/app/api/night/panels/route.ts). The bridge checks the configured member and the incident’s unlocked panels before fetching evidence. Opening a panel still records the existing `open_panel` action for Dana’s fact ladder. Release diffs retain the backend’s GitHub or scenario source label. The baseline fixture and legacy local API keep their labeled samples.
- The panel effect runs when its URL, refresh counter or relevant phase changes. Cleanup aborts the previous request. A failed refresh leaves the last loaded data visible and offers a retry in that panel. Log filtering waits for explicit submit. Reading or filtering one panel does not reset another panel or the shared finding draft. The current metric samples still follow the incident poll, while the expandable history supplies its own sample times and events.
- [NightHandoff](../apps/web/app/night/night-handoff.tsx) collects what happened, current state, what was tried and remaining risks. It can include optional morning teammates. [The handoff bridge](../apps/web/app/api/night/handoff/route.ts) validates these fields and forwards to the backend. The backend decides who can write and when, and a confirmed save is visible to the second member through polling. [useNightApi](../apps/web/app/night/use-night-api.ts) serializes the handoff POST alongside other writes in that browser and aborts a preceding read before the write. The draft stays visible after a rejection. The handoff contract has no request idempotency key, so an unconfirmed result instructs the player to check the shared note before retrying.

## B. Data structures and algorithms

The logs request caps results at 60. For n returned lines and L total characters, rendering and forming row keys costs O(n + L) time and O(n + L) space. A virtual list would help if the contract served thousands of rows at once. The metrics history endpoint returns a 20-minute window sampled every 30 seconds, so the historical table is small. Keeping it separate from the seven live samples lets a confirmed rollback update the live chart without refetching historical data on every poll.

The optional morning handles use a Set to remove duplicates while preserving first-seen order. For k entered handles, the deduplication is O(k) expected time and O(k) space. The form caps k at four, and the backend checks that every handle exists.

## C. System design and remaining contracts

The team API supplies shared evidence, teammate membership, allowed actions and rollback state. Its panel routes expose shared data and do not carry a per-member Night role. The demo bridge enforces membership and panel unlocks for its own reads. Duy’s direct API reads and Luan’s relay need their own authenticated scope before this can be used as a production permission boundary.

Duy still needs a distinct Night Lead and Investigator contract, role-scoped evidence and action authorization, and a revision or equivalent ordering token. Browser cancellation prevents a known local race but cannot order snapshots across clients. Luan and Duy still need a stable logical call identity before voice Help can switch transports without consuming a second hint. Help uses one text relay socket. Debrief remains gated on a confirmed deployed fix, with the gate exercised against simulated state. The real GitHub diff and live Deepgram paths need provider configuration and separate verification.

## Checks

- Production build and typecheck passed.
- Seventeen browser checks passed across fixtures, the legacy FastAPI demo and the latest local team FastAPI. The team walkthrough used two demo handles and the actual scripted Dana relay. It covered panel access checks, log filtering and clipboard, stale panel retry, scenario diff source, runbook steps, metric history, a lost finding acknowledgement, one Help increment, recovery in both browsers, and a shared handoff.
- Eighty-one backend smoke checks and nine offline voice checks passed. The shared board passed Chromium layout checks at 320, 390, and 1440 px. The debrief gate was browser-tested with simulated state. Live Deepgram, physical device audio and a real GitHub release diff were not exercised.

**Explain it back.** Why do the metrics shown during recovery still come from the incident poll while the historical timeline has its own fetch?

**Quick verification.** Follow the [two-browser setup](../apps/web/README.md) and run [the Night board test](../apps/web/tests/night-board.spec.ts). Inspect the first denied log request, the successful open action, and the handoff that reaches the other browser.
