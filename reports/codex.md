STATUS: READY_FOR_REVIEW
COMMAND_ID: 02-LANDING-ENTRY-01

# Phase 02 Landing and Entry

Base on the fork is [a001c30](https://github.com/thanhtungnguyen-dev/we_are_cooked/commit/a001c302de04c7a02a795ebd45b6062c45d8fbc1). Team entry was verified against Duy's backend at [05ecda9](https://github.com/hoang-luan-le/we_are_cooked/commit/05ecda9c55620412e1c2c6b8da648623dad8283d). [Phase 01 handoff](https://github.com/thanhtungnguyen-dev/we_are_cooked/blob/a001c302de04c7a02a795ebd45b6062c45d8fbc1/reports/codex.md)

## A. Full-stack and React

- [StartPage](../apps/web/app/start/page.tsx) selects the available entry mode on the server. [EntryForm](../apps/web/app/start/entry-form.tsx) renders difficulty, Explore guidance and the development fixture. Browser storage reads run after hydration. The effect subscribes to storage changes and page restoration and removes listeners on cleanup. Only explicit Start or Join writes fixture progress.
- [FixtureNight](../apps/web/app/night/fixture-night.tsx) checks the link ID against the saved entry. A replaced ID leaves the old route, and a duplicate or ambiguous query cannot fall through to the shared demo. [NightRun](../apps/web/app/night/night-run.tsx) records Answer, briefing completion, and rollback as separate transitions. Legacy Answer-only records continue to the board.
- [TeamEntry](../apps/web/app/start/team-entry.tsx) uses a ref to prevent overlapping submissions and React state for visible progress, roster, and errors. The browser calls the [same-origin entry bridge](../apps/web/app/api/night/entry/route.ts). The bridge validates the request and calls the team API with the configured local demo identity. Joining returns a roster. A separate Start sends the chosen level and selected handles and returns a new incident ID. [The incident bridge](../apps/web/app/api/night/route.ts) checks team membership on reads and forwards actions to the selected incident.

## B. Data structures and algorithms

[FixtureEntry](../apps/web/app/night/fixture-entry.ts) keeps one versioned record. Validated transitions preserve the first rollback timestamp and prevent reopening a completed briefing in storage. [IncidentBoard](../apps/web/app/night/incident-board.tsx) derives recovery by walking k timestamp offsets in O(k) time and O(1) auxiliary space. A team roster is a list of m member handles and the selection is an array of at most three handles. Rendering the list takes O(m) time and checking or removing a selected handle takes at most three comparisons.

## C. System design and limits

The development fixture covers invalid and expired invitations and displays a simulated role. The team API supports real join, member lookup, incident creation and lookup by ID. The UI treats the backend as the authority for the roster, membership and incident state. Browser storage remembers links scoped by demo handle. The team API currently exposes no role assignment, expiry semantics, account-wide incident discovery or revision. Start also lacks an idempotency key. A failed acknowledgement can leave an incident created without a known ID, so the UI explains the consequence of retrying.

The fork's existing backend and shared demo route stay compatible. Opt in to team entry only when running the compatible team backend on loopback. Team entry is a local demo flow with a configured identity. An authenticated deployment requires member-scoped state and relay authentication. The team server currently exposes state reads directly without authentication.

## Checks

- Production build and typecheck passed.
- Twelve fixture and Night browser checks passed. These include briefing refresh, legacy storage, tab replacement, blocked storage, mobile join, rollback recovery, and voice lifecycle.
- One browser check against the fork's actual local FastAPI passed with a mocked Dana socket. One browser check against the team's actual local FastAPI passed for cohort join, roster restore, team incident creation, resume, and the bridge's nonmember response.
- The production opt-in gate passed.

**Explain it back.** Why does refreshing a fixture replay its scripted briefing while refreshing an API incident reads the server?

**Quick verification.** Start solo in fixture mode, answer Dana, and refresh while the captions are visible. Continue to the board and refresh again. [Run instructions](../apps/web/README.md)
