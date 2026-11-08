// Incident state contract. Change only via a reviewed PR from everyone who depends on it
// (Backend + Frontend + AI). Real responses: incident_state.example.json, dana_facts.example.json.
// Source of truth for the shapes: services/api/engine/views.py.

import type { Level } from "./dana";
export type { Level };

export type Phase =
  | "paged" | "investigating" | "mitigating" | "stabilized"
  | "handed_off" | "fixed" | "debriefed";
export type Status = "broken" | "rolled_back" | "fixed";
export type Panel = "dashboard" | "logs" | "deploys" | "runbook";
export type ActionName =
  | "answer" | "snooze" | "open_panel" | "share_finding" | "status_update"
  | "rollback" | "restart" | "scale" | "restart_search" | "deploy_fix";

export interface Metrics { error_rate: number; orders_per_min: number; p95_ms: number }
export interface Impact extends Metrics { baseline: Metrics }

export interface Note { by: string; text: string; sim_clock: string }
export interface Fact { source: string; topic: string; text: string }
export interface TopicText { topic: string; text: string }
export interface NextHint { topic: string | null; hint: string }

export interface PullRequestInfo {
  number: number;
  merged: boolean;
  ci_passed: boolean | null;               // null = CI running or not found
  substantive_review: boolean;             // a non-author review with 40+ chars or inline comments
  mentor_review: string | null;            // GitHub login of the mentor (MENTOR_GITHUB) who reviewed
  url: string;
  head_sha: string;
  ci: "success" | "failure" | "pending" | "none";
  review_count: number;                    // reviewers other than the author; only the mentor is named
}

// ---- shift handoff (typed; night pair writes, morning pair rates) ----
export type RatingScore = 1 | 2 | 3 | 4 | 5;                // 4-5 counts as a clear handoff in the rubric
export interface HandoffRating { by: string; score: RatingScore; note: string; sim_clock: string }
export interface HandoffParts {
  what_happened: string;
  current_state: string;
  tried: string;                           // what was tried
  risks: string;                           // what is still risky
}
export interface Handoff extends HandoffParts {
  by: string;
  night_pair: string[];                    // handles who acted before the handoff; they can't rate it
  morning_pair: string[];                  // named by the night pair; only they rate (if empty: any other teammate)
  sim_clock: string;
  rating: HandoffRating | null;            // once rated, the note is locked
}

// ---- errors: every engine rejection (409/422) ----
export type ErrorCode =
  | "answer_first" | "already_rolled_back" | "pr_not_ready" | "not_allowed_now" | "unknown_action"
  | "unknown_panel" | "text_required" | "text_too_long" | "idempotency_conflict" | "debrief_not_ready"
  | "handoff_not_ready" | "handoff_incomplete" | "handoff_rated" | "not_night_pair" | "night_pair_cannot_rate"
  | "no_handoff" | "not_teammate" | "unknown_handle" | "not_morning_pair"
  | "github_off" | "bad_pr_url" | "repo_not_allowed" | "github_unavailable"
  | "not_participant" | "not_a_teammate" | "unknown_choice" | "check_closed" | "check_not_ready"
  | "handle_required" | "handle_taken" | "handle_already_set" | "bad_handle" | "not_signed_in"
  | "pr_wrong_base" | "pr_not_a_fix" | "pr_too_old" | "pr_already_linked";
export interface ApiError { code: ErrorCode; detail: string }        // auth/404/validation errors have only `detail`

// ---- rubric (0/2/4 each, out of 20) ----
export type Criterion = "diagnosis" | "mitigation" | "validation" | "communication" | "collaboration";
export interface CommunicationEvidence { impact: boolean; cause: boolean; action: boolean; risk: boolean }
export interface Score {
  score: 0 | 2 | 4;
  reason: string;                          // one short sentence, safe to read out loud
  evidence: string | CommunicationEvidence;
}
export interface Pending { pending: true }
export interface RubricResult {
  rubric: Record<Criterion, Score | Pending>; // communication is Pending until the debrief
  total: number;
  out_of: 20;
  final: boolean;
}

// ---- GET /api/incident/{id}  (Frontend polls every 2-3 s) ----
export interface IncidentState {
  incident_id: string;
  level: Level;
  phase: Phase;
  status: Status;
  ringing: boolean;                        // phone rings while paged, except 15 s after a snooze
  sim_clock: string;                       // "HH:MM"
  metrics: Impact;
  loyalty_discounts: "on" | "off";
  unlocked: Panel[];
  findings: Note[];
  status_updates: Note[];
  actions_taken: string[];                 // e.g. "answer", "open_panel:logs", "hint"
  allowed_actions: ActionName[];
  teammates: string[];                     // who may act: starting teammates + the handoff's morning pair
  hint_calls: number;
  nudge: boolean;
  stakeholder_message: string | null;
  pr: PullRequestInfo | null;
  handoff: Handoff | null;
  rubric: RubricResult | null;
}

// ---- GET /api/incident/{id}/facts  (Dana's only source; no answer key) ----
export interface DanaFacts {
  incident_id: string;
  level: Level;
  phase: Phase;
  sim_clock: string;
  impact: Impact;
  dana_knows: TopicText[];
  unlocked: Panel[];
  facts: Fact[];
  findings: Note[];
  next_hint: NextHint;
  actions_taken: string[];
  hint_calls: number;
  nudge: boolean;
  stakeholder_message: string | null;
  status: Status;
  handoff: Handoff | null;
  rubric: RubricResult | null;
}

// ---- POST /api/incident/start -> 201 IncidentState (X-Demo-User only) ----
// The caller is always a teammate. 422 unknown_handle if a teammate isn't a known handle.
export interface StartIncidentRequest { level?: Level; teammates?: string[] }   // up to 3 others

// ---- POST /api/incident/{id}/action ----
// Only teammates (403 not_teammate). inc_demo's teammates are the whole DEMO_TEAM.
// Header: X-Demo-User: <handle> (demo mode). The relay key is refused here (403).
// 409 = not allowed now (or key reused for a different request), 422 = bad input; both are ApiError.
export interface ActionRequest {
  action: ActionName;
  idempotency_key: string;                 // same request + same key -> same reply, applied once
  panel?: Panel;                           // open_panel
  text?: string;                           // share_finding (max 280), status_update (max 500)
}
export interface ActionResponse { ok: true; action: ActionName; message: string; state: IncidentState }

// ---- POST /api/incident/{id}/hint  (the Dana relay calls this once per help call) ----
export interface HintResponse extends NextHint { hint_calls: number }

// ---- POST /api/debrief ----
export interface DebriefRequest { incident_id: string; answer: string } // answer max 3000 chars
export type DebriefResponse = RubricResult & { answer: string };

// ---- POST /api/demo/reset ----
export interface DemoResetRequest { level?: Level }                    // returns IncidentState

// ---- handoff routes (X-Demo-User only; the relay key gets 403) ----
// POST /api/incident/{id}/handoff -> IncidentState. 409 until phase is stabilized; the night
//   pair may edit until it's rated. Phase becomes "handed_off".
export interface HandoffRequest extends HandoffParts {                // each part 1-1000 chars
  morning_pair?: string[];                 // up to 4 handles; they may act and rate. Editing replaces it.
}
// GET /api/incident/{id}/handoff -> Handoff (404 if none yet)
// POST /api/incident/{id}/handoff/rating -> Handoff. 409 if you're in night_pair.
export interface HandoffRatingRequest { score: RatingScore; note?: string }                    // note: one line, max 200

// ---- cohorts (X-Demo-User only; members-only, non-members get 404) ----
export interface CohortMember { handle: string }                        // pseudonymous handles only
export interface Cohort { id: string; name: string; join_code: string; created_by: string; members: CohortMember[] }
export interface CreateCohortRequest { name: string }                   // POST /api/cohorts -> 201 Cohort
export interface JoinCohortRequest { join_code: string }                // POST /api/cohorts/join -> Cohort (case/space-insensitive)
// GET /api/cohorts/{id} -> Cohort

// ---- panels (GET, no auth; open_panel via /action still unlocks Dana's facts) ----
// GET /api/incident/{id}/logs?limit=1..200&level=INFO|WARN|ERROR&q=text -> { lines: LogLine[] } (oldest first)
export interface LogLine { time: string; level: "INFO" | "WARN" | "ERROR"; service: string; message: string }
// GET /api/incident/{id}/deploys -> DeployHistory
export interface DeployFile { filename: string; patch: string }          // unified diff hunk(s)
export interface Release {
  version: string; at: string; day: string; author: string; title: string;
  live: boolean;
  diff_source: "github" | "scenario";      // scenario = offline fallback, same diff
  files: DeployFile[];
}
export interface DeployHistory { live_version: string; releases: Release[] }
// GET /api/incident/{id}/runbooks -> { runbooks: {name, title}[] };  GET .../runbooks/{name} -> Runbook
export interface Runbook { name: string; title: string; steps: string[] }
// GET /api/incident/{id}/metrics/history?window_s=5..3600&step_s=5..300 -> MetricsHistory
export interface MetricsSample extends Metrics {
  sim_time: string;                        // "HH:MM:SS"
  source: "tigerdata" | "computed";        // tigerdata = read from the incident_metrics hypertable
}
export interface MetricsHistory {
  source: "tigerdata" | "computed";        // tigerdata when any sample came from Tiger Data
  samples: MetricsSample[];                // may start before the page: errors climb from the bad release
  events: { label: string; sim_time: string }[];
  baseline: Metrics;
}

// ---- POST /api/pr/verify -> IncidentState (teammates only) ----
// Reads the PR from GitHub (PILOT_REPOS only) and records it; merged + CI success unlocks deploy_fix.
// Only a fix for THIS incident counts: base = main, changes code under checkout/, opened after the page.
// 422 bad_pr_url | repo_not_allowed | pr_wrong_base | pr_not_a_fix | pr_too_old,
// 409 pr_already_linked (a merged fix can't be swapped), 502 github_unavailable, 503 github_off.
export interface VerifyPrRequest { incident_id: string; pr_url: string } // https://github.com/<owner>/<repo>/pull/<n>

// ---- profile, connections, network, evidence (privacy: users may be minors) ----
// GET /api/me, PATCH /api/me (send only the fields you change; null clears) -> Me
export interface Me { handle: string; github_login: string | null; contact: string | null; public_evidence: boolean }
export interface ProfilePatch {
  github_login?: string | null;
  contact?: string | null;                 // max 120
  public_evidence?: boolean;               // opt in to GET /api/evidence/{handle}; off by default
}
// POST /api/connections -> { ok, incident_id, to_user, work_again }. Private: never reveals the other answer.
// Only people who took part (acted, or rated the handoff); being named isn't enough.
// 409 not_participant, 422 not_a_teammate.
export interface ConnectionRequest { incident_id: string; to_user: string; work_again: boolean; note?: string }
// GET /api/connections/pending -> { pending: { incident_id: string; handle: string }[] }
// GET /api/network -> { cards: NetworkCard[] }  (only where BOTH said yes; contact appears only here)
export interface NetworkCard {
  handle: string; incident_id: string;
  basis: { level: Level; phase: Phase; pr_url: string | null };
  contact: string | null; github_login: string | null;
}
// GET /api/me/evidence -> Evidence (your own, always).
// GET /api/evidence/{handle} -> Evidence, only if that person opted in (404 otherwise).
// Handles only: never contact details or GitHub logins.
export interface IncidentEvidence {
  incident_id: string; level: Level; phase: Phase; status: Status;
  role: "night" | "morning" | "teammate";
  findings_shared: number; status_updates: number;
  handoff_rating: number | null;
  pr: { url: string; merged: boolean; ci: PullRequestInfo["ci"]; reviewers: number; mentor_reviewed: boolean } | null;
  rubric: RubricResult | null;
}
export interface Evidence { handle: string; incidents: IncidentEvidence[]; connections: number }

// ---- GET /api/jobs (no auth) -> JobsSnapshot ----
// Real Adzuna listings saved before the demo by `python adzuna.py`; shows even if Adzuna is down.
// No snapshot yet -> fetched_at null, searches [], plus `message`. Never invented.
export interface JobListing {
  title: string; company: string; location: string; created: string; url: string;
  salary_min: number | null; salary_max: number | null;
}
export interface JobsSnapshot {
  source: "Adzuna"; fetched_at: string | null;   // ISO date: show it ("listings as of ...")
  searches: { what: string; count: number; listings: JobListing[] }[];
  message?: string;
}

// ---- before/after check: GET /api/checks?incident_id=..., POST /api/checks -> CheckView (teammates only) ----
// Same question before and after. Scores appear only once both are answered.
// 409 check_not_ready (after: checkout must be stable and "before" answered), check_closed; 422 unknown_choice.
export interface CheckRequest { incident_id: string; stage: "before" | "after"; choice: string; explanation?: string }
export interface CheckAnswer { choice: string; explanation: string; score?: 0 | 2 | 4 }
export interface CheckView {
  incident_id: string; question: string; choices: { id: string; text: string }[];
  before: CheckAnswer | null; after: CheckAnswer | null;
  improved: number | null;                 // after.score - before.score, once both are in
}

// ---- sign-in ----
// Demo mode (AUTH0_DOMAIN empty): header X-Demo-User: <handle from DEMO_TEAM>.
// Auth0 mode: header Authorization: Bearer <Auth0 access token for AUTH0_AUDIENCE>; X-Demo-User is refused (401).
// First sign-in: every route answers 403 handle_required until POST /api/me/handle -> Me.
// Handles are pseudonymous: 1-32 of [a-z0-9_-]. The Auth0 account id is never shown to anyone.
export interface ClaimHandleRequest { handle: string }  // 409 handle_taken | handle_already_set, 422 bad_handle
