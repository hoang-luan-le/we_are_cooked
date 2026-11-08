STATUS: READY_FOR_REVIEW
COMMAND_ID: 06-PUBLISH-OPUS-01

# Phase 06 3D integration

Draft for Tung's merge decision. Applies the approved local build from `06-RUNTIME-OPUS-01` (approved on base `e34c11a`) to current `main`.

**Base:** `7f193f55c3306c07d9828d73591dd40663189c89` (`origin/main` when synced).
**One-writer check:** no open PRs. Sol's latest board status is `READY_FOR_REVIEW`, with no later assignment to Sol. Tung's latest assignment is this one.
**Not on this base:** Sol's `8bfea0f` and `37362f6` are on `branch-codex` only, so this branch does not include them.

## Scope

| Area | Files |
|---|---|
| 3D routes | `apps/web/app/night/3d/`, `apps/web/app/morning/3d/` |
| Runtime | `apps/web/app/world/` |
| Assets | `apps/web/public/world/` (`bedroom.glb` SHA-256 `695f4450505774a4…`, `office.glb` `9fbb8aa574db05d4…`, two fallback stills) |
| Tests | `apps/web/tests-world/`, `apps/web/playwright.world.config.ts` |
| Dependencies | `three@0.185.1`, `@types/three@0.185.1` |
| Shared 2D | `onStage` optional prop in `night-run.tsx` and `fixture-night.tsx` |

Blender sources stay on Tung's PC.

## For Sol's review

1. **`onStage` callback.** `NightRun` and `FixtureNight` gain an optional prop, 10 added lines. `NightRun` calls it from one `useEffect` keyed on `visibleStage`. Without the prop, behavior is unchanged.
2. **`three` dependency.** Loaded through a dynamic import only on `/night/3d` and `/morning/3d`. The plan named React Three Fiber and Drei. Plain three.js is one runtime dependency instead of three.

## A. Full-stack and React

- `WorldShell` in `app/world/world-shell.tsx` mounts the existing `NightRun` or `MorningWorkspace` as children, so incident state and actions stay in the 2D code. The panel is hidden with `hidden`, not unmounted, so polling and progress survive leaving a panel.
- Flow: player sits → `WorldEngine.sit()` tweens to the seat anchor → `events.onPanel()` → `openPanel` shows the mounted workspace → closing returns focus to the canvas.
- The engine starts in a `useEffect` keyed on the scene config and fallback state. Cleanup disposes the renderer, geometry, textures and listeners, and releases pointer lock.
- Alternative considered: a 3D copy of the board state. It would duplicate Sol's contract and could disagree with the 2D view.

## B. Data structures and algorithms

`app/world/collision.ts`. Let `r` be the number of collider rectangles and `n` the grid cells visited.

- `resolve` pushes a circle out of each rectangle: O(r) per pass, at most 4 passes per frame, O(1) extra space. With `r` around 45 a spatial index would add code without a measurable gain.
- `reachable` is breadth-first search used only by tests: O(n·r) time, O(n) space. Example: from the office spawn to `chair_office_ws1_approach`, it succeeds with doors open and fails with them closed.

## C. System design

- **Authority:** the backend or 2D fixture owns incident state. GLB node names are the contract between Blender and the runtime. The engine owns only camera, input and doors.
- **Failure path:** no WebGL or a failed GLB shows a still and the full 2D flow. Tested with `getContext` forced to null.
- **Trade-off:** ground-plane rectangles instead of a physics engine. The player cannot jump, so this is cheaper and testable outside the browser, but chairs block only as thin stems.

## Test results on this branch

Chrome through Playwright, Windows, NVIDIA RTX 4060 Laptop GPU. Local API means real FastAPI on SQLite, deterministic GitHub, scripted Dana.

| Mode | Check | Result |
|---|---|---|
| Build | `npm run build` | Pass |
| Typecheck | `npm run typecheck` | Pass |
| Fixture | 3D, `playwright.world.config.ts` `world.spec` | 8 of 8 |
| Fixture | 2D, default config | 13 pass, 10 opt-in skipped |
| Local API | 3D, `world-api` | 1 of 1 |
| Local API | 2D, `morning`, `team-entry`, `night-api`, `night-board` | 7 pass, 3 fail |
| Live | Deepgram, GitHub, physical microphone | Not run |

**The 3 local API failures also fail on untouched `main`.** The same 10 tests on a clean checkout of `7f193f5`, without this branch, gave the same 7 passes and the same 3 failures:

- `morning.spec.ts`: "rates the handoff…", waiting for heading `Last verified PR #13`.
- `morning.spec.ts`: "keeps Deploy unavailable…", waiting for `Passing`.
- `night-board.spec.ts`: "two demo members…", waiting for `Inspect v2.14.0 diff · Scenario fallback`.

I ran all three against the Morning FastAPI fixture and did not find the cause. Sol's `night-board` instructions name a different backend setup, so that failure may be environmental.

Frame time at 1600x900, 6-second capture: median 6.9 ms in both scenes, p99 7.1 ms. That is this display's 144 Hz limit, so true headroom is unknown. Peak draw calls: 86 bedroom, 288 office. GLB transfer: 3,106 kB and 1,193 kB.

## Remaining checks

Manual: movement feel by hand, demo-laptop performance, real touch devices, Firefox and Safari.
Rehearsal: four-browser rehearsal in 3D. The script is not in this repository.
Live: Deepgram, GitHub pilot PR, physical microphone.
Sol: `onStage`, `three`, and the 3 failures above.
Content: Morning has no spoken Dana briefing in the 2D contract, so "Dana's briefing" opens the Night handoff.
Later polish, separately assigned: wake-up and continuous movement animations.

**Teach-back:** why does the 3D Answer button need no new backend code?
**Verify:** from `apps/web`, run `npm run build`, then `npx playwright test -c playwright.world.config.ts world.spec`. Set `CHROMIUM_EXECUTABLE_PATH` to use an installed Chrome.
