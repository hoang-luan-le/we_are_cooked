STATUS: BLOCKED
COMMAND_ID: 03-NIGHT-BOARD-01

# Phase 03 Shared Night board quality review

The implemented local Night board scores **92/100** and is ready to review. The full checkpoint remains blocked on role and revision contracts. This follow-up starts at [9cc04a3](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/9cc04a3a921353e4c18d82e796b6f4829ba5914b). The [panel and handoff integration report](https://github.com/thanhtungnguyen-dev/we_are_cooked/blob/9cc04a3a921353e4c18d82e796b6f4829ba5914b/reports/codex.md) documents the original flow against [Duy’s P0 backend](https://github.com/hoang-luan-le/we_are_cooked/commit/474623ac2d5f6905714efc5012efe9c6066a320f).

## A. Full-stack and React

- [useNightApi](../apps/web/app/night/use-night-api.ts) clears the cached incident and action retry state when the team bridge confirms access loss. A temporary failure keeps the last snapshot and disables mutations. [Night panels](../apps/web/app/night/night-panels.tsx) also discard denied data, while a failed refresh can retain the last allowed result. The browser test removes an actual Morning teammate and confirms the shared note disappears.
- [NightHandoff](../apps/web/app/night/night-handoff.tsx) captures the shared note and initial editor values on open. When polling observes another save, the draft stays in place and Save requires explicit review of the newer note. If a save response is lost, a later snapshot with the same normalized payload and author confirms the draft is already shared. The editor permits closing that draft without sending a second write.
- [NightRun](../apps/web/app/night/night-run.tsx) displays the configured demo handle and team roster. After closing Help, it hides the call controls until a fresh read arrives. The refresh aborts a previous read when possible. This keeps a stale nudge from inviting another Help call. Help stays on one text relay socket and Debrief stays gated on the deployed fix. The [caption log](../apps/web/app/night/dana-briefing.tsx) separates programmatic scrolling from user scrolling so a burst of captions follows the latest line without pulling the user away from earlier lines.

## B. Data structures and algorithms

The handoff editor serializes the four text fields, author, simulated timestamp, optional morning handles and rating into a local comparison key. For n characters, building and comparing the key takes O(n) time and O(n) extra space. The handoff has a bounded size and the backend exposes no version. A server revision would make the precondition smaller and, more importantly, let the server reject a simultaneous overwrite before committing it. The browser comparison only catches changes it has already observed.

## C. Readiness score and remaining contracts

This review uses the same 100-point weighting as the Phase 01 and Phase 02 follow-up. Each score below reflects the tested local flow. The final eight points require full backend and provider evidence and received zero credit.

| Criterion | Weight | Phase 03 evidence |
| --- | ---: | --- |
| Core player flow | 30 | **30**. Two team members opened API evidence, shared findings, saw one rollback recover, and exchanged the typed handoff. |
| Failure and resume | 22 | **22**. Same-key finding and rollback retry, denied panel cache removal, former member access loss, preserved drafts, and lost handoff acknowledgement. |
| Keyboard, touch and layout | 15 | **15**. Panel focus, keyboard-accessible details, clipboard, handoff focus, existing touch cases, and the shared board at 390 px. |
| Feedback and state clarity | 15 | **15**. Source labels, separate live and historical metrics, current identity, local panel errors, draft conflict, caption following through bursts, and no stale nudge after Help. |
| Build and regression evidence | 10 | **10**. Production build, typecheck, 18 browser cases, 81 backend smoke checks, and 9 offline voice checks. The caption burst case passed 16 repeated runs. |
| Live and full contract evidence | 8 | **0**. Per-member Night roles, role-scoped authorization and evidence, snapshot revisions and write preconditions, live GitHub diff and Deepgram verification remain open. |
| **Total** | **100** | **92** |

The panel bridge checks membership and unlocks for its own demo reads. Direct API reads and the relay still need authenticated member scope for production. Help uses the scripted relay in the local test. The browser verified the Debrief gate with a simulated fixed incident.

**Explain it back.** Why can the browser warn about an edit that arrived on the last poll while only the API can safely reject two simultaneous saves?

**Quick verification.** Run the [two-browser setup](../apps/web/README.md) and [Night board checks](../apps/web/tests/night-board.spec.ts). Compare the screen after a temporary outage with the screen after the former teammate receives an authoritative denial.
