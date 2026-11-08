"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { DanaCall, DanaMode } from "../../../../packages/contracts/dana";
import { IncidentCheck } from "../morning/incident-check";
import { DanaBriefing, useDanaBriefing } from "./dana-briefing";
import { prepareDanaAudio } from "./dana-connection";
import { fixtureCohort, type FixtureEntry, levels, updateFixtureEntry } from "./fixture-entry";
import { IncidentBoard } from "./incident-board";
import { NightHandoff } from "./night-handoff";
import { TeamEvidence } from "./team-evidence";
import { type NightAction, useNightApi } from "./use-night-api";

type SupportCall = Exclude<DanaCall, "briefing">;

export function NightRun({ apiUser, relayBase, entry, incidentId }: { apiUser?: string; relayBase?: string; entry?: FixtureEntry; incidentId?: string }) {
  const [stage, setStage] = useState<"page" | "briefing" | "board">(entry?.briefingPending ? "briefing" : entry?.answered ? "board" : "page");
  const [answerPending, setAnswerPending] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [helpSnapshotTime, setHelpSnapshotTime] = useState<number>();
  const [supportCall, setSupportCall] = useState<SupportCall>();
  const [completedSupport, setCompletedSupport] = useState<{
    call: SupportCall;
    captions: ReturnType<typeof useDanaBriefing>["captions"];
  }>();
  const [finalCaption, setFinalCaption] = useState<string>();
  const supportLock = useRef(false);
  const supportHeading = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const answerMode = useRef<DanaMode | "fixture">(relayBase ? "text" : "fixture");
  const briefing = useDanaBriefing(entry?.briefingPending);
  const closeBriefing = briefing.close;
  const api = useNightApi(Boolean(apiUser), incidentId);
  const incident = api.snapshot?.incident;
  const recoveringAnswer = stage === "page" && (answerPending || api.retryAction?.action === "answer");
  const visibleStage = api.accessLost ? "page" : incident
    ? incident.phase === "paged" || recoveringAnswer ? "page" : stage === "briefing" ? "briefing" : "board"
    : stage;

  useEffect(() => {
    if (visibleStage !== "page") heading.current?.focus();
  }, [visibleStage]);

  useEffect(() => {
    if (supportCall) supportHeading.current?.focus();
  }, [supportCall]);

  useEffect(() => {
    if (!snoozed || visibleStage !== "page") return;
    const timer = window.setTimeout(() => setSnoozed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [visibleStage, snoozed]);

  async function perform(intent: NightAction, mode = answerMode.current) {
    if (api.pending) return false;
    const answering = intent.action === "answer";
    if (answering) {
      answerMode.current = mode;
      setStage("page");
    }
    // Unlock audio on the voice click. Mic capture and the socket wait for Answer acceptance.
    const audio = answering && mode === "voice" && relayBase ? prepareDanaAudio() : undefined;
    if (apiUser) {
      if (answering) setAnswerPending(true);
      const accepted = await api.act(intent);
      if (answering) setAnswerPending(false);
      if (!accepted) {
        if (audio && audio.state !== "closed") void audio.close();
        return false;
      }
    }
    if (answering) {
      setCompletedSupport(undefined);
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
    if (intent.action === "snooze" && incident?.ringing === undefined) setSnoozed(true);
    return true;
  }

  function openDashboard() {
    if (briefing.isDraining()) return;
    closeBriefing();
    setFinalCaption(briefing.captions.findLast(caption => caption.role === "dana")?.text);
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

  const checkingAfterHelp = helpSnapshotTime !== undefined && api.snapshot?.receivedAt === helpSnapshotTime;
  const canUseRelay = !checkingAfterHelp && Boolean(apiUser && relayBase && incident && !api.readError && visibleStage === "board");
  const helpAvailable = canUseRelay && incident?.status !== "fixed";
  const debriefAvailable = canUseRelay && incident?.status === "fixed" &&
    (incident.phase === "fixed" || incident.phase === "debriefed");

  function openSupport(call: SupportCall) {
    if (!relayBase || !apiUser || !incident || supportLock.current ||
      (call === "help" ? !helpAvailable : !debriefAvailable)) return;
    supportLock.current = true;
    setCompletedSupport(undefined);
    setSupportCall(call);
    // Each help socket consumes a hint before ready. Text uses the relay's own provider fallback.
    briefing.startRelay({
      base: relayBase, call, mode: "text",
      session: { incidentId: incident.incident_id, level: incident.level, user: apiUser },
    });
  }

  function closeSupport(reset = false) {
    if (!reset && briefing.isDraining()) return;
    closeBriefing();
    supportLock.current = false;
    setSupportCall(undefined);
    if (!reset) {
      if (supportCall && briefing.captions.length) setCompletedSupport({ call: supportCall, captions: briefing.captions });
      if (supportCall === "help") setHelpSnapshotTime(api.snapshot?.receivedAt);
      heading.current?.focus();
      api.refresh();
    }
  }

  const finishSupport = useEffectEvent(closeSupport);

  useEffect(() => {
    if (!supportCall) return;
    if (visibleStage !== "board") finishSupport(true);
    else if (briefing.state === "ended") finishSupport();
  }, [briefing.state, supportCall, visibleStage]);

  const answerDisabled = api.pending || api.readError || (incident && !incident.allowed_actions.includes("answer"));
  const callSnoozed = incident?.ringing === undefined ? snoozed : !incident.ringing;
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
        {incidentId && incident ? (
          <section className="panel entry-section entry-context" aria-label="Shared incident team">
            <p><strong>{apiUser}</strong> · {levels[incident.level].title} · Shared Night incident</p>
            <details>
              <summary>Incident teammates</summary>
              <ul className="entry-list">{incident.teammates.map(handle => <li key={handle}>{handle}</li>)}</ul>
            </details>
          </section>
        ) : null}
        {api.readError || api.actionError ? (
          <div className="notice action-notice">
            <p role="alert">{api.accessLost ? "This incident is no longer available to this demo member." : api.actionError || (incident
              ? "The API is unavailable. Showing the last incident update."
              : "The demo incident is unavailable.")}</p>
            <div className="actions">
              <button onClick={api.refresh}>Refresh incident</button>
              {api.retryAction ? <button disabled={api.pending} onClick={() => api.retryAction && void perform(api.retryAction)}>Retry last action</button> : null}
              {api.readError && incidentId ? <Link className="button" href="/start">Back to simulation entry</Link> : null}
              {api.readError ? <Link className="button" href="/night?fixture=1">Use development fixture</Link> : null}
            </div>
          </div>
        ) : null}
        {incidentId && incident?.phase === "paged" ? <details className="phase-entry-check">
          <summary>Take the baseline check</summary>
          <IncidentCheck incident={incidentId} night unavailable={api.pending || api.readError} />
        </details> : null}
        {apiUser && !incident ? (
          api.readError ? null : <p role="status">Loading demo incident…</p>
        ) : visibleStage === "page" ? (
          <section className="panel call-panel" aria-labelledby="page-title">
            <p className="eyebrow">ShopNorth Checkout · Night shift</p>
            <p className="clock">02:04 <span>a.m.</span></p>
            <h1 id="page-title">{recoveringAnswer ? "Connecting to Dana" : "Dana is calling."}</h1>
            <p role="status">{api.retryAction?.action === "answer"
              ? "Retry Answer to reconnect to the briefing."
              : recoveringAnswer ? "Waiting for the incident to confirm your answer."
              : callSnoozed ? "Page snoozed. Dana will ring again shortly." : "Checkout error rate is above the alert threshold."}</p>
            <div className="actions">
              <button className="primary" disabled={answerDisabled}
                onClick={() => void perform({ action: "answer" }, relayBase ? "text" : "fixture")}>
                {relayBase ? "Answer Dana by text" : "Answer Dana"}
              </button>
              {relayBase ? <button disabled={answerDisabled}
                onClick={() => void perform({ action: "answer" }, "voice")}>Answer Dana with voice</button> : null}
              <button disabled={callSnoozed || api.pending || api.readError || (incident && !incident.allowed_actions.includes("snooze"))}
                onClick={() => void perform({ action: "snooze" })}>Snooze</button>
              {api.retryAction?.action === "answer" && incident?.phase !== "paged" ? (
                <button onClick={() => setStage("board")}>Open incident without briefing</button>
              ) : null}
            </div>
          </section>
        ) : visibleStage === "briefing" ? (
          <DanaBriefing heading={heading} briefing={briefing} onContinue={openDashboard} />
        ) : (
          <>
            {supportCall ? (
              <DanaBriefing key={supportCall} heading={supportHeading} call={supportCall} briefing={briefing}
                onContinue={() => closeSupport()} />
            ) : checkingAfterHelp && !api.readError ? (
              <p className="muted" role="status">Checking the incident after Help…</p>
            ) : helpAvailable || debriefAvailable ? (
              <section className="panel entry-section dana-tools" aria-label="Dana calls">
                {helpAvailable && incident?.nudge ? (
                  <p role="status"><strong>Dana is calling for a status update.</strong> {incident.stakeholder_message}</p>
                ) : null}
                {helpAvailable ? <button onClick={() => openSupport("help")}>{incident?.nudge ? "Answer Dana’s nudge by text" : "Ask Dana for help by text"}</button> : null}
                {debriefAvailable ? <button onClick={() => openSupport("debrief")}>Open Dana debrief by text</button> : null}
              </section>
            ) : null}
            {completedSupport ? (
              <details className="panel entry-section dana-tools">
                <summary>Last Dana {completedSupport.call} transcript</summary>
                {completedSupport.captions.map((caption, index) => (
                  <p key={index}><strong>{caption.role === "dana" ? "Dana" : "You"}</strong> {caption.text}</p>
                ))}
              </details>
            ) : null}
            <IncidentBoard heading={heading} snapshot={api.snapshot} pending={api.pending || api.readError}
              finalCaption={finalCaption} onAction={perform} initialRollbackAt={entry?.rollbackAt} teamIncidentId={incidentId}
              onFixtureRollback={entry ? rollbackAt => setSaveFailed(!updateFixtureEntry(entry.id, { type: "rollback", startedAt: rollbackAt })) : undefined} />
            {api.snapshot ? <TeamEvidence snapshot={api.snapshot} pending={api.pending || api.readError} onAction={perform} /> : null}
            {incidentId && apiUser && incident ? <NightHandoff incident={incident} user={apiUser}
              unavailable={api.pending || api.readError} onSave={api.saveHandoff} /> : null}
            {incidentId && incident?.handoff ? <Link className="button primary phase-link"
              href={`/morning?incident=${encodeURIComponent(incidentId)}`}>Open Morning workspace</Link> : null}
          </>
        )}
      </main>
    </>
  );
}
