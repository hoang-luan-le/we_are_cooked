STATUS: READY_FOR_REVIEW
COMMAND_ID: 04-MORNING-QUALITY-01

# Phase 04 Morning readiness review

**Local 2D P0 readiness is 92/100.** The Phase 04 baseline was merged in [PR #4](https://github.com/thanhtungnguyen-dev/we_are_cooked/pull/4). This follow-up starts from [e34c11a](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/e34c11aa1ff0d6f9c14ceaa7b8becdf2516a0f19), which also contains the Phase 05 Resume fix. It reuses the Morning routes, API hooks, styles, and rehearsal fixture.

## What changed

- [MorningReview](../apps/web/app/morning/morning-review.tsx) now requires substantive independent review in addition to the backend's allowed action. A merged green PR with only self-review reproduced the original issue. The confirmation remembers the reviewed PR URL and head SHA, and blocks confirmation when polling shows different evidence or lost eligibility.
- [IncidentCheck](../apps/web/app/morning/incident-check.tsx) and [Connections](../apps/web/app/morning/morning-after.tsx) read back server state when an answer may have been accepted but the POST response was lost. The browser suite forwards the write to FastAPI, drops the response, and confirms that the saved answer and consent appear through reads with one write each. A temporary refresh failure retains the last loaded view and pauses writes. A denied read clears it.
- [Private evidence and mutual connections](../apps/web/app/morning/morning-after.tsx) now display the backend's merge status and the basis for a mutual card. The card's PR link goes through the existing GitHub URL validator. The provisional-to-final rubric transition refreshes evidence without remounting the panel, so the refresh control can retain focus.

## React and request order

The Deploy click captures the current verification in `useState` because its identity and eligibility affect what the dialog renders. The dialog ref exposes the native modal API. The confirm handler compares its captured URL and head with the current incident snapshot. Re-reading the snapshot only when the dialog opens would shorten the period of staleness but would miss changes observed while the dialog stays open.

The same-origin Next.js route still calls the member-scoped FastAPI resources. `useMorningResource` uses an effect keyed to incident, resource, refresh attempt, and final rubric state when supplied. Cleanup aborts stale requests. After an uncertain write, the following GET resolves what the server currently holds. Automatically repeating the POST would risk overwriting an answer or an existing choice. The browser retains the last allowed read on a temporary failure and clears it on a denied read.

## Data structures

Comparing two bounded PR URL and head pairs takes O(1) extra space and work with the contract's length limits. Rendering a connection panel with p pending choices, s acknowledged local choices, and c mutual cards takes O(p × (1 + s) + c) time and O(p + c) rendering space. The incident team caps these lists. For a larger roster, a Set built in O(s) time and space would replace the membership scans with expected O(1) lookups.

## Readiness score

This uses the existing Phase 01–03 weights. The score covers the local 2D P0 scope. The full live category receives zero points.

| Criterion | Weight | Earned | Evidence |
| --- | ---: | ---: | --- |
| Core player flow | 30 | 30 | Night handoff, rating, Explore, eligible PR and deploy, before/after, Dana debrief, per-member evidence and mutual consent. |
| Failure and resume | 22 | 22 | Unrelated PR, pending and failed CI, merged green self-review, changed PR head in an open dialog, lost check and consent responses, evidence refresh failure and denial. |
| Keyboard, touch and layout | 15 | 15 | Keyboard Deploy and Escape focus, evidence refresh focus, mobile touch consent, and no horizontal overflow at 320, 390 and 1440 px. |
| Feedback and state clarity | 15 | 15 | Source labels, distinct CI/review/merge states, read-only link on provider failure, changed-head notice, stale evidence notice and mutual card basis. |
| Build and regression evidence | 10 | 10 | Build, typecheck, production opt-in gates, 23 browser tests, 84 backend smoke checks and 9 offline voice checks. |
| Live and full contract evidence | 8 | 0 | Authenticated staging, actual pilot PR and GitHub, Deepgram with a device microphone, assigned reviewer identity, and server-side review and expected-head enforcement. |
| **Total** | **100** | **92** | **Ready for review on the local 2D track.** |

The browser can block a deploy after it observes a changed head. The backend action still checks merge and CI and accepts no expected head or assigned reviewer. Duy owns an atomic review and head precondition at deploy time. The four-browser landing-to-evidence rehearsal took 25.6 seconds on local SQLite with a GitHub fixture and Dana's scripted relay. The dated Adzuna jobs snapshot is P1 in the Working Plan and sits outside this P0 score.

**Explain it back.** Why can the browser safely reload a choice after a lost POST response, and which race can only a server-side deploy precondition close?

**Quick verification.** Follow the [Morning fixture setup](../apps/web/README.md) and run `npm run test:browser -- tests/morning.spec.ts` with the documented Morning variables. Open the Deploy dialog with a valid PR, change the observed head as the test does, and verify the original confirmation stays blocked until you reopen the dialog.

---

STATUS: READY_FOR_REVIEW
COMMAND_ID: 05-RESUME-01

# Phase 05 Team Resume during entry requests

Base [`a4073bb`](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/a4073bba497736fa82db457bb0def7deb7426c92). The local Phase 05 QA fix is ready for review. The [TeamEntry component](../apps/web/app/start/team-entry.tsx) and its [existing browser suite](../apps/web/tests/team-entry.spec.ts) cover the full change. No new packages or assets were needed.

## Reproduction and fix

Save a valid team incident and open `/start`. Hold the saved-incident GET, then submit a valid Join or a Start that will fail. Deliver the GET while the submission is in flight. Previously the client ignored the response and Resume stayed hidden until a reload. The new cases reproduced both orderings on the baseline before the fix.

The effect that loads the saved incident has its own abort controller. Join changes cohort membership, so the GET completes independently. Failed Start preserves the earlier incident. After successful Start returns a replacement ID, the submit handler aborts the old lookup, clears its notice, and uses the new ID. The existing local-storage fallback still offers a link if saving fails.

## React and Next.js

`useEffect` starts validation when the per-member storage key changes. Its cleanup aborts the request on dependency change or unmount. A `useRef` keeps the lookup controller accessible to the Start handler without causing a render. The `useState` values drive the visible link and notices. Existing Next.js handlers forward reads and submissions to FastAPI, which decides incident access. A validated link is a browser convenience and access is checked again when the incident opens.

Revalidating after every Join or Start failure would also restore the link. That approach adds another request and leaves Resume unavailable while an unrelated submission is pending. Letting the existing read finish reuses its result and gives a confirmed Start a single point to invalidate it.

## Data structures and request ordering

The fix uses one controller reference for the lookup, with O(1) extra state and O(1) work to cancel it. It keeps the existing per-member local-storage ID. For example, if incident A is being validated when Start creates B, a pending result for A is dropped and B becomes the visible link. This cancellation governs the local read. Start retries after an unconfirmed write still depend on a backend idempotency contract.

## Verification

- Production build, typecheck, and production opt-in checks passed.
- 22 Chromium cases passed, including three new tests for Join, failed Start, and successful Start with blocked storage. The two original bug cases failed on the pre-fix build.
- 84 backend smoke checks and 9 offline Dana voice checks passed with local SQLite on the current backend.
- A 25.7-second automated rehearsal used four Chromium contexts on one fresh incident. It covered landing, team entry, denied mic, logs, rollback, handoff, Explore, PR deploy, debrief, private evidence, and mutual opt-in. The GitHub response was a fixture, and Dana used the scripted relay.
- Stage sign-off still needs authenticated accounts, the pilot PR, live GitHub and Deepgram with a physical mic, and backend role, reviewer identity, and revision contracts. Live Tiger Data was outside this local rehearsal.

**Explain it back.** Why can Join and the saved-incident GET finish in either order, while a confirmed Start supersedes the GET?

**Quick verification.** Start the team API as described in the [web README](../apps/web/README.md), then run `NIGHT_TEST_TEAM_ENTRY=1 NIGHT_TEST_API_ORIGIN=http://127.0.0.1:8000 npm run test:browser -- tests/team-entry.spec.ts` from `apps/web`. In the failed Start case, observe that the old ID remains in storage and the link stays available.

---

STATUS: BLOCKED
COMMAND_ID: 04-MORNING-EVIDENCE-01

# Phase 04 Morning review and incident evidence

The local Phase 04 slice is ready for review. It starts at [Phase 03 quality commit 1f694f4](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/1f694f46e02abcb94a58378b31dfc0826ffe8394) and uses the P0 API currently on the fork. [Phase 03 evidence and remaining contracts](https://github.com/thanhtungnguyen-dev/we_are_cooked/blob/1f694f46e02abcb94a58378b31dfc0826ffe8394/reports/codex.md)

## A. Full-stack and React

- [MorningWorkspace](../apps/web/app/morning/morning-workspace.tsx) reuses the existing 2D shell and incident polling. The Night route opens Morning after the backend records the four-part handoff. [HandoffReview](../apps/web/app/morning/morning-review.tsx) shows the handoff and submits a one-line usefulness rating for an eligible Morning member. The server still validates participation.
- [MorningReview](../apps/web/app/morning/morning-review.tsx) separates CI, substantive non-author review, and merge. The API verifies a normalized GitHub PR URL. The screen shows the last confirmed PR alongside any newly submitted link, so a failed verify cannot replace confirmed evidence. Deploy Fix follows the API’s allowed actions and uses the existing idempotent mutation path. The Explore practice sample comes from the team’s missing-tier scenario and is a local review exercise.
- [IncidentCheck](../apps/web/app/morning/incident-check.tsx) opens the baseline on Night entry or before the Morning fix review. It shows score changes only after the backend records both answers. [MorningDebrief](../apps/web/app/morning/morning-after.tsx) reuses the Dana relay for voice or text after a confirmed fix. Written submission goes to the same scoring service. The backend’s rubric controls the final total. Solo collaboration is shown as N/A in the presentation while the displayed server total remains the API value.
- [The Morning bridge](../apps/web/app/api/morning/route.ts) checks the configured demo member against the incident. It forwards only supported resources and validates write payloads. Private evidence returns the signed-in demo member’s record for the current incident. Connections show pending choices and cards separately. A card is supplied only by the backend after mutual opt-in. [The request hooks](../apps/web/app/morning/use-morning-api.ts) isolate errors per panel and abort outstanding work when a panel unmounts.

## B. Data structures and algorithms

The bridge filters the private evidence list and connection lists by incident ID. For e evidence records, p pending entries and c mutual cards, it uses O(e + p + c) time and O(p + c) worst-case output space. The browser gets one evidence record and only the connection entries relevant to this incident. A backend endpoint keyed by incident would avoid transferring the rest of the member’s list to the bridge. The PR display maps a bounded CI state to a label in constant time. CI, review and merge remain independent values.

## C. System design and remaining contracts

The demo bridge keeps verification and allowed actions server-authoritative. An unavailable GitHub provider leaves a read-only candidate link and explains how to retry. The app sends no review, merge or GitHub mutation. The test fixture uses FastAPI’s existing transport seam for deterministic GitHub results. Rehearsal mode is labeled, and the local scripted Dana relay still calls the real scoring API.

Full sign-off needs the actual stage PR, a live GitHub verification run, and live Dana voice and microphone checks. The server returns reviewer count and substantive non-author review but no assigned reviewer identity. The browser can verify exclusion of the author’s own review. It cannot enforce that an independent reviewer is the assigned Morning Reviewer until the backend provides that contract. The demo bridge uses configured local identities. Production authorization and snapshot revisions remain separate dependencies.

## Verification

- Production build and typecheck passed.
- Nineteen browser cases passed across fixtures, the legacy API, the real local Night team API, and the Morning rehearsal. The two-browser Morning test covers pre-handoff access denial, a usefulness rating, practice review, unavailable GitHub with a read-only link, an unrelated green PR, pending and failed CI, self-review exclusion, a valid merged PR, Deploy Fix, before/after answers, scripted Dana debrief, private evidence, and mutual opt-in. The peer browser checked layout at 390 px.
- Eighty-one backend smoke checks and nine offline voice checks passed.
- Stage GitHub provider and live Deepgram were unverified. The Morning browser used a fixture for GitHub and real local FastAPI and Dana’s scripted relay for the rest.

**Explain it back.** Why should a failed verification keep the last confirmed PR visible while a successful local practice review leaves the incident’s deployment permission unchanged?

**Quick verification.** Run the [Morning browser rehearsal](../apps/web/README.md) and [inspect the two-browser test](../apps/web/tests/morning.spec.ts). Find the backend action list before and after the verified merge and the network result before and after the second opt-in.

## Phases 01 through 04 integration review

The merge review combined the reviewed 2D work at [537d224](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/537d2249af3a4c10246e87c12c37d3635ead2ed3) with [main at 31acc9b](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/31acc9bcf12722677a4dcb266318a88ec6f9d8dc), including Duy’s environment parsing, TLS, and frontend contract updates.

[useNightApi](../apps/web/app/night/use-night-api.ts) now falls back to 128 random bits when the browser lacks `crypto.randomUUID()`. Key generation runs within request cleanup, so a failure cannot leave actions permanently pending. A retry reuses the saved key. The [lost-response browser case](../apps/web/tests/night-api.spec.ts) disables the UUID helper and proves one Answer and one rollback despite retrying both.

The combined candidate passed the production build, typecheck, production opt-in gates, 19 browser cases, 82 backend smoke checks, and 9 offline voice checks. These checks establish the local 2D rehearsal. Role-scoped contracts and the live GitHub and Deepgram checks remain open.
