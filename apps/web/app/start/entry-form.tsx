"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Level } from "../../../../packages/contracts/dana";
import { fixtureCohort, fixtureEntryHref, type FixtureEntry, levels, readFixtureEntry, startFixtureEntry, watchFixtureEntry } from "../night/fixture-entry";

import { TeamEntry } from "./team-entry";

const levelOptions = ["explore", "practice", "challenge"] as const;

export function EntryForm({ localApiAvailable, teamUser }: { localApiAvailable: boolean; teamUser?: string }) {
  const router = useRouter();
  const [level, setLevel] = useState<Level>("explore");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState<FixtureEntry | null | undefined>();
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const starting = useRef(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (teamUser) return;
    const refresh = () => setSaved(readFixtureEntry());
    refresh();
    return watchFixtureEntry(refresh);
  }, [teamUser]);

  function enter(kind: FixtureEntry["kind"]) {
    if (starting.current) return;
    starting.current = true;
    setStorageError(false);
    try {
      const entry = startFixtureEntry(level, kind);
      setLeaving(true);
      router.push(fixtureEntryHref(entry.id));
    } catch {
      starting.current = false;
      setStorageError(true);
    }
  }

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invite = code.trim().toUpperCase();
    if (invite !== fixtureCohort.code) {
      setError(invite === fixtureCohort.expiredCode
        ? "This rehearsal code has expired. Use the current code or start solo."
        : "That rehearsal code was not found. Check it and try again.");
      return;
    }
    setError("");
    enter("cohort");
  }

  return (
    <div className="entry-stack">
      {!teamUser && saved === undefined ? <p className="muted" role="status">Checking this browser for a saved exercise…</p> : null}
      {saved ? (
        <section className="panel entry-section" aria-labelledby="saved-title">
          <h2 id="saved-title">Resume your exercise</h2>
          <p className="muted">{levels[saved.level].title} · {saved.kind === "cohort" ? fixtureCohort.name : "Solo Night shift"}</p>
          <Link className="button primary" href={fixtureEntryHref(saved.id)}>Resume saved exercise</Link>
        </section>
      ) : null}
      <section className="panel entry-section" aria-labelledby="entry-title">
        <span className="badge fixture">{teamUser ? "Local API entry" : "Development entry fixture"}</span>
        <h2 id="entry-title">{teamUser ? "Start a team API exercise" : "Start a practice exercise"}</h2>
        {!teamUser ? <p className="muted">This exercise saves progress in this browser. The rehearsal roster uses simulated teammates.</p> : null}
        <fieldset className="entry-levels" disabled={leaving}>
          <legend>Difficulty</legend>
          {levelOptions.map(option => (
            <label key={option} className="entry-option">
              <input type="radio" name="level" checked={option === level} onChange={() => setLevel(option)} />
              <span><strong>{levels[option].title}</strong><span className="muted">{levels[option].description}</span></span>
            </label>
          ))}
        </fieldset>
        {level === "explore" ? (
          <details>
            <summary>Explore checklist</summary>
            <ol className="entry-list">
              <li>Answer Dana and identify what checkout is losing.</li>
              <li>Compare the first error with the latest deploy.</li>
              <li>Confirm rollback, then check the recovery metrics.</li>
            </ol>
          </details>
        ) : null}
        {teamUser ? <TeamEntry user={teamUser} level={level} /> : <>
        <button className={saved ? undefined : "primary"} disabled={leaving} onClick={() => enter("solo")}>
          {leaving ? "Opening exercise…" : "Start solo exercise"}
        </button>
        {saved ? <p className="muted">Starting or joining an exercise replaces the saved exercise in this browser.</p> : null}
        <form className="entry-section entry-join" onSubmit={join}>
          <h2>Join a rehearsal cohort</h2>
          <p id="cohort-hint" className="muted">Use sample code <strong>{fixtureCohort.code}</strong> to try the fixture.</p>
          <div className="message-form">
            <label htmlFor="cohort-code">Cohort code
              <input id="cohort-code" value={code} maxLength={32} autoComplete="off" autoCapitalize="characters"
                aria-invalid={Boolean(error)} aria-describedby={error ? "cohort-hint cohort-error" : "cohort-hint"}
                onChange={event => { setCode(event.target.value); setError(""); }} required />
            </label>
            <button type="submit" disabled={leaving}>Join cohort</button>
          </div>
          {error ? <p id="cohort-error" className="notice" role="alert">{error}</p> : null}
        </form>
        {storageError ? <p className="notice" role="alert">This browser could not save the exercise. Enable local storage to continue.</p> : null}
        </>}
      </section>
      {teamUser ? <Link href="/night/3d?fixture=1">Open the offline Night fixture</Link> : null}
      {localApiAvailable ? (
        <section className="panel entry-section" aria-labelledby="api-demo-title">
          <h2 id="api-demo-title">Continue the local API demo</h2>
          <p className="muted">Open the current ShopNorth incident on your configured local API.</p>
          <Link className="button" href="/night/3d">Open local API demo</Link>
        </section>
      ) : null}
    </div>
  );
}
