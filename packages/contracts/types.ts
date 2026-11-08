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
  ci_passed: boolean | null;
  substantive_review: boolean;
  mentor_review: string | null;
}

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
  sim_clock: string;                       // "HH:MM"
  metrics: Impact;
  loyalty_discounts: "on" | "off";
  unlocked: Panel[];
  findings: Note[];
  status_updates: Note[];
  actions_taken: string[];                 // e.g. "answer", "open_panel:logs", "hint"
  allowed_actions: ActionName[];
  hint_calls: number;
  nudge: boolean;
  stakeholder_message: string | null;
  pr: PullRequestInfo | null;
  handoff: null;                           // handoff is still to build
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
  handoff: null;
  rubric: RubricResult | null;
}

// ---- POST /api/incident/{id}/action ----
// Header: X-Demo-User: <handle> (demo mode). The relay key is refused here (403).
// 409 = not allowed now (or key reused for a different request), 422 = bad input.
export interface ActionRequest {
  action: ActionName;
  idempotency_key: string;                 // same request + same key -> same reply, applied once
  panel?: Panel;                           // open_panel
  text?: string;                           // share_finding, status_update (max 2000)
}
export interface ActionResponse { ok: true; action: ActionName; message: string; state: IncidentState }

// ---- POST /api/incident/{id}/hint  (the Dana relay calls this once per help call) ----
export interface HintResponse extends NextHint { hint_calls: number }

// ---- POST /api/debrief ----
export interface DebriefRequest { incident_id: string; answer: string } // answer max 3000 chars
export type DebriefResponse = RubricResult & { answer: string };

// ---- POST /api/demo/reset ----
export interface DemoResetRequest { level?: Level }                    // returns IncidentState
