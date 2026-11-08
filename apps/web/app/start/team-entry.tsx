"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Level } from "../../../../packages/contracts/dana";
import { type CohortRoster, isCohortId, isTeamIncidentId, teamIncidentHref } from "../night/team-entry-contract";

const endpoint = "/api/night/entry";

export function TeamEntry({ user, level }: { user: string; level: Level }) {
  const router = useRouter();
  const cohortKey = `incident-lab.team-entry.v1.${user}.cohort`;
  const incidentKey = `incident-lab.team-entry.v1.${user}.incident`;
  const [code, setCode] = useState("");
  const [cohort, setCohort] = useState<CohortRoster>();
  const [incidentId, setIncidentId] = useState<string>();
  const [teammates, setTeammates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState(false);
  const submission = useRef<AbortController>(null);

  useEffect(() => {
    let savedCohort;
    try {
      const savedIncident = localStorage.getItem(incidentKey);
      if (isTeamIncidentId(savedIncident)) setIncidentId(savedIncident);
      savedCohort = localStorage.getItem(cohortKey);
    } catch {
      setSaveError(true);
    }
    if (!isCohortId(savedCohort)) return;
    const controller = new AbortController();
    void fetch(`${endpoint}?cohort=${savedCohort}`, { signal: controller.signal }).then(async response => {
      if (controller.signal.aborted || submission.current) return;
      if (response.status === 404) {
        setError("The saved cohort is unavailable. Enter a current code to join.");
      } else if (response.ok) {
        const roster: CohortRoster = await response.json();
        if (!controller.signal.aborted && !submission.current) setCohort(current => current ?? roster);
      } else {
        setError("The roster could not be loaded. Enter your code to try again.");
      }
    }).catch(() => {
      if (!controller.signal.aborted && !submission.current) setError("The roster could not be loaded. Enter your code to try again.");
    });
    return () => controller.abort();
  }, [cohortKey, incidentKey]);

  useEffect(() => () => submission.current?.abort(), []);

  function remember(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      setSaveError(true);
      return false;
    }
  }

  async function submit(body: { kind: "join"; code: string } | { kind: "start"; level: Level; teammates: string[] }) {
    if (submission.current) return;
    const controller = new AbortController();
    submission.current = controller;
    setBusy(true);
    setError("");
    let navigating = false;
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status >= 500) throw new Error("Request was not confirmed");
        setError(response.status === 403 ? "This demo member is not authorized. Check the local API configuration."
          : body.kind === "join" && response.status === 404 ? "That cohort code was not found. Check the code and try again."
          : body.kind === "join" && response.status === 409 ? "That cohort is full. Use a different code or start solo."
          : "The API rejected this request. Check the code or selected teammates.");
        return;
      }
      if (body.kind === "join") {
        const roster: CohortRoster = await response.json();
        setCohort(roster);
        setTeammates([]);
        remember(cohortKey, roster.id);
      } else {
        const { id } = await response.json();
        setIncidentId(id);
        if (remember(incidentKey, id)) {
          navigating = true;
          router.push(teamIncidentHref(id));
        }
      }
    } catch {
      if (controller.signal.aborted) return;
      setError(body.kind === "start"
        ? "The API did not confirm the start. Starting again may create another incident."
        : "The API did not confirm the join. Try the same code again.");
    } finally {
      if (!navigating && !controller.signal.aborted) {
        submission.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <div className="entry-section">
      <p className="muted">Local team API · Signed in as demo member {user}</p>
      {incidentId ? <Link className="button" href={teamIncidentHref(incidentId)}>Resume API incident</Link> : null}
      <button className="primary" disabled={busy} onClick={() => void submit({ kind: "start", level, teammates: [] })}>
        Start solo incident
      </button>
      <form className="entry-section entry-join" onSubmit={event => {
        event.preventDefault();
        const invite = code.replace(/\s/g, "").toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(invite)) {
          setError("Enter the six-character cohort code.");
          return;
        }
        void submit({ kind: "join", code: invite });
      }}>
        <h2>Join a cohort</h2>
        <div className="message-form">
          <label>Team cohort code
            <input value={code} autoComplete="off" maxLength={16} required disabled={busy}
              onChange={event => { setCode(event.target.value); setError(""); }} />
          </label>
          <button type="submit" disabled={busy}>Join team cohort</button>
        </div>
      </form>
      {cohort ? (
        <fieldset className="entry-levels" disabled={busy}>
          <legend>{cohort.name} members</legend>
          <p className="muted">{user} (you). Choose up to three teammates for the new incident.</p>
          {cohort.members.filter(member => member.handle !== user).map(({ handle }) => (
            <label key={handle} className="entry-option">
              <input type="checkbox" checked={teammates.includes(handle)}
                disabled={teammates.length === 3 && !teammates.includes(handle)}
                onChange={event => setTeammates(event.target.checked ? [...teammates, handle] : teammates.filter(value => value !== handle))} />
              <span>{handle}</span>
            </label>
          ))}
          <button disabled={!teammates.length} onClick={() => void submit({ kind: "start", level, teammates })}>
            Start with selected teammates
          </button>
        </fieldset>
      ) : null}
      {error ? <p role="alert" className="notice">{error}</p> : null}
      {saveError ? <p role="status" className="notice">This browser could not save an entry link. Open the incident here and keep its URL to resume.</p> : null}
    </div>
  );
}
