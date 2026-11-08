STATUS: READY_FOR_REVIEW
COMMAND_ID: 01-02-QUALITY-01

# Phase 01 and Phase 02 quality review

[Phase 01 Night 2D](https://github.com/thanhtungnguyen-dev/we_are_cooked/pull/2) and [Phase 02 Landing and Entry](https://github.com/thanhtungnguyen-dev/we_are_cooked/pull/3) are separate merged checkpoints. This follow-up starts at [2b0a441](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/2b0a4415a762ff582a05fec9a9cff72876bba7ef) on branch-codex. [Phase 03 report](https://github.com/thanhtungnguyen-dev/we_are_cooked/blob/2b0a4415a762ff582a05fec9a9cff72876bba7ef/reports/codex.md)

## A. Full-stack and React

- **Phase 01.** [NightRun](../apps/web/app/night/night-run.tsx) keeps a pending or unconfirmed Answer on the call screen when polling reports an advanced incident. A retry uses the existing idempotency key and opens the relay after the backend confirms it. The player can also open the board directly when the incident has already advanced. The [Dana panel](../apps/web/app/night/dana-briefing.tsx) keeps captions, the unsent draft and keyboard focus while changing modes. [The connection](../apps/web/app/night/dana-connection.ts) normally drains queued audio, with a separate user action to skip a suspended queue. The [fixture board](../apps/web/app/night/incident-board.tsx) applies the version and discount changes at rollback confirmation while metrics recover over time.
- **Phase 02.** The [landing](../apps/web/app/page.tsx) uses server-rendered values from the existing scenario and keeps its navigation free of writes. [EntryForm](../apps/web/app/start/entry-form.tsx) uses a synchronous ref to guard the fixture save and visible state to show its pending transition. [TeamEntry](../apps/web/app/start/team-entry.tsx) verifies the remembered incident through the member-scoped local bridge. Its effect aborts on exit. An authoritative 404 removes the matching saved pointer. A transient failure keeps the link. The roster can be refreshed without losing selections that are still present. The effect cancels a prior lookup when a new Join begins.

## B. Data structures and algorithms

The Dana connection already maintains a Set of scheduled audio sources. An explicit skip visits n queued sources in O(n) time with O(1) extra space and calls the same terminal cleanup as normal completion. Team entry filters at most three selected handles against the refreshed roster of m handles in O(m) time with a constant-size result. A precomputed Set would allocate O(m) extra space for a lookup that happens only during refresh.

## C. System design and scored evidence

The 100-point readiness rubric below was derived for this review from the frontend plan, UI rules, and current product scope. It prioritizes completed player flows and failure recovery. Phase 01 and Phase 02 were scored separately on the tested branch. Unverified provider and backend contract checks received zero credit.

| Criterion | Weight | Phase 01 | Phase 02 |
| --- | ---: | --- | --- |
| Core player flow | 30 | 30. Answer, caption, inspect, rollback and recover. | 30. Landing, difficulty, fixture entry, local cohort join, team start and resume. |
| Failure and resume | 22 | 22. Same-key Answer and rollback retries, denied mic, relay fallback, and normal drain or explicit skip. | 22. Invalid and fixture-expired codes, legacy saves, stale links, browser storage rejection, and temporary API failures. |
| Keyboard, touch and layout | 15 | 15. Focusable captions, rollback dialog Escape and focus return, mobile actions, reflow. | 15. Keyboard and touch entry, visible selection and CTA, responsive preview and form. |
| Feedback and state clarity | 15 | 15. Explicit relay mode, disabled controls during pending work, and distinct recovering and recovered states. | 15. Scenario versus local API labels, pending navigation, resume priority, refreshed roster and recovery messages. |
| Build and regression evidence | 10 | 10. Production build, typecheck, and browser suites passed. | 10. Production gate and both entry modes passed browser checks. |
| Live and full contract evidence | 8 | 0. Live Deepgram, physical microphone and fully sourced panel details remain open. | 0. Server-assigned roles, invite expiry, account-wide resume, and revisions remain open. |
| **Total** | **100** | **92** | **92** |

## Verification

- Production build and typecheck passed. Seventeen browser cases passed across the fixture, legacy FastAPI, and two-member team FastAPI configurations. The live-API browser check deliberately lost both an Answer and a rollback acknowledgement and confirmed one backend action for each.
- Chromium layout checks passed at 320, 390, and 1440 pixels with reduced motion. The landing, entry and Night dashboard had no horizontal overflow or page errors. The production opt-in gate passed.
- The two-member regression used the actual local scripted Dana relay. Browser audio tests used synthetic mic and PCM. Live Deepgram and device audio were outside the available evidence.

**Explain it back.** Why does a failed network response after Answer require the same key on retry, while an unavailable saved link can be removed only after an authoritative 404?

**Quick verification.** Run the [browser setup](../apps/web/README.md) and [lost-response test](../apps/web/tests/night-api.spec.ts). Compare the outbound keys with the incident action history.
