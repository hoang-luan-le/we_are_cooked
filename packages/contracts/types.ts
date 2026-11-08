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
  author: string;                          // GitHub login, lowercase
  head_sha: string;
  ci: "success" | "failure" | "pending" | "none";
  reviewers: string[];                     // GitHub logins, author excluded
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
  | "github_off" | "bad_pr_url" | "repo_not_allowed" | "github_unavailable";
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
export interface MetricsSample extends Metrics { sim_time: string }     // "HH:MM:SS"
export interface MetricsHistory {
  samples: MetricsSample[];                // may start before the page: errors climb from the bad release
  events: { label: string; sim_time: string }[];
  baseline: Metrics;
}

// ---- POST /api/pr/verify -> IncidentState (teammates only) ----
// Reads the PR from GitHub (PILOT_REPOS only) and records it; merged + CI success unlocks deploy_fix.
// 422 bad_pr_url | repo_not_allowed, 502 github_unavailable, 503 github_off.
export interface VerifyPrRequest { incident_id: string; pr_url: string } // https://github.com/<owner>/<repo>/pull/<n>
