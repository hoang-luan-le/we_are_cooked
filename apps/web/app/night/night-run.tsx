"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DanaBriefing } from "./dana-briefing";
import { IncidentBoard } from "./incident-board";
import { type NightAction, useNightApi } from "./use-night-api";

export function NightRun({ apiUser, relayBase }: { apiUser?: string; relayBase?: string }) {
  const [stage, setStage] = useState<"page" | "briefing" | "board">("page");
  const [snoozed, setSnoozed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const api = useNightApi(Boolean(apiUser));
  const incident = api.snapshot?.incident;
  const visibleStage = incident
    ? incident.phase === "paged" ? "page" : stage === "briefing" ? "briefing" : "board"
    : stage;

  useEffect(() => {
    if (visibleStage !== "page") heading.current?.focus();
  }, [visibleStage]);

  useEffect(() => {
    if (!snoozed || visibleStage !== "page") return;
    const timer = window.setTimeout(() => setSnoozed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [visibleStage, snoozed]);

  async function perform(intent: NightAction) {
    if (apiUser && !await api.act(intent)) return false;
    if (intent.action === "answer") setStage("briefing");
    if (intent.action === "snooze") setSnoozed(true);
    return true;
  }

  return (
    <>
      <header className="app-header">
        <Link href="/">Incident Lab</Link>
        <span className="badge fixture">{apiUser ? "Local demo API" : "Development fixture"}</span>
      </header>
      <main className={visibleStage === "board" ? "workspace" : "call-layout"}>
        {api.readError || api.actionError ? (
          <div className="notice action-notice">
            <p role="alert">{api.actionError || (incident
              ? "The API is unavailable. Showing the last incident update."
              : "The demo incident is unavailable.")}</p>
            <div className="actions">
              <button onClick={api.read}>Refresh incident</button>
              {api.retryAction ? <button onClick={() => api.retryAction && void perform(api.retryAction)}>Retry last action</button> : null}
              {api.readError ? <Link className="button" href="/night?fixture=1">Use development fixture</Link> : null}
            </div>
          </div>
        ) : null}
        {apiUser && !incident ? (
          api.readError ? null : <p role="status">Loading demo incident…</p>
        ) : visibleStage === "page" ? (
          <section className="panel call-panel" aria-labelledby="page-title">
            <p className="eyebrow">ShopNorth Checkout · Night shift</p>
            <p className="clock">02:04 <span>a.m.</span></p>
            <h1 id="page-title">Dana is calling.</h1>
            <p role="status">{snoozed ? "Page snoozed. Dana will ring again shortly." : "Checkout error rate is above the alert threshold."}</p>
            <div className="actions">
              <button className="primary" disabled={api.pending || api.readError || (incident && !incident.allowed_actions.includes("answer"))}
                onClick={() => void perform({ action: "answer" })}>Answer Dana</button>
              <button disabled={snoozed || api.pending || api.readError || (incident && !incident.allowed_actions.includes("snooze"))}
                onClick={() => void perform({ action: "snooze" })}>Snooze</button>
            </div>
          </section>
        ) : visibleStage === "briefing" ? (
          <DanaBriefing heading={heading} relayBase={relayBase}
            session={apiUser && incident ? { incidentId: incident.incident_id, level: incident.level, user: apiUser } : undefined}
            onContinue={() => {
              if (!api.readError && incident?.allowed_actions.includes("open_panel") && !incident.unlocked.includes("dashboard")) {
                void perform({ action: "open_panel", panel: "dashboard" });
              }
              setStage("board");
            }} />
        ) : (
          <IncidentBoard heading={heading} snapshot={api.snapshot} pending={api.pending || api.readError} onAction={perform} />
        )}
      </main>
    </>
  );
}
