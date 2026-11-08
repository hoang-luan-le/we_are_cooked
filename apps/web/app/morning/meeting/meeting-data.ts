"use client";

import { useEffect, useState } from "react";
import type { DeployHistory, LogLine, MetricsHistory, PullRequestInfo } from "../../../../../packages/contracts/types";
import { DEPLOYS, HISTORY, LOGS } from "../../night/fixture";
import type { NightIncident } from "../../night/use-night-api";
import type { MeetingInput } from "./meeting-script";

type Evidence = Pick<MeetingInput, "impact" | "release" | "errorLog">;
const none: Evidence = { impact: null, release: null, errorLog: null };

async function read<T>(incident: string, panel: string, extra = "") {
  try {
    const response = await fetch(`/api/night/panels?incident=${encodeURIComponent(incident)}&panel=${panel}${extra}`, { cache: "no-store" });
    return response.ok ? await response.json() as T : null; // A locked panel means nobody reviewed it overnight.
  } catch {
    return null;
  }
}

/** Reads the same Night panels the board uses. Each is honest about being unavailable. */
export function useMeetingEvidence(incident: string | undefined, ready: boolean) {
  const [evidence, setEvidence] = useState(none);
  useEffect(() => {
    if (!incident || !ready) return;
    let stale = false;
    void Promise.all([
      read<MetricsHistory>(incident, "history"), read<DeployHistory>(incident, "deploys"),
      read<{ lines: LogLine[] }>(incident, "logs", "&severity=ERROR"),
    ]).then(([history, deploys, logs]) => {
      if (stale) return;
      const samples = history?.samples ?? [];
      const bad = deploys?.releases.find(release => release.day === "tonight");
      setEvidence({
        impact: samples.length && history ? {
          peakErrorRate: Math.max(...samples.map(s => s.error_rate)), lowestOrders: Math.min(...samples.map(s => s.orders_per_min)),
          baselineErrorRate: history.baseline.error_rate, baselineOrders: history.baseline.orders_per_min,
        } : null,
        release: bad ? { version: bad.version, at: bad.at, title: bad.title } : null,
        errorLog: logs?.lines[0]?.message ?? null,
      });
    });
    return () => { stale = true; };
  }, [incident, ready]);
  return evidence;
}

export function liveInput(incident: NightIncident, evidence: Evidence): MeetingInput {
  const handoff = incident.handoff;
  return {
    source: "Local API", ...evidence, recovered: incident.status !== "broken", discounts: incident.loyalty_discounts,
    findings: incident.findings.map(note => ({ by: note.by, text: note.text })),
    handoff: handoff ? { by: handoff.by, at: handoff.sim_clock, whatHappened: handoff.what_happened, currentState: handoff.current_state, tried: handoff.tried, risks: handoff.risks } : null,
  };
}

export function fixtureInput({ evidenceMissing, handoffMissing }: { evidenceMissing: boolean; handoffMissing: boolean }): MeetingInput {
  const peak = HISTORY.reduce((a, b) => (b.errorRate > a.errorRate ? b : a));
  return {
    source: "Fixture", recovered: true, discounts: "off",
    handoff: handoffMissing ? null : {
      by: "Riley (fixture)", at: "02:31",
      whatHappened: "Guest checkout failed for about a third of shoppers during the flash sale.",
      currentState: "Checkout recovered after the rollback. Loyalty discounts are off.",
      tried: "Rolled back from v2.14.0 to v2.13.9.",
      risks: "Discounts stay off until a permanent fix ships.",
    },
    findings: evidenceMissing ? [] : [{ by: "Morgan (fixture)", text: "The failures are all guest checkouts." }],
    impact: evidenceMissing ? null : { peakErrorRate: peak.errorRate, lowestOrders: peak.ordersPerMinute, baselineErrorRate: HISTORY[0].errorRate, baselineOrders: HISTORY[0].ordersPerMinute },
    release: evidenceMissing ? null : { version: DEPLOYS[0].version, at: DEPLOYS[0].time, title: DEPLOYS[0].title },
    errorLog: evidenceMissing ? null : `${LOGS[0].time} POST /checkout 500 for guest checkouts`,
  };
}

export function fixturePr(state: string | undefined): PullRequestInfo | null {
  if (state !== "pending" && state !== "failed" && state !== "verified") return null;
  return {
    number: 12, url: "https://github.com/shopnorth/shopnorth-checkout/pull/12", head_sha: "fixture", merged: state === "verified",
    ci: state === "pending" ? "pending" : state === "failed" ? "failure" : "success",
    review_count: state === "verified" ? 1 : 0, substantive_review: state === "verified", mentor_review: null,
  } as PullRequestInfo;
}

export function prStatusLines(pr: PullRequestInfo | null | undefined) {
  if (!pr) return ["Waiting: no pull request has been verified yet."];
  const ci = { success: "Passing", failure: "Failed", pending: "Pending", none: "No result" }[pr.ci];
  return [`Pull request #${pr.number}`, `CI: ${ci}`, `Review: ${pr.substantive_review ? "Recorded" : "Pending"}`, `Merge: ${pr.merged ? "Merged" : "Not merged"}`];
}

const key = (run: string) => `incident-lab.meeting.v1.${run}`;

export function loadProgress(run: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key(run)) ?? "null") as { index: number; complete: boolean } | null;
    if (value && Number.isInteger(value.index) && value.index >= 0 && value.index < 6) return value;
  } catch {
    // Storage can be blocked. The meeting still runs from the start.
  }
  return { index: 0, complete: false };
}

export function saveProgress(run: string, value: { index: number; complete: boolean }) {
  try { localStorage.setItem(key(run), JSON.stringify(value)); } catch { /* Progress stays in this tab. */ }
}
