"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Criterion, IncidentEvidence, NetworkCard } from "../../../../packages/contracts/types";
import type { DanaMode } from "../../../../packages/contracts/dana";
import { DanaBriefing, useDanaBriefing } from "../night/dana-briefing";
import { prepareDanaAudio } from "../night/dana-connection";
import { levels } from "../night/fixture-entry";
import type { NightIncident } from "../night/use-night-api";
import { githubPullUrl } from "./morning-contract";
import { useMorningResource, useMorningWrite } from "./use-morning-api";

const criteria: Criterion[] = ["diagnosis", "mitigation", "validation", "communication", "collaboration"];

export function MorningDebrief({ incident, user, relayBase, unavailable, refresh }: {
  incident: NightIncident; user: string; relayBase: string; unavailable: boolean; refresh: () => void;
}) {
  const briefing = useDanaBriefing();
  const { busy, submit } = useMorningWrite(incident.incident_id);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const callTitle = useRef<HTMLHeadingElement>(null);

  function start(mode: DanaMode) {
    if (active.current || unavailable || busy) return;
    active.current = true;
    setOpen(true);
    setResult("");
    setError("");
    briefing.startRelay({ base: relayBase, call: "debrief", mode,
      audio: mode === "voice" ? prepareDanaAudio() : undefined,
      session: { incidentId: incident.incident_id, level: incident.level, user } });
  }

  function end() {
    if (briefing.isDraining()) return;
    briefing.close();
    active.current = false;
    setOpen(false);
    title.current?.focus();
    refresh();
  }

  const onEnd = useEffectEvent(end);
  useEffect(() => {
    if (open && briefing.state === "ended") onEnd();
  }, [open, briefing.state]);
  useEffect(() => {
    if (open) callTitle.current?.focus();
  }, [open]);

  const rubric = incident.rubric;
  return (
    <section className="panel phase-panel" aria-labelledby="morning-debrief">
      <h2 id="morning-debrief" ref={title} tabIndex={-1}>Debrief and rubric</h2>
      <p>Tell Dana what customers need to know and what you would report to the VP.</p>
      {open ? <DanaBriefing heading={callTitle} call="debrief" briefing={briefing} onContinue={end} /> : (
        <>
          <div className="actions">
            <button disabled={unavailable || busy} onClick={() => start("text")}>Debrief with Dana by text</button>
            <button disabled={unavailable || busy} onClick={() => start("voice")}>Debrief with Dana by voice</button>
          </div>
          {briefing.captions.length ? <details>
            <summary>Read debrief captions</summary>
            {briefing.captions.map((caption, index) => <p key={index}><strong>{caption.role === "dana" ? "Dana" : "You"}</strong> {caption.text}</p>)}
          </details> : null}
          <details>
            <summary>Submit a written debrief without a call</summary>
            <form className="entry-section" onSubmit={async event => {
              event.preventDefault();
              const answer = String(new FormData(event.currentTarget).get("answer") ?? "").trim();
              if (!answer) return;
              setError("");
              setResult("");
              const response = await submit({ operation: "debrief", answer });
              if (response?.ok) {
                setResult("Written debrief saved.");
                refresh();
              } else if (response) {
                setError("The API did not confirm the debrief. Check the rubric before retrying.");
                refresh();
              }
            }}>
              <label>Customer and VP update<textarea name="answer" rows={4} required maxLength={3000} readOnly={busy} /></label>
              <button disabled={unavailable || busy}>Save written debrief</button>
            </form>
          </details>
        </>
      )}
      {result ? <p role="status">{result}</p> : null}
      {error ? <p role="alert" className="notice">{error}</p> : null}
      {rubric ? (
        <>
          <h3>{rubric.final ? "Final server rubric" : "Provisional server rubric"} · {rubric.total}/{rubric.out_of}</h3>
          <dl className="handoff-parts">
            {criteria.map(name => {
              const score = rubric.rubric[name];
              const solo = name === "collaboration" && incident.teammates.length === 1;
              return <div key={name}>
                <dt>{name[0].toUpperCase() + name.slice(1)}</dt>
                <dd>{solo ? "N/A for the solo exercise" : "pending" in score ? "Pending debrief"
                  : `${score.score}/4 · ${score.reason}`}</dd>
              </div>;
            })}
          </dl>
        </>
      ) : <p className="muted">The backend has not returned a rubric yet.</p>}
    </section>
  );
}

export function PrivateEvidence({ incident }: { incident: NightIncident }) {
  const { data, status, reload } = useMorningResource<{ handle: string; record: IncidentEvidence | null }>(incident.incident_id, "evidence", incident.rubric?.final);
  const record = data?.record;
  const pr = record?.pr ? githubPullUrl(record.pr.url) : undefined;
  return (
    <section className="panel phase-panel" aria-labelledby="private-evidence">
      <h2 id="private-evidence">Private incident evidence</h2>
      {status === undefined && !data ? <p role="status">Loading your record…</p> : null}
      {status === 404 || (data && !record) ? <p>No participation record is available for this member on this incident.</p> : null}
      {status && status >= 400 && status !== 404 ? <p className="notice" role="alert">{record ? "Evidence could not be refreshed. Showing the last loaded record." : "The evidence record is unavailable."}</p> : null}
      {record ? <>
        <p className="muted">Recorded for {data.handle} · {record.role} · {record.phase.replaceAll("_", " ")}</p>
        <dl className="service-facts">
          <div><dt>Findings shared</dt><dd>{record.findings_shared}</dd></div>
          <div><dt>Status updates</dt><dd>{record.status_updates}</dd></div>
          {record.handoff_rating !== null ? <div><dt>Handoff usefulness</dt><dd>{record.handoff_rating}/5</dd></div> : null}
          {incident.handoff ? <div><dt>Handoff simulation time</dt><dd>{incident.handoff.sim_clock}</dd></div> : null}
          {record.pr ? <>
            <div><dt>CI result</dt><dd>{record.pr.ci}</dd></div>
            <div><dt>Merge</dt><dd>{record.pr.merged ? "Merged" : "Open or unmerged"}</dd></div>
            <div><dt>Non-author reviews</dt><dd>{record.pr.reviewers}</dd></div>
            {record.pr.mentor_reviewed ? <div><dt>Mentor review</dt><dd>Recorded</dd></div> : null}
            {incident.pr?.url === record.pr.url ? <div><dt>Head commit</dt><dd><code>{incident.pr.head_sha}</code></dd></div> : null}
          </> : null}
          {record.rubric?.final ? <div><dt>Final rubric</dt><dd>{record.rubric.total}/{record.rubric.out_of}</dd></div> : null}
        </dl>
        {pr ? <a href={pr} target="_blank" rel="noreferrer">Open recorded PR on GitHub</a> : null}
      </> : null}
      <button onClick={reload}>Refresh private evidence</button>
    </section>
  );
}

export function Connections({ incident, unavailable }: { incident: string; unavailable: boolean }) {
  const { data, status, reload } = useMorningResource<{ pending: string[]; cards: NetworkCard[] }>(incident, "connections");
  const { busy, submit } = useMorningWrite(incident);
  const [notice, setNotice] = useState("");
  const [unconfirmed, setUnconfirmed] = useState<string>();
  const [submitted, setSubmitted] = useState<string[]>([]);

  const canAnswer = !unavailable && !busy && status === 200;

  async function answer(handle: string, workAgain: boolean) {
    if (!canAnswer) return;
    setNotice("");
    setUnconfirmed(undefined);
    const result = await submit({ operation: "connect", handle, workAgain });
    if (result?.ok) {
      setSubmitted(previous => [...previous, handle]);
      setNotice(workAgain ? "Your private request was saved. A connection appears after mutual consent." : "Your choice was saved privately.");
    } else if (result) setUnconfirmed(handle);
    if (result) reload();
  }

  return (
    <section className="panel phase-panel" aria-labelledby="mutual-title">
      <h2 id="mutual-title">Work together again</h2>
      <p>Each teammate answers privately. Connections appear after both opt in.</p>
      {status === undefined && !data ? <p role="status">Loading connections…</p> : null}
      {status && status >= 400 ? <p className="notice" role="alert">{data ? "Connections could not be refreshed. Showing the last loaded results." : "Connections are unavailable."}</p> : null}
      {data?.pending.filter(handle => !submitted.includes(handle)).map(handle => <div className="entry-section" key={handle}>
        <strong>{handle}</strong>
        <div className="actions">
          <button disabled={!canAnswer} onClick={() => void answer(handle, true)}>Request connection with {handle}</button>
          <button disabled={!canAnswer} onClick={() => void answer(handle, false)}>Skip {handle}</button>
        </div>
      </div>)}
      {data?.cards.map(card => {
        const sharedPull = card.basis.pr_url ? githubPullUrl(card.basis.pr_url) : undefined;
        return <div className="entry-section" key={card.handle}>
          <p><span className="badge success">Mutual connection</span> {card.handle}
            {card.github_login ? ` · GitHub ${card.github_login}` : ""}{card.contact ? ` · ${card.contact}` : ""}</p>
          <p className="muted">{levels[card.basis.level].title} · {card.basis.phase.replaceAll("_", " ")}</p>
          {sharedPull ? <a href={sharedPull} target="_blank" rel="noreferrer">Open shared PR on GitHub</a> : null}
        </div>;
      })}
      {data && !data.pending.length && !data.cards.length ? <p className="muted">No pending choices or mutual connections.</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {unconfirmed && status === 200 && data?.pending.includes(unconfirmed) ?
        <p className="notice" role="alert">Your choice has not been confirmed. You can try again.</p> : null}
      <button onClick={reload}>Refresh connections</button>
    </section>
  );
}
