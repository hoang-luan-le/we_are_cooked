"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { DanaMode } from "../../../../packages/contracts/dana";
import { DanaBriefing, useDanaBriefing } from "./dana-briefing";
import { prepareDanaAudio } from "./dana-connection";
import { fixtureCohort, type FixtureEntry, levels, updateFixtureEntry } from "./fixture-entry";
import { IncidentBoard } from "./incident-board";
import { type NightAction, useNightApi } from "./use-night-api";

export function NightRun({ apiUser, relayBase, entry, incidentId }: { apiUser?: string; relayBase?: string; entry?: FixtureEntry; incidentId?: string }) {
  const [stage, setStage] = useState<"page" | "briefing" | "board">(entry?.briefingPending ? "briefing" : entry?.answered ? "board" : "page");
  const [snoozed, setSnoozed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const answerMode = useRef<DanaMode | "fixture">(relayBase ? "text" : "fixture");
  const briefing = useDanaBriefing(entry?.briefingPending);
  const closeBriefing = briefing.close;
  const api = useNightApi(Boolean(apiUser), incidentId);
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

  async function perform(intent: NightAction, mode = answerMode.current) {
    if (api.pending) return false;
    const answering = intent.action === "answer";
    if (answering) answerMode.current = mode;
    // Unlock audio on the voice click. Mic capture and the socket wait for Answer acceptance.
    const audio = answering && mode === "voice" && relayBase ? prepareDanaAudio() : undefined;
    if (apiUser && !await api.act(intent)) {
      if (audio && audio.state !== "closed") void audio.close();
      return false;
    }
    if (answering) {
      if (entry) setSaveFailed(!updateFixtureEntry(entry.id, { type: "answer" }));
      setStage("briefing");
      if (mode === "fixture" || !relayBase) briefing.useFixture();
      else briefing.startRelay({
        base: relayBase,
        mode,
        audio,
        session: apiUser && incident ? { incidentId: incident.incident_id, level: incident.level, user: apiUser } : undefined,
      });
    }
    if (intent.action === "snooze") setSnoozed(true);
    return true;
  }

  function openDashboard() {
    if (briefing.isDraining()) return;
    closeBriefing();
    if (entry) setSaveFailed(!updateFixtureEntry(entry.id, { type: "finish_briefing" }));
    if (!api.readError && incident?.allowed_actions.includes("open_panel") && !incident.unlocked.includes("dashboard")) {
      void perform({ action: "open_panel", panel: "dashboard" });
    }
    setStage("board");
  }

  const finishBriefing = useEffectEvent(openDashboard);

  useEffect(() => {
    if (visibleStage === "briefing" && briefing.state === "ended") finishBriefing();
  }, [visibleStage, briefing.state]);

  useEffect(() => {
    if (visibleStage === "briefing") return closeBriefing;
  }, [visibleStage, closeBriefing]);

  const answerDisabled = api.pending || api.readError || (incident && !incident.allowed_actions.includes("answer"));
  const finalCaption = briefing.state === "ended" ? briefing.captions.findLast(caption => caption.role === "dana")?.text : undefined;
  const cohortRole = entry?.kind === "cohort" ? fixtureCohort.members.find(member => member.name === "You")?.role : undefined;

  return (
    <>
      <header className="app-header">
        <Link href={entry || incidentId ? "/start" : "/"}>Incident Lab</Link>
        <span className="badge fixture">{apiUser ? "Local demo API" : "Development fixture"}</span>
      </header>
      <main className={visibleStage === "board" ? "workspace" : "call-layout"}>
        {entry ? (
          <section className="panel entry-section entry-context" aria-label="Saved practice exercise">
            <p><strong>{levels[entry.level].title}</strong> · {cohortRole ?? "Solo Night 2D"}</p>
            {entry.kind === "cohort" ? (
              <details>
                <summary>Rehearsal cohort members</summary>
                <ul className="entry-list">
                  {fixtureCohort.members.map(member => <li key={member.name}>{member.name} · {member.role}</li>)}
                </ul>
              </details>
            ) : null}
            {saveFailed ? <p className="notice" role="alert">Progress could not be saved. You can continue in this tab.</p> : null}
          </section>
        ) : null}
        {api.readError || api.actionError ? (
          <div className="notice action-notice">
            <p role="alert">{api.actionError || (incident
              ? "The API is unavailable. Showing the last incident update."
              : "The demo incident is unavailable.")}</p>
            <div className="actions">
              <button onClick={api.read}>Refresh incident</button>
              {api.retryAction ? <button onClick={() => api.retryAction && void perform(api.retryAction)}>Retry last action</button> : null}
              {api.readError && incidentId ? <Link className="button" href="/start">Back to simulation entry</Link> : null}
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
              <button className="primary" disabled={answerDisabled}
                onClick={() => void perform({ action: "answer" }, relayBase ? "text" : "fixture")}>
                {relayBase ? "Answer Dana by text" : "Answer Dana"}
              </button>
              {relayBase ? <button disabled={answerDisabled}
                onClick={() => void perform({ action: "answer" }, "voice")}>Answer Dana with voice</button> : null}
              <button disabled={snoozed || api.pending || api.readError || (incident && !incident.allowed_actions.includes("snooze"))}
                onClick={() => void perform({ action: "snooze" })}>Snooze</button>
            </div>
          </section>
        ) : visibleStage === "briefing" ? (
          <DanaBriefing heading={heading} briefing={briefing} onContinue={openDashboard} />
        ) : (
          <IncidentBoard heading={heading} snapshot={api.snapshot} pending={api.pending || api.readError}
            finalCaption={finalCaption} onAction={perform} initialRollbackAt={entry?.rollbackAt}
            onFixtureRollback={entry ? rollbackAt => setSaveFailed(!updateFixtureEntry(entry.id, { type: "rollback", startedAt: rollbackAt })) : undefined} />
        )}
      </main>
    </>
  );
}
