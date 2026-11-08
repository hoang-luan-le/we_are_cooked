STATUS: BLOCKED
COMMAND_ID: 03-NIGHT-BOARD-01

# Phase 03 Shared Night Board

The supported slice is ready to review. Distinct role enforcement and snapshot ordering require Duy's contract. Base is the [fork sync at 5bdae39](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/5bdae399b94a48dcc0b0c32b9fdfcea47e141ca1), which includes the [Phase 02 merge](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/5c54c200d2acca5cf4fb425a7f05112b5696c42b). The [Phase 02 report](https://github.com/thanhtungnguyen-dev/we_are_cooked/blob/5c54c200d2acca5cf4fb425a7f05112b5696c42b/reports/codex.md) tracks its entry dependencies. The pair was tested with [team backend 05ecda9](https://github.com/hoang-luan-le/we_are_cooked/commit/05ecda9c55620412e1c2c6b8da648623dad8283d).

## A. Full-stack and React

- [NightRun](../apps/web/app/night/night-run.tsx) reuses [DanaBriefing](../apps/web/app/night/dana-briefing.tsx) and [the Dana connection](../apps/web/app/night/dana-connection.ts) for Help and Debrief. A ref guards the call start before React renders. An effect responds to the call lifecycle, restores focus and lets the board keep its mounted inputs and filters. A stakeholder nudge comes from incident state and appears only between calls. The user accepts it by text. A completed support transcript remains available in the current tab.
- Help opens one `call=help` relay socket. The relay increments the hint count, so the browser sends no duplicate action or hint request. Help starts in text because the server consumes a hint before sending ready and a second socket would count again. Briefing still supports the existing explicit voice path. Debrief is shown when the backend reports a deployed fix. Full rubric and Morning review are later checkpoints.
- [TeamEvidence](../apps/web/app/night/team-evidence.tsx) submits findings and stakeholder updates through the [Night bridge](../apps/web/app/api/night/route.ts). The backend supplies author and clock. A failed note keeps its draft and shows a local error. [useNightApi](../apps/web/app/night/use-night-api.ts) serializes writes, aborts an older in-flight read when needed and refreshes after a replay. Polling preserves focus and keeps the last readable state on failure. [IncidentBoard](../apps/web/app/night/incident-board.tsx) shows the last browser receipt time separately from the simulation clock.

## B. Data structures and algorithms

The retry Map keys include the action and its panel or note text. Retrying the same unconfirmed payload reuses the key. A different finding gets its own key. Encoding a note of n characters takes O(n) time and space. Map operations are typically constant time after constructing the key. The fixed chart window retains seven samples. The findings list renders in O(m) for m notes and marks only new append positions, preserving DOM keys across poll updates. A stable server note ID would support incremental updates even if the API later reorders or deletes notes.

## C. System design and dependencies

The team API confirms allowed actions, teammate membership, findings, and incident progress. The current snapshot lacks a per-member Night role, role-specific log and deploy payloads, a revision and a conditional action token. Team mode displays an explicit unavailable state for those panels instead of exposing the fixture's logs or diff. The legacy shared demo still labels its scenario samples. Both real demo members used backend-authorized shared actions in the walkthrough. Their separate identities verify collaboration but cannot verify role-specific enforcement.

Duy needs to supply scoped reads, role assignments and authorization for findings and rollback, panel evidence, and monotonic revisions or an equivalent ordering contract. Local request cancellation prevents one client-side race. It cannot detect an older snapshot returned by the server. Luan and Duy would need a call identity that survives mode changes before voice Help can reconnect without consuming another hint. The relay identity and permissions also need production authentication.

## Checks

- Production build and typecheck passed.
- Two passed team browser cases for cohort resume and the two-member walkthrough. Includes shared finding highlight, focus retention, note retry without duplication, one real scripted relay Help increment, and recovery visible to both members.
- One passed contract-shaped browser case for a nudge hidden during Help and Debrief appearing only after a fixed snapshot.
- One legacy local FastAPI rollback check and twelve fixture browser regressions passed.
- Live Deepgram, a physical microphone, real role-specific data, and a real deployed-fix debrief are still pending.

**Explain it back.** Why is a hint counted by the relay and a shared finding counted by the action endpoint?

**Quick verification.** Run the two-identity browser test from the [setup instructions](../apps/web/README.md). Inspect how the browser retries a lost note acknowledgement with the original key and how the other member sees the finding during polling.
