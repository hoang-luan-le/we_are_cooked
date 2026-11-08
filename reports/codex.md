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
