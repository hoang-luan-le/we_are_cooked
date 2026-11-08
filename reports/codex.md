STATUS: BLOCKED
COMMAND_ID: 02-LANDING-ENTRY-01

# Phase 02 Landing and Entry

The fixture slice is ready for review. Live entry awaits the backend cohort, membership, and session contract. Base commit is [a001c30](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/a001c302de04c7a02a795ebd45b6062c45d8fbc1). [Phase 01 handoff](https://github.com/thanhtungnguyen-dev/we_are_cooked/blob/a001c302de04c7a02a795ebd45b6062c45d8fbc1/reports/codex.md)

## A. Full-stack and React

- [Landing](../apps/web/app/page.tsx) links to [StartPage](../apps/web/app/start/page.tsx). The server wrapper reuses the Phase 01 demo gate and makes the existing local API demo link available only when configured. App Router navigation and prefetch read routes. Start and Join persist an exercise only from a button or form event.
- [EntryForm](../apps/web/app/start/entry-form.tsx) uses state for the level, code, errors, and navigation. Its mount effect reads the existing browser entry after hydration. The initial server render can show the same loading text as the first browser render. Reading browser storage in render would produce different results on the server and browser. Explore adds a checklist. Practice and Challenge are persisted choices within the shared Night scenario.
- [FixtureNight](../apps/web/app/night/fixture-night.tsx) checks the URL identifier against the saved entry after hydration. [NightRun](../apps/web/app/night/night-run.tsx) starts at the answered stage when resuming. [IncidentBoard](../apps/web/app/night/incident-board.tsx) stores the time of rollback and derives the completed samples when reopened. The effect schedules the next sample from that timestamp and clears its timer on unmount.

## B. Data structures and algorithms

[FixtureEntry](../apps/web/app/night/fixture-entry.ts) stores one versioned record with an ID, level, entry kind, Answer state, and rollback timestamp. The loader checks its shape. The ID prevents a stale link from opening the exercise that replaced it. The same check protects progress updates from a different open exercise ID.

Code normalization trims and uppercases an input of length n in O(n) time and space. Comparing the normalized input with the two fixture codes is bounded by those short strings. The roster is a static array of m names and roles with O(m) rendering time. The recovery function scans the k recovery samples in O(k) time with constant auxiliary space. With three samples, reconstructing progress from a single timestamp is simpler than saving every intermediate point or building a replay log.

## C. System design and limits

The development fixture deliberately stores one exercise per browser. The fixture cohort code and roster demonstrate invalid, expired, and accepted entry and provide a scenario role. The local API path resumes the configured shared incident through the existing Phase 01 proxy. It uses the backend snapshot for incident actions and recovery.

A real cohort should provide join and resume responses bound to an authenticated member and incident. The server decides the assigned role and visible roster. Duy's contract needs the join result, invalid and expired responses, role and member fields, and how a refreshed session resumes. A browser fixture can exercise the interface while those shapes are pending. The API demo stays on the existing incident so a frontend Start action cannot reset teammates' work.

## Checks

| Check | Outcome |
| --- | --- |
| `npm run build` and `npm run typecheck` from `apps/web` | Passed. |
| `npm run test:browser -- tests/entry.spec.ts tests/night.spec.ts` with Chromium 153 | 9 passed. Includes keyboard entry, mobile join, invalid and expired code recovery, fixture roster and role, stale link recovery, refresh during rollback, and Phase 01 regression checks. |
| `NIGHT_TEST_API_ORIGIN=http://127.0.0.1:3213 npm run test:browser -- tests/night-api.spec.ts` | 1 passed with local FastAPI and a mocked Dana socket. The entry link resumes the API demo and the rollback retry still applies once. |
| Production `/start` with `NIGHT_FIXTURES` unset | Development entry controls are gated. |

**Explain it back.** Why does saving the rollback start time let a refreshed browser reconstruct the current fixture stage?

**Quick verification.** Open Start simulation, try `NIGHT00`, then join with `NIGHT24`. Answer Dana, roll back, and refresh. Open the roster and check the role. [Run commands](../apps/web/README.md)
