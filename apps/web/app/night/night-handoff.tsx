"use client";

import { useRef, useState } from "react";
import type { HandoffRequest, IncidentState } from "../../../../packages/contracts/types";

const fields = [
  ["what_happened", "What happened"],
  ["current_state", "Current state"],
  ["tried", "What was tried"],
  ["risks", "Remaining risks"],
] as const;

export function NightHandoff({ incident, user, unavailable, onSave }: {
  incident: Pick<IncidentState, "phase" | "handoff">;
  user: string;
  unavailable: boolean;
  onSave: (draft: HandoffRequest) => Promise<number>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const handoff = incident.handoff;
  const phaseAllowsHandoff = incident.phase === "stabilized" || incident.phase === "handed_off";
  const editable = phaseAllowsHandoff && (!handoff || (!handoff.rating && handoff.night_pair.includes(user)));

  if (!phaseAllowsHandoff && !handoff && !editing) return null;

  return (
    <section className="panel evidence-panel" aria-labelledby="handoff-title">
      <h2 id="handoff-title" ref={heading} tabIndex={-1}>Shift handoff</h2>
      {handoff ? (
        <>
          <p className="muted">Saved by {handoff.by} at {handoff.sim_clock}</p>
          <dl className="handoff-parts">
            {fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{handoff[key]}</dd></div>)}
            {handoff.morning_pair.length ? <div><dt>Morning teammates</dt><dd>{handoff.morning_pair.join(", ")}</dd></div> : null}
          </dl>
        </>
      ) : <p>Write a short note for the next shift about the incident and what still needs work.</p>}
      {notice ? <p role="status">{notice}</p> : null}
      {editable && !editing ? (
        <button disabled={unavailable} onClick={() => { setNotice(""); setEditing(true); }}>
          {handoff ? "Edit shift handoff" : "Write shift handoff"}
        </button>
      ) : null}
      {editing ? (
        <form className="entry-section" onSubmit={async event => {
          event.preventDefault();
          if (saving || unavailable || !editable) return;
          const form = new FormData(event.currentTarget);
          const part = (key: string) => String(form.get(key) ?? "").trim();
          const handles = part("morning_pair").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
          if (handles.length > 4 || handles.some(handle => !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(handle))) {
            setError("Enter up to four demo handles, separated by commas.");
            return;
          }
          const body: HandoffRequest = {
            what_happened: part("what_happened"), current_state: part("current_state"),
            tried: part("tried"), risks: part("risks"), morning_pair: Array.from(new Set(handles)),
          };
          if (fields.some(([key]) => !body[key])) {
            setError("Complete all four parts of the handoff.");
            return;
          }
          setSaving(true);
          setError("");
          const status = await onSave(body);
          if (!status) return;
          setSaving(false);
          if (status === 204) {
            setEditing(false);
            setNotice("Shift handoff saved.");
            heading.current?.focus();
          } else if (status === 403) {
            setError("The API did not authorize this member to write the handoff.");
          } else if (status === 409) {
            setError("The incident changed. Check its recovery or handoff status, then try again.");
          } else if (status === 422) {
            setError("Check that each part has text and any morning handles exist.");
          } else {
            setError("The API did not confirm the handoff. Check the shared note before retrying.");
          }
        }}>
          {fields.map(([key, label]) => (
            <label key={key}>{label}
              <textarea autoFocus={key === "what_happened"} name={key} rows={2} required maxLength={1000} readOnly={saving} defaultValue={handoff?.[key]} />
            </label>
          ))}
          <label>Morning teammate handles (optional)
            <input name="morning_pair" maxLength={140} autoComplete="off" readOnly={saving}
              defaultValue={handoff?.morning_pair.join(", ")} />
          </label>
          {!editable ? <p className="notice">The current incident state prevents edits.</p> : null}
          {error ? <p className="notice" role="alert">{error}</p> : null}
          <div className="actions">
            <button className="primary" disabled={saving || unavailable || !editable}>{saving ? "Saving handoff…" : "Save shift handoff"}</button>
            <button type="button" disabled={saving} onClick={() => { setError(""); setEditing(false); heading.current?.focus(); }}>Cancel handoff edit</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
